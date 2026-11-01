#!/usr/bin/env node
// 把 Claude Code 或 DSH 的原始会话，归一化成渲染层唯一依赖的事件流。
//
// 用法：
//   node bridge/normalize.mjs --source claude --file <transcript.jsonl> --out data\claude.jsonl
//   node bridge/normalize.mjs --source dsh --file <session.v4.jsonl.zstd> --out data\dsh.jsonl
//   node bridge/normalize.mjs --source dsh --root <sessions 目录> --out data\dsh-all.jsonl
//
// 设计原则：
//   1. 渲染层不碰原始日志；这里只输出契约字段和截断后的 label。
//   2. 不猜「计划/验证/修复」这类 DSH 没有的相位；只标确定态：模型 / 工具 / 等人。
//   3. 每个事件都带 ref，视觉元素以后可以点回原始日志行。

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { classifyNetwork } from './net-classify.mjs'

const CLAUDE_CONTEXT_WINDOW = 200000
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

function parseArgs(argv) {
  const opt = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) opt[key] = true
    else { opt[key] = next; i += 1 }
  }
  return opt
}

function fail(msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

// 只保留能帮人认出「这一步在干什么」的片段，并清掉常见凭据形态。
function scrub(value, max = 80) {
  let s = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/(?:sk|ak|ghp|github_pat)_[A-Za-z0-9_-]{12,}/g, '<凭据>')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer <凭据>')
    .replace(/(SESSDATA|bili_jct|buvid3)=([^;,\s]+)/gi, '$1=<凭据>')
    .trim()
  if (s.length > max) s = s.slice(0, max) + '…'
  return s
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

function toolLabel(name, input) {
  if (!input || typeof input !== 'object') return ''
  const order = ['description', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'objective', 'prompt', 'label']
  for (const k of order) {
    if (typeof input[k] === 'string' && input[k].trim()) return scrub(input[k], 90)
  }
  return ''
}

function wantsApproval(name, input) {
  if (!input || typeof input !== 'object') return false
  if (input.dangerouslyDisableSandbox === true) return true
  if (String(input.sandbox_permissions ?? '') === 'require_escalated') return true
  return false
}

// ── DSH：多帧 zstd ────────────────────────────────────────────────
// session.v4.jsonl.zstd 是逐条追加的多个 zstd 帧；Node 的 zstdDecompressSync
// 一次只解第一帧。这里按魔数逐帧解，并用「解压结果必须是 JSONL」过滤假魔数。
function decodeDshFile(file) {
  const buf = fs.readFileSync(file)
  if (!file.endsWith('.zstd')) return buf.toString('utf8')
  const offsets = []
  for (let i = 0; i + 3 < buf.length; i += 1) {
    if (ZSTD_MAGIC.every((b, k) => buf[i + k] === b)) offsets.push(i)
  }
  const chunks = []
  for (const off of offsets) {
    let text
    try { text = zlib.zstdDecompressSync(buf.subarray(off)).toString('utf8') } catch { continue }
    if (/^\s*\{\s*"type"\s*:/.test(text)) chunks.push(text)
  }
  return chunks.join('\n')
}

function dshSessionFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/^session\.v\d+\.jsonl\.zstd$/.test(ent.name)) out.push(p)
    }
  }
  walk(root)
  return out
}

// 有状态地逐条归一化 DSH 事件；文件回放（dshEvents）与实时插件共用同一套映射，
// 避免实时和回放对同一条原始事件产生不同画面。
function createDshNormalizer(initial = {}) {
  const state = {
    sessionId: String(initial.sessionId ?? initial.id ?? ''),
    contextWindow: Number(initial.contextWindow) > 0 ? Number(initial.contextWindow) : null,
    cwd: initial.cwd ? String(initial.cwd) : null,
    calls: new Map(),
  }

  function normalize(o, refFile = '') {
    const events = []
    if (!o || typeof o.type !== 'string') return events

    const ts = Number(o.time ?? initial.createdAt ?? 0)
    const seq = Number(o.seq ?? 0)
    const d = o.data ?? {}
    const ref = { file: refFile, seq }

    const push = (e) => {
      if (!e.ts) return
      events.push({
        v: 1,
        source: 'dsh',
        session_id: state.sessionId,
        agent_id: 'main',
        parent_id: null,
        ...e,
      })
    }

    switch (o.type) {
      case 'session':
        state.sessionId = String(o.id ?? state.sessionId)
        state.cwd = String(o.cwd ?? '') || null
        push({ event_id: `dsh:${state.sessionId}:${seq}`, ts: Number(o.createdAt ?? ts), kind: 'session.start', phase: 'idle', ref })
        break
      case 'turn/start':
        push({ event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, kind: 'turn.start', phase: 'model', ref })
        break
      case 'turn/end':
        push({ event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, kind: 'turn.end', phase: 'idle', status: d.reason?.kind === 'error' ? 'error' : 'ok', ref })
        break
      case 'step/start':
        push({ event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, step: d.step, kind: 'step.start', phase: 'model', ref })
        break
      case 'step/end':
        push({ event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, step: d.step, kind: 'step.end', phase: 'model', ref })
        break
      case 'request/context':
        if (Number(d.contextWindow) > 0) state.contextWindow = Number(d.contextWindow)
        push({
          event_id: `dsh:${state.sessionId}:${seq}`, ts, kind: 'context.update', phase: 'model',
          context: { used: null, window: state.contextWindow, ratio: null }, ref,
        })
        break
      case 'assistant/message': {
        const usage = d.usage ?? {}
        const total = Number(usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)))
        const used = Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0)
        const stream = Array.isArray(d.stream) ? d.stream : []
        const times = stream.map((s) => Number(s.time ?? s.time0 ?? 0)).filter((n) => n > 0)
        const duration = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0
        const model = d.message?.source?.model ?? d.message?.source?.responseModel ?? ''
        const ctxRatio = state.contextWindow ? Math.min(1, used / state.contextWindow) : null
        push({
          event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, step: d.step,
          kind: 'model.end', phase: 'model', status: 'ok', duration_ms: duration,
          tokens: {
            in: Number(usage.inputTokens ?? 0),
            out: Number(usage.outputTokens ?? 0),
            cache_read: Number(usage.cacheReadTokens ?? 0),
            total,
          },
          context: state.contextWindow ? { used, window: state.contextWindow, ratio: ctxRatio } : undefined,
          label: scrub(model, 60),
          ref,
        })
        break
      }
      case 'assistant/attempt': {
        const finish = (d.stream ?? []).map((s) => s.chunk).find((c) => c?.type === 'finish')
        if (finish?.reason?.kind === 'error') {
          push({
            event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, step: d.step,
            kind: 'error', phase: 'model', status: 'error',
            label: scrub(finish.reason.failure?.message ?? finish.reason.failure?.code ?? '模型请求失败', 90),
            ref,
          })
        }
        break
      }
      case 'tool/call': {
        const input = typeof d.arguments === 'string' ? parseJson(d.arguments) : d.arguments
        const callId = String(d.callId ?? '')
        const label = toolLabel(d.name, input)
        const net = classifyNetwork(d.name, input)
        state.calls.set(callId, { ts, name: d.name, label, net })
        if (wantsApproval(d.name, input)) {
          push({
            event_id: `dsh:${state.sessionId}:${seq}:approval`, ts, turn: d.turn, step: d.step,
            kind: 'approval.request', phase: 'waiting_user', status: 'running',
            tool: d.name, label: label || '需要确认的高权限动作', ref,
          })
        }
        push({
          event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, step: d.step,
          kind: 'tool.call', phase: 'tool', status: 'running',
          tool: d.name, label, ...(net ? { net } : {}), ref,
        })
        break
      }
      case 'tool/result': {
        const callId = String(d.message?.toolCallId ?? d.toolCallId ?? '')
        const call = state.calls.get(callId)
        push({
          event_id: `dsh:${state.sessionId}:${seq}`, ts, turn: d.turn, step: d.step,
          kind: 'tool.result', phase: 'tool',
          status: d.message?.isError ? 'error' : 'ok',
          duration_ms: call ? Math.max(0, ts - call.ts) : undefined,
          tool: call?.name, label: call?.label ?? '',
          ...(call?.net ? { net: call.net } : {}),
          ref,
        })
        break
      }
      case 'subagent/descriptor':
      case 'subagent/catalog':
        push({
          event_id: `dsh:${state.sessionId}:${seq}`, ts, kind: 'subagent.start', phase: 'model',
          label: scrub(d.label ?? d.childId ?? '子任务', 60),
          agent_id: String(d.childId ?? d.label ?? 'subagent'),
          ref,
        })
        break
      case 'user/message':
        push({ event_id: `dsh:${state.sessionId}:${seq}`, ts, kind: 'user.message', phase: 'model', label: '用户输入', ref })
        break
      default:
        break
    }

    return events
  }

  return { normalize, state }
}

function dshEvents(text, file) {
  const normalizer = createDshNormalizer({ sessionId: path.basename(path.dirname(file)) })
  const events = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const o = parseJson(line)
    if (!o || typeof o.type !== 'string') continue
    events.push(...normalizer.normalize(o, file))
  }
  return events
}

// ── Claude Code：原生 JSONL ──────────────────────────────────────
function claudeEvents(file) {
  const events = []
  const calls = new Map()
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  let sessionId = path.basename(file, '.jsonl')

  const push = (e) => {
    if (!e.ts) return
    events.push({ v: 1, source: 'claude', session_id: sessionId, agent_id: 'main', parent_id: null, ...e })
  }

  lines.forEach((line, index) => {
    if (!line.trim()) return
    const o = parseJson(line)
    if (!o) return
    if (o.sessionId) sessionId = String(o.sessionId)
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0
    const ref = { file, line: index + 1 }
    const agentId = o.agentId ?? (o.isSidechain ? 'sidechain' : 'main')
    const content = o.message?.content

    if (o.type === 'user') {
      if (typeof content === 'string') {
        push({ event_id: `claude:${o.uuid ?? index + 1}`, ts, kind: 'user.message', phase: 'model', agent_id: agentId, label: '用户输入', ref })
        return
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type !== 'tool_result') continue
        const callId = String(block.tool_use_id ?? '')
        const call = calls.get(callId)
        push({
          event_id: `claude:${o.uuid ?? index + 1}:${callId}`, ts, kind: 'tool.result', phase: 'tool',
          status: block.is_error ? 'error' : 'ok', agent_id: agentId,
          duration_ms: call ? Math.max(0, ts - call.ts) : undefined,
          tool: call?.name ?? '', label: call?.label ?? '', ...(call?.net ? { net: call.net } : {}), ref,
        })
      }
      return
    }

    if (o.type !== 'assistant') return
    const blocks = Array.isArray(content) ? content : []
    const usage = o.message?.usage ?? {}
    const inputTokens = Number(usage.input_tokens ?? 0)
    const outputTokens = Number(usage.output_tokens ?? 0)
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0)
    const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0)
    const used = inputTokens + outputTokens + cacheRead + cacheCreate

    // 一条 assistant 记录就是一个模型步；先给一次模型脉冲，再挂它的工具调用。
    push({
      event_id: `claude:${o.uuid ?? index + 1}:model`, ts, kind: 'model.end', phase: 'model', status: 'ok',
      agent_id: agentId,
      tokens: { in: inputTokens, out: outputTokens, cache_read: cacheRead, total: used },
      context: { used, window: CLAUDE_CONTEXT_WINDOW, ratio: Math.min(1, used / CLAUDE_CONTEXT_WINDOW) },
      label: scrub(o.message?.model ?? '', 60), ref,
    })

    for (const block of blocks) {
      if (block.type !== 'tool_use') continue
      const callId = String(block.id ?? '')
      const input = block.input ?? {}
      const label = toolLabel(block.name, input)
      // Claude 源同样做网络分类（原来只有 DSH 源接了，导致 Claude 回放里 NET ROUTE 永远为 0）。
      const net = classifyNetwork(block.name, input)
      calls.set(callId, { ts, name: block.name, label, net })
      if (wantsApproval(block.name, input)) {
        push({
          event_id: `claude:${o.uuid ?? index + 1}:${callId}:approval`, ts, kind: 'approval.request',
          phase: 'waiting_user', status: 'running', agent_id: agentId,
          tool: block.name, label: label || '需要确认的高权限动作', ref,
        })
      }
      push({
        event_id: `claude:${o.uuid ?? index + 1}:${callId}`, ts, kind: 'tool.call', phase: 'tool',
        status: 'running', agent_id: agentId, tool: block.name, label, ...(net ? { net } : {}), ref,
      })
    }
  })

  return events
}

function claudeFiles(root) {
  return fs.readdirSync(root)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(root, name))
}

function sortEvents(events) {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.ts - b.e.ts) || (a.i - b.i))
    .map(({ e }) => e)
}

function main() {
  const opt = parseArgs(process.argv.slice(2))
  const source = String(opt.source ?? '')
  if (!['claude', 'dsh'].includes(source)) fail('--source 必须是 claude 或 dsh')

  let files = []
  if (opt.file) files = [path.resolve(String(opt.file))]
  else if (opt.root) {
    const root = path.resolve(String(opt.root))
    if (!fs.existsSync(root)) fail('目录不存在：' + root)
    files = source === 'dsh' ? dshSessionFiles(root) : claudeFiles(root)
  } else fail('需要 --file 或 --root')
  if (!files.length) fail('没有找到可读的会话文件')

  let events = []
  for (const file of files) {
    if (source === 'dsh') events = events.concat(dshEvents(decodeDshFile(file), file))
    else events = events.concat(claudeEvents(file))
  }
  events = sortEvents(events)

  const out = opt.out ? path.resolve(String(opt.out)) : null
  const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, text, 'utf8')
    console.error(`✓ ${source}：${files.length} 个文件 → ${events.length} 个事件`)
    console.error('  ' + out)
  } else {
    process.stdout.write(text)
    console.error(`✓ ${source}：${files.length} 个文件 → ${events.length} 个事件`)
  }
}

export { decodeDshFile, dshSessionFiles, dshEvents, createDshNormalizer, sortEvents, claudeEvents }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
