// 把最近的 DSH 会话文件转成独立回放文件，供光环下拉框按会话切换。
// 零依赖；由 bridge/server.mjs 调用，也可单独运行：
//   node bridge/recent-replays.mjs --root "<sessions>" --out-dir data --limit 6

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeDshFile, dshSessionFiles, dshEvents, sortEvents, claudeEvents } from './normalize.mjs'

const REPLAY_PREFIX = 'dsh-'
const cache = new Map()

export function replaySessionId(name) {
  const m = /^dsh-(session-[A-Za-z0-9._-]+)\.jsonl$/.exec(String(name || ''))
  return m ? m[1] : null
}

export function refreshRecentReplays({ root, dataDir, limit = 6 } = {}) {
  if (!root || !fs.existsSync(root)) return { written: 0, skipped: 0, failed: 0, total: 0 }
  const files = dshSessionFiles(root)
    .map((file) => {
      try { return { file, stat: fs.statSync(file) } } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, Math.max(0, Number(limit) || 0))

  let written = 0
  let skipped = 0
  let failed = 0
  for (const { file, stat } of files) {
    const sessionId = path.basename(path.dirname(file))
    if (!/^session-[A-Za-z0-9._-]+$/.test(sessionId)) { failed += 1; continue }
    const outFile = path.join(dataDir, `${REPLAY_PREFIX}${sessionId}.jsonl`)
    const old = cache.get(file)
    // 回放文件的 mtime 被设成源文件 mtime：重启服务后也能判断“源会话有没有继续写”，不依赖内存缓存
    let outM = -1
    try { outM = fs.statSync(outFile).mtimeMs } catch {}
    if ((old && old.size === stat.size && old.mtime === stat.mtimeMs && outM >= 0) || Math.abs(outM - stat.mtimeMs) < 1) {
      skipped += 1
      continue
    }
    try {
      const events = sortEvents(dshEvents(decodeDshFile(file), file))
      if (!events.length) { failed += 1; continue }
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(outFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
      // 用源会话文件的 mtime 排序，确保下拉框按会话真实新旧排列而不是按写文件顺序。
      try { fs.utimesSync(outFile, stat.atime, stat.mtime) } catch {}
      cache.set(file, { size: stat.size, mtime: stat.mtimeMs })
      written += 1
    } catch (err) {
      failed += 1
      console.error(`跳过会话 ${sessionId}：${String(err)}`)
    }
  }
  return { written, skipped, failed, total: files.length }
}

// 已有的任何回放文件（不限最近 6 个、不限 DSH/Claude）：读第一条事件的 ref.file 找到源会话，
// 源文件比回放新（会话又接着做了）就重新生成，保持回放与原会话同步。
export function refreshStaleReplays({ dataDir } = {}) {
  let updated = 0
  if (!dataDir || !fs.existsSync(dataDir)) return { updated }
  for (const name of fs.readdirSync(dataDir)) {
    if (!name.endsWith('.jsonl')) continue
    const out = path.join(dataDir, name)
    try {
      const fd = fs.openSync(out, 'r')
      const buf = Buffer.alloc(4096)
      const n = fs.readSync(fd, buf, 0, 4096, 0)
      fs.closeSync(fd)
      const first = JSON.parse(buf.slice(0, n).toString('utf8').split('\n')[0])
      const src = first && first.ref && first.ref.file
      if (!src || !fs.existsSync(src)) continue
      // 只处理“单一源会话”的回放（合并文件如 dsh-all 的源不止一个，跳过）
      if (/-all\.jsonl$/.test(name)) continue
      const sst = fs.statSync(src)
      const ost = fs.statSync(out)
      if (sst.mtimeMs <= ost.mtimeMs + 1) continue
      const source = first.source === 'claude' ? 'claude' : 'dsh'
      const events = sortEvents(source === 'claude' ? claudeEvents(src) : dshEvents(decodeDshFile(src), src))
      if (!events.length) continue
      fs.writeFileSync(out, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
      try { fs.utimesSync(out, sst.atime, sst.mtime) } catch {}
      updated += 1
    } catch { /* 单个文件失败不影响其他 */ }
  }
  return { updated }
}

function main() {
  const args = process.argv.slice(2)
  const value = (name, fallback) => {
    const i = args.indexOf('--' + name)
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback
  }
  const root = path.resolve(value('root', process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'sessions') : path.join(os.homedir(), '.dsh', 'sessions')))
  const dataDir = path.resolve(value('out-dir', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')))
  const limit = Number(value('limit', '6'))
  const result = refreshRecentReplays({ root, dataDir, limit })
  console.log(JSON.stringify({ root, dataDir, limit, ...result }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
