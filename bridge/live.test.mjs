import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createLiveReader } from './live.mjs'

const frame = (obj) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(obj) + '\n'))
test('只读读取新增帧、处理不完整帧并选择最新会话', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-live-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'one')
  fs.mkdirSync(dir)
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  fs.writeFileSync(file, frame({ type: 'session', id: 'one', createdAt: 100 }))
  const read = createLiveReader(root)
  assert.equal(read().events.length, 1)
  const next = frame({ type: 'turn/start', seq: 1, time: 200, data: { turn: 1 } })
  fs.appendFileSync(file, next.subarray(0, 10))
  assert.equal(read().events.length, 1)
  fs.appendFileSync(file, next.subarray(10))
  assert.equal(read().events.at(-1).kind, 'turn.start')
  const dir2 = path.join(root, 'two')
  fs.mkdirSync(dir2)
  const file2 = path.join(dir2, 'session.v4.jsonl.zstd')
  fs.writeFileSync(file2, frame({ type: 'session', id: 'two', createdAt: 300 }))
  fs.utimesSync(file2, new Date(Date.now() + 1000), new Date(Date.now() + 1000))
  assert.equal(read().events[0].session_id, 'two')
})
