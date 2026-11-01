#!/usr/bin/env node
// 零依赖回放 / 实时服务：托管 web/ 与 data/*.jsonl。
//   node bridge/server.mjs [--port 5180] [--dsh-root <sessions>]
// 插件模式额外参数（由 DSH 插件自动传入）：
//   --live-token <token>  只允许本机插件向 /api/live/push 推送事件
//   --parent-pid <pid>    DSH 退出后自动结束本服务（双保险）
// 只绑定 127.0.0.1，不对外网开放。

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLiveReader } from './live.mjs'
import { refreshRecentReplays, refreshStaleReplays, replaySessionId } from './recent-replays.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(ROOT, 'web')
const DATA = path.join(ROOT, 'data')
const TOKEN_FILE = path.join(DATA, '.live-token')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const PORT = Number(arg('port', '5180'))
const DSH_ROOT = path.resolve(arg('dsh-root', process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'sessions') : path.join(os.homedir(), '.dsh', 'sessions')))
const LIVE_TOKEN = String(arg('live-token', '') || crypto.randomBytes(18).toString('hex'))
const PARENT_PID = Number(arg('parent-pid', '0')) || 0
const WATCH_STDIN = process.argv.includes('--watch-stdin')
const readLive = createLiveReader(DSH_ROOT)
const liveClients = new Set()
let liveSignature = ''

// ── 插件直连的事件缓存 ─────────────────────────────────────────────
// 插件在本进程内通过 session/event 拿到原始事件，先按 normalize.mjs 的事件契约 v1
// 归一化，再 POST 到这里。服务只保存、排序、按最新会话选取；不写任何文件。
const pushedSessions = new Map()
const MAX_EVENTS_PER_SESSION = 20000
const MAX_PUSH_BODY = 8 * 1024 * 1024

function pushSession(id) {
  let s = pushedSessions.get(id)
  if (!s) {
    s = { id, events: [], ids: new Set(), lastActivity: 0 }
    pushedSessions.set(id, s)
  }
  return s
}

function pushEvents(events) {
  let touched = false
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.v !== 1 || typeof e.session_id !== 'string' || typeof e.kind !== 'string') continue
    const ts = Number(e.ts)
    if (!Number.isFinite(ts)) continue
    const s = pushSession(e.session_id)
    const eventId = typeof e.event_id === 'string' ? e.event_id : ''
    if (eventId && s.ids.has(eventId)) continue
    if (eventId) s.ids.add(eventId)
    s.events.push(e)
    if (s.events.length > MAX_EVENTS_PER_SESSION) s.events.splice(0, s.events.length - MAX_EVENTS_PER_SESSION)
    s.lastActivity = Math.max(s.lastActivity, ts)
    touched = true
  }
  if (touched) {
    liveSignature = ''
    publishLive()
  }
}

function activePushedSnapshot() {
  const list = [...pushedSessions.values()].filter((s) => s.events.length)
  if (!list.length) return null
  list.sort((a, b) => b.lastActivity - a.lastActivity)
  const s = list[0]
  return { status: 'ok', mode: 'push', session_id: s.id, events: s.events }
}

function clearPushed(sessionId) {
  if (sessionId) pushedSessions.delete(String(sessionId))
  else pushedSessions.clear()
  liveSignature = ''
  publishLive()
}

function currentSnapshot() {
  return activePushedSnapshot() || { ...readLive(), mode: 'file' }
}

function publishLive() {
  if (!liveClients.size) return
  const snapshot = currentSnapshot()
  const signature = JSON.stringify(snapshot)
  if (signature === liveSignature) return
  liveSignature = signature
  const payload = `event: snapshot\ndata: ${signature}\n\n`
  for (const client of liveClients) {
    try { client.write(payload) } catch { liveClients.delete(client) }
  }
}
const liveTimer = setInterval(publishLive, 1000)
liveTimer.unref()

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function sendJson(res, code, value) {
  send(res, code, JSON.stringify(value), 'application/json; charset=utf-8')
}

function safeJoin(base, rel) {
  const p = path.resolve(base, rel)
  return p.startsWith(base + path.sep) ? p : null
}

let replayRefreshAt = 0
function refreshReplays(force = false) {
  const now = Date.now()
  if (!force && now - replayRefreshAt < 5000) return
  replayRefreshAt = now
  try {
    const result = refreshRecentReplays({ root: DSH_ROOT, dataDir: DATA, limit: 6 })
    if (result.written) console.log(`已生成 ${result.written} 个最近会话回放（共 ${result.total} 个候选）`)
    const st = refreshStaleReplays({ dataDir: DATA })
    if (st.updated) console.log(`已同步 ${st.updated} 个继续进行过的会话回放`)
  } catch (err) {
    console.error('生成最近会话回放失败：' + String(err))
  }
}

function listData() {
  if (!fs.existsSync(DATA)) return []
  return fs.readdirSync(DATA)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const st = fs.statSync(path.join(DATA, name))
      return { name, size: st.size, mtime: st.mtimeMs, session_id: replaySessionId(name) }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_PUSH_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

function tokenOk(req) {
  const got = String(req.headers['x-halo-token'] || '')
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(LIVE_TOKEN)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function writeTokenFile() {
  try {
    fs.mkdirSync(DATA, { recursive: true })
    fs.writeFileSync(TOKEN_FILE, LIVE_TOKEN + '\n', 'utf8')
  } catch (err) {
    console.error('无法写入实时推送令牌文件：' + String(err))
  }
}

// 插件启动本服务时传入 --parent-pid：DSH 被强杀、来不及走插件卸载钩子时，
// 这里仍会在一秒内发现父进程消失并退出，避免 5180 留下孤儿服务。
function watchParent() {
  if (!PARENT_PID) return
  const timer = setInterval(() => {
    try { process.kill(PARENT_PID, 0) }
    catch { shutdown('parent gone') }
  }, 1000)
  timer.unref()
  if (WATCH_STDIN && process.stdin && process.stdin.readable) {
    process.stdin.on('end', () => shutdown('parent stdin closed'))
    process.stdin.resume()
  }
}

let shuttingDown = false
function shutdown(reason = '') {
  if (shuttingDown) return
  shuttingDown = true
  if (reason) console.log(`agent-halo 实时服务退出：${reason}`)
  for (const client of liveClients) {
    try { client.end() } catch {}
  }
  liveClients.clear()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      name: 'agent-halo',
      version: 1,
      features: ['live-push'],
      pid: process.pid,
      mode: pushedSessions.size ? 'push' : 'file',
    })
  }

  if (pathname === '/api/live') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 1000\n\n')
    // 新连接读取最新快照，重连时不依赖上次推送的状态。
    liveClients.add(res)
    liveSignature = ''
    publishLive()
    req.on('close', () => liveClients.delete(res))
    return
  }

  if (pathname === '/api/live/push' && req.method === 'POST') {
    if (!tokenOk(req)) return send(res, 403, '令牌不匹配')
    readJsonBody(req)
      .then((body) => {
        pushEvents(body && body.events)
        sendJson(res, 200, { ok: true, received: Array.isArray(body?.events) ? body.events.length : 0 })
      })
      .catch((err) => { if (!res.writableEnded) send(res, 400, String(err && err.message ? err.message : err)) })
    return
  }

  if (pathname === '/api/live/detach' && req.method === 'POST') {
    if (!tokenOk(req)) return send(res, 403, '令牌不匹配')
    readJsonBody(req)
      .then((body) => {
        clearPushed(body && body.session_id ? body.session_id : '')
        sendJson(res, 200, { ok: true })
      })
      .catch((err) => { if (!res.writableEnded) send(res, 400, String(err && err.message ? err.message : err)) })
    return
  }

  if (pathname === '/api/list') {
    refreshReplays()
    return sendJson(res, 200, listData())
  }

  if (pathname === '/api/events') {
    const name = url.searchParams.get('file') ?? ''
    // 只允许 data 目录下的单个文件名，挡掉路径穿越。
    if (!/^[A-Za-z0-9._-]+\.jsonl$/.test(name)) return send(res, 400, '文件名不合法')
    const file = path.join(DATA, name)
    if (!fs.existsSync(file)) return send(res, 404, '没有这个回放文件')
    res.writeHead(200, { 'content-type': TYPES['.jsonl'], 'cache-control': 'no-store' })
    return fs.createReadStream(file).pipe(res)
  }

  const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
  const file = safeJoin(WEB, rel)
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found')
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
})

server.on('error', (err) => {
  console.error(`agent-halo 服务启动失败：${String(err)}`)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  writeTokenFile()
  watchParent()
  console.log(`agent-halo 服务已启动：http://127.0.0.1:${PORT}`)
  console.log(`数据目录：${DATA}`)
  setTimeout(() => refreshReplays(true), 800).unref()
  setInterval(() => refreshReplays(true), 5000).unref() // 5 秒检查一次（只 stat，变了才重生成）
})
