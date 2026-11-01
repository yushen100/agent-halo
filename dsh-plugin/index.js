// agent-halo × DSH Host 插件
// v1.1：最近会话回放由 bridge/recent-replays.mjs 生成，下拉框可按会话切换。
// ---------------------------------------------------------------------------
// 职责：
//   1. DSH 启动/加载本插件时，若 5180 未被占用，后台拉起 bridge/server.mjs；
//   2. 订阅 DSH 的 session/created、session/event、session/disposed，
//      按 bridge/normalize.mjs 的事件契约 v1 推给 agent-halo 服务；
//   3. DSH 卸载插件/退出时结束自己拉起的服务；若 5180 是用户自己开的
//      start-halo.cmd，则不杀它，只清掉本插件的实时推送缓存。
//
// 不修改 DSH 的任何现有配置、profile 或 hooks；本文件只实现一个普通 Host 插件。

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createDshNormalizer } from '../bridge/normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(HERE, '..')
const DEFAULT_PORT = 5180
const MAX_QUEUE = 20000
const NODE_EXE = /node(?:\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : 'node'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requestJson(url, { method = 'GET', body = null, token = '', timeout = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const headers = {}
    if (body !== null) {
      headers['content-type'] = 'application/json; charset=utf-8'
      headers['content-length'] = Buffer.byteLength(JSON.stringify(body))
    }
    if (token) headers['x-halo-token'] = token
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers,
      timeout,
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch {}
        resolve({ status: res.statusCode, json, text })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (body !== null) req.write(JSON.stringify(body))
    req.end()
  })
}

function probePort(port, timeout = 450) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      try { socket.destroy() } catch {}
      resolve(value)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeout, () => finish(false))
  })
}

function waitExit(child, timeout) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve(true)
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(false), timeout)
    child.once('exit', () => finish(true))
  })
}

class AgentHaloBridge {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = config || {}
    this.port = Number(this.config.port) || DEFAULT_PORT
    this.root = path.resolve(this.config.projectRoot || PROJECT_ROOT)
    this.serverPath = path.join(this.root, 'bridge', 'server.mjs')
    this.dataDir = path.join(this.root, 'data')
    this.token = ''
    this.child = null
    this.started = false
    this.existing = false
    this.disposed = false
    this.flushing = false
    this.flushTimer = null
    this.queue = []
    this.sessions = new Map()
    this.lastPushErrorAt = 0

    ctx.on('session/created', (session) => this.adopt(session))
    ctx.on('session/disposed', (session) => this.onSessionDisposed(session))
    ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
    // 热重载或插件晚加载时，已经活着的会话不会重发 session/created，主动补一次。
    for (const session of ctx.sessions.list()) this.adopt(session)
  }

  log(level, message) {
    try {
      const logger = this.ctx.logger
      if (logger && typeof logger[level] === 'function') logger[level](`[agent-halo] ${message}`)
    } catch {}
  }

  dshSessionsRoot() {
    if (this.config.dshRoot) return path.resolve(String(this.config.dshRoot))
    if (process.env.DSH_HOME) return path.join(process.env.DSH_HOME, 'sessions')
    return ''
  }

  async start() {
    if (this.disposed) return
    if (!fs.existsSync(this.serverPath)) {
      this.log('warn', `找不到 ${this.serverPath}，实时服务未启动。`)
      return
    }

    const occupied = await probePort(this.port)
    if (occupied) {
      const health = await this.health().catch(() => null)
      if (health && health.name === 'agent-halo' && Array.isArray(health.features) && health.features.includes('live-push')) {
        const token = this.readToken()
        if (token) {
          this.token = token
          this.existing = true
          this.started = true
          this.log('info', `复用已在运行的 agent-halo（${this.port}），实时事件直连已接通。`)
          this.scheduleFlush(0)
          return
        }
        this.log('warn', '5180 已有 agent-halo，但读不到推送令牌；保持回放文件轮询模式。')
      } else {
        this.log('warn', `端口 ${this.port} 已被其他程序占用，不启动 agent-halo。`)
      }
      return
    }

    this.token = crypto.randomBytes(18).toString('hex')
    this.spawnServer()
    const ready = await this.waitHealth(6000)
    if (!ready) {
      this.log('warn', 'agent-halo 服务未在 6 秒内就绪，实时事件推送暂不可用。')
      await this.stopChild()
      this.token = ''
      return
    }
    this.started = true
    this.log('info', `agent-halo 已启动：http://127.0.0.1:${this.port}/?live=1`)
    this.scheduleFlush(0)
  }

  spawnServer() {
    fs.mkdirSync(this.dataDir, { recursive: true })
    const logPath = path.join(this.dataDir, 'halo-server.log')
    try {
      if (fs.statSync(logPath).size > 5 * 1024 * 1024) {
        try { fs.rmSync(logPath + '.1', { force: true }) } catch {}
        fs.renameSync(logPath, logPath + '.1')
      }
    } catch {}
    const fd = fs.openSync(logPath, 'a')
    const args = [
      this.serverPath,
      '--port', String(this.port),
      '--parent-pid', String(process.pid),
      '--watch-stdin',
      '--live-token', this.token,
    ]
    const dshRoot = this.dshSessionsRoot()
    if (dshRoot) args.push('--dsh-root', dshRoot)
    const child = spawn(NODE_EXE, args, {
      cwd: this.root,
      windowsHide: true,
      stdio: ['pipe', fd, fd],
    })
    fs.closeSync(fd)
    this.child = child
    child.on('error', (err) => this.log('warn', `agent-halo 子进程启动失败：${String(err)}`))
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null
      if (!this.disposed) this.log('info', `agent-halo 子进程已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）。`)
    })
    child.stdin.on('error', () => {})
  }

  async health() {
    const res = await requestJson(`http://127.0.0.1:${this.port}/api/health`, { timeout: 800 })
    return res.status === 200 ? res.json : null
  }

  async waitHealth(timeout) {
    const deadline = Date.now() + timeout
    while (!this.disposed && Date.now() < deadline) {
      if (!this.child) return false
      const health = await this.health().catch(() => null)
      if (health && health.name === 'agent-halo') return true
      await delay(120)
    }
    return false
  }

  readToken() {
    try { return fs.readFileSync(path.join(this.dataDir, '.live-token'), 'utf8').trim() } catch { return '' }
  }

  adopt(session) {
    const id = String(session.id)
    if (this.sessions.has(id)) return
    const header = session.header || {}
    const state = {
      session,
      lastSeq: -1,
      normalizer: createDshNormalizer({
        sessionId: id,
        createdAt: Number(header.createdAt) || 1,
        cwd: header.cwd,
      }),
    }
    this.sessions.set(id, state)
    this.enqueue(state.normalizer.normalize({
      type: 'session',
      id,
      seq: -1,
      createdAt: Number(header.createdAt) || 1,
      cwd: header.cwd,
    }, `dsh://${id}`))
    // 插件晚加载/热重载时补已有历史；session/event 订阅会继续增量。
    try {
      const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents(0) : []
      for (const event of events) this.consume(state, event)
    } catch (err) {
      this.log('warn', `读取会话 ${id} 历史失败：${String(err)}`)
    }
  }

  onSessionEvent(session, event) {
    let state = this.sessions.get(String(session.id))
    if (!state) {
      this.adopt(session)
      state = this.sessions.get(String(session.id))
    }
    if (state) this.consume(state, event)
  }

  consume(state, event) {
    const seq = Number(event && event.seq)
    if (!Number.isFinite(seq)) return
    if (seq <= state.lastSeq) return
    state.lastSeq = seq
    this.enqueue(state.normalizer.normalize(event, `dsh://${state.session.id}`))
  }

  onSessionDisposed(session) {
    const id = String(session.id)
    this.sessions.delete(id)
    if (this.token) this.post('/api/live/detach', { session_id: id }, 1000).catch(() => {})
  }

  enqueue(events) {
    if (!Array.isArray(events) || !events.length) return
    this.queue.push(...events)
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
    this.scheduleFlush(0)
  }

  scheduleFlush(delayMs = 80) {
    if (this.disposed || !this.token || this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, delayMs)
  }

  async flush() {
    if (this.flushing || !this.token || this.disposed || !this.queue.length) return
    this.flushing = true
    const batch = this.queue.splice(0, 400)
    try {
      await this.post('/api/live/push', { events: batch })
    } catch (err) {
      this.queue.unshift(...batch)
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
      const now = Date.now()
      if (now - this.lastPushErrorAt > 5000) {
        this.lastPushErrorAt = now
        this.log('warn', `实时事件推送失败，将在后台重试：${String(err)}`)
      }
    } finally {
      this.flushing = false
      if (this.queue.length && !this.disposed) this.scheduleFlush(this.token ? 80 : 1000)
    }
  }

  async post(pathname, body, timeout = 1500) {
    const res = await requestJson(`http://127.0.0.1:${this.port}${pathname}`, {
      method: 'POST',
      body,
      token: this.token,
      timeout,
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 160)}`)
    return res.json
  }

  async stopChild() {
    const child = this.child
    this.child = null
    if (!child) return
    try { child.stdin.end() } catch {}
    try { child.kill() } catch {}
    const exited = await waitExit(child, 1500)
    if (!exited && child.pid) {
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
    }
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    // 先把最后一批事件和 detach 尽量送达；送不到也不影响关闭。
    if (this.token && this.queue.length) {
      const batch = this.queue.splice(0, 2000)
      try { await this.post('/api/live/push', { events: batch }, 800) } catch {}
    }
    if (this.token) {
      try { await this.post('/api/live/detach', {}, 800) } catch {}
    }
    this.queue.length = 0
    await this.stopChild()
    this.sessions.clear()
  }
}

export function apply(ctx, config = {}) {
  const bridge = new AgentHaloBridge(ctx, config)
  ctx.effect(() => () => bridge.dispose(), 'agent-halo bridge')
  bridge.start().catch((err) => bridge.log('warn', `启动失败：${String(err)}`))
}

export const inject = ['sessions']
export const name = 'agent-halo'
