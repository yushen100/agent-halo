// 只读轮询 DSH 会话；未完成的压缩帧保留上次成功读取的结果。
import fs from 'node:fs'
import { decodeDshFile, dshSessionFiles, dshEvents, sortEvents } from './normalize.mjs'

export function createLiveReader(root) {
  const cache = new Map()
  return function read() {
    if (!fs.existsSync(root)) return { status: 'missing', events: [] }
    let files
    try { files = dshSessionFiles(root) } catch { return { status: 'error', events: [] } }
    const present = new Set(files)
    for (const file of cache.keys()) if (!present.has(file)) cache.delete(file)
    let failed = false
    for (const file of files) {
      try {
        const stat = fs.statSync(file)
        const old = cache.get(file)
        if (old && old.size === stat.size && old.mtime === stat.mtimeMs) continue
        const text = decodeDshFile(file)
        const events = sortEvents(dshEvents(text, file))
        // 追加期间可能读到不完整帧；不让快照倒退。
        if (old && stat.size >= old.size && events.length < old.events.length) { failed = true; continue }
        if (!events.length && stat.size) { failed = true; continue }
        cache.set(file, { size: stat.size, mtime: stat.mtimeMs, events })
      } catch { failed = true }
    }
    const candidates = [...cache.values()].filter((item) => item.events.length)
    candidates.sort((a, b) => b.mtime - a.mtime || b.events.at(-1).ts - a.events.at(-1).ts)
    return { status: failed ? 'partial' : 'ok', events: candidates[0]?.events || [] }
  }
}
