'use strict'
// agent-halo · playback.js — 时间轴、事件应用、播放推进、主循环、面板
// 由原 halo.js 第 567–1159 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

/* ── 时间轴与回放 ───────────────────────────────────────────── */
// 分批解析：每 600 行让出主线程一次，大回放文件加载时不卡画面
async function parseJsonlAsync(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (t) { try { const e = JSON.parse(t); if (e && typeof e === 'object' && Number.isFinite(Number(e.ts))) out.push(e) } catch {} }
    if (i % 600 === 599) await new Promise((r) => setTimeout(r, 0))
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}
function parseJsonl(text) {
  const out = []
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/)
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    try {
      const e = JSON.parse(t)
      if (e && typeof e === 'object' && Number.isFinite(Number(e.ts))) out.push(e)
    } catch { /* 单行坏了不影响整个文件 */ }
  }
  out.sort((a, b) => a.ts - b.ts) // 现代 JS 排序稳定，同 ts 保持文件顺序
  return out
}

function buildTimeline() {
  const evs = state.events
  const pts = new Array(evs.length)
  const gaps = []
  let acc = 0
  for (let i = 0; i < evs.length; i += 1) {
    if (i === 0) { pts[0] = 0; continue }
    const dt = Math.max(0, evs[i].ts - evs[i - 1].ts)
    let used = dt
    if (state.compress && dt > 5000) {
      used = 500 // 超过 5 秒的空白统一快进到 0.5 秒
      gaps.push({ a: evs[i - 1].ts, b: evs[i].ts })
    }
    acc += used
    pts[i] = acc
  }
  state.pts = pts
  state.gaps = gaps
  state.total = acc > 0 ? acc : 1
}

function indexAt(pt) {
  const pts = state.pts
  if (!pts.length) return -1
  let lo = 0
  let hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pts[mid] <= pt) lo = mid
    else hi = mid - 1
  }
  return lo
}

function interpTs(i, pt) {
  const evs = state.events
  if (!evs.length) return 0
  if (i < 0) return evs[0].ts
  if (i >= evs.length - 1) return evs[evs.length - 1].ts
  const a = state.pts[i]
  const b = state.pts[i + 1]
  if (!(b > a)) return evs[i].ts
  const t = clamp((pt - a) / (b - a), 0, 1)
  return evs[i].ts + (evs[i + 1].ts - evs[i].ts) * t
}

function stallSeconds() {
  if (state.pointer < 0 || state.pointer >= state.events.length - 1) return 0
  const base = state.events[state.pointer].ts
  const gap = state.curTs - base
  return gap > 0 ? gap / 1000 : 0
}

function countSatellites() {
  return state.satellites.filter((s) => state.curTs - s.ts < 60000).length
}

function computeTokenRate(i, nowTs) {
  if (i < 0) return 0
  const evs = state.events
  let sum = 0
  let prevTotal = null
  let prevTs = 0
  let guard = 0
  for (let k = i; k >= 0 && guard < 600; k -= 1, guard += 1) {
    const e = evs[k]
    if (nowTs - e.ts > 10000) break
    if (e.kind === 'model.end' && e.tokens) {
      const total = Number(e.tokens.total || 0)
      const out = Number(e.tokens.out || 0)
      // 连续两条完全相同且间隔很短的多为同一帧重复，跳过以免速率虚高。
      if (prevTotal !== null && total === prevTotal && e.ts - prevTs < 2500) { prevTs = e.ts; continue }
      sum += Math.max(0, out)
      prevTotal = total
      prevTs = e.ts
    }
  }
  return Math.round(sum / 10)
}

/* ── 环境状态重建（跳转时间轴时用） ─────────────────────────── */
function resetAmbient() {
  state.phase = 'idle'
  state.phaseStartTs = state.events[0] ? state.events[0].ts : 0
  state.tool = ''
  state.turn = null
  state.step = null
  state.contextRatio = 0
  state.toolStartedAt = null
  state.lastToolCall = null
  state.lastNetByTool.clear()
  state.latestApprovalTs = null
  state.latestErrorTs = null
  state.latestErrorLabel = ''
  state.errorStatusVisible = false
  if (dom.nowError) dom.nowError.hidden = true
  state.satellites = []
  state.notches = []
  state.scars = []
}

function rebuildAmbient(i) {
  resetAmbient()
  if (i < 0) return
  for (let k = 0; k <= i; k += 1) applyEvent(state.events[k], k, { spawn: false, now: 0 })
  const ts = state.curTs
  state.satellites = state.satellites.filter((s) => ts - s.ts < 60000)
  state.notches = state.notches.filter((n) => ts - n.ts < 60000)
  state.scars = state.scars.filter((s) => ts - s.ts < 300000)
}

function addNotch(angle, ts, width) {
  state.notches.push({ angle, ts, width: width || 0.07 })
  if (state.notches.length > 80) state.notches.splice(0, state.notches.length - 80)
}
function addScar(angle, ts) {
  state.scars.push({ angle, ts })
  if (state.scars.length > 120) state.scars.splice(0, state.scars.length - 120)
}

function spawnSweep(key, now) {
  if (!SEG[key]) return
  fx.sweeps.push({ key, start: now, dur: 680 })
}

function spawnApproval(now) {
  fx.approvals.push({ start: now, dur: 10000 })
}

function spawnEcho(angle, now, index) {
  fx.echoes.push({ angle, start: now, dur: 1900, index: index == null ? -1 : index })
  if (fx.echoes.length > 14) fx.echoes.splice(0, fx.echoes.length - 14)
}

function addMarker(angle, index, now) {
  if (index == null || index < 0) return
  fx.markers.push({ angle, index, start: now })
  if (fx.markers.length > 40) fx.markers.splice(0, fx.markers.length - 40)
}

function pushNet(eff) {
  if (eff.demo) fx.demoNets.push(eff)
  else fx.nets.push(eff)
  if (fx.nets.length > 40) fx.nets.splice(0, fx.nets.length - 40)
  if (fx.demoNets.length > 20) fx.demoNets.splice(0, fx.demoNets.length - 20)
}

function spawnNetFromEvent(e, index, now) {
  if (!e.net || typeof e.net !== 'object') return null
  const kind = netKind(e.net.kind)
  const angle = hashAngle(e.event_id)
  const eff = {
    id: e.event_id,
    eventIndex: index,
    angle,
    kind,
    net: e.net,
    start: now,
    dur: (NET_DUR[kind] || 1800) * 2.2, // 网络流停留更久，更容易看到
    failed: isFailureEvent(e),
    demo: false,
  }
  pushNet(eff)
  addMarker(angle, index, now)
  state.lastNetByTool.set(String(e.tool || ''), { fx: eff, ts: e.ts })
  return eff
}

function spawnPulseForEvent(e, index, now) {
  const angle = hashAngle(e.event_id)
  const rgb = phaseRgb(state.phase)
  if (e.kind === 'step.start') {
    fx.pulses.push({ type: 'step', angle, start: now, dur: 1350, rgb, eventIndex: index, demo: false })
    addMarker(angle, index, now)
  } else if (e.kind === 'model.end' || e.kind === 'tool.result') {
    fx.pulses.push({ type: e.kind === 'model.end' ? 'model' : 'result', angle, start: now, dur: e.kind === 'model.end' ? 2600 : 2100, rgb, eventIndex: index, demo: false })
  } else if (e.kind === 'tool.call') {
    fx.pulses.push({
      type: 'tool', angle, start: now, dur: 880, rgb,
      glyph: glyphType(e.tool, e.net), eventIndex: index, demo: false,
    })
    addMarker(angle, index, now)
  }
}

function glyphType(tool, net) {
  if (net && typeof net === 'object') return 'network'
  const t = String(tool || '').toLowerCase()
  if (t.includes('subagent') || t === 'task' || t.includes('agent')) return 'subtask'
  if (t.includes('search') || t === 'grep' || t === 'glob' || t.includes('find')) return 'search'
  if (t.includes('web') || t.includes('fetch') || t.includes('curl') || t.includes('http')) return 'network'
  if (t.includes('write') || t.includes('edit') || t.includes('patch')) return 'write'
  if (t.includes('read') || t.includes('file')) return 'file'
  if (t.includes('pwsh') || t.includes('shell') || t.includes('terminal') || t.includes('bash') || t.includes('powershell')) return 'terminal'
  return 'file'
}

/* ── 单个事件应用（增量或重建共用） ─────────────────────────── */
function applyEvent(e, index, opts) {
  const spawn = !!opts.spawn
  const now = opts.now || 0

  // 跨过一条超过 8 秒的空白：记一次可见的停滞提示。
  // 空白压缩会把 8 秒以上压到 0.5 秒，不保留提示的话等待弧一闪而过。
  if (spawn && index > 0) {
    const prevTs = state.events[index - 1].ts
    const gapMs = e.ts - prevTs
    if (gapMs > 8000) {
      state.stallFlashUntil = now + 2200
      state.stallFlashSeconds = gapMs / 1000
    }
  }

  if (e.phase) {
    const key = phaseKey(e.phase)
    const next = key || 'idle'
    if (next !== (state.phase || 'idle')) {
      state.phase = next
      state.phaseStartTs = e.ts
      if (spawn && key) spawnSweep(key, now)
    }
  }
  if (e.turn != null) state.turn = e.turn
  if (e.step != null) state.step = e.step
  if (e.tool) state.tool = e.tool
  if (e.context && typeof e.context.ratio === 'number' && Number.isFinite(e.context.ratio)) {
    state.contextRatio = e.context.ratio
  }

  if (e.kind === 'subagent.start') {
    state.satellites.push({ angle: hashAngle(e.event_id), ts: e.ts, label: e.label || e.agent_id || '' })
    if (state.satellites.length > 30) state.satellites.splice(0, state.satellites.length - 30)
  }

  if (e.kind === 'approval.request') {
    state.latestApprovalTs = e.ts
    if (spawn) spawnApproval(now)
  }

  if (e.kind === 'step.start' || e.kind === 'turn.start') state.toolStartedAt = null

  // 失败状态跟着事件流走：下一条新的 agent 动作到来才收起，不靠定时器常驻。
  if (state.errorStatusVisible && isAgentActionEvent(e) && !isFailureEvent(e)) hideErrorAlert()

  if (isFailureEvent(e)) {
    const key = String(e.tool || '')
    const prev = state.lastNetByTool.get(key)
    let angle = hashAngle(e.event_id)
    if (prev && Math.abs(e.ts - prev.ts) <= 10000) {
      prev.fx.failed = true
      angle = prev.fx.angle
    }
    addNotch(angle, e.ts, 0.08)
    addScar(angle, e.ts)
    state.latestErrorTs = e.ts
    state.latestErrorLabel = truncate(e.label || e.tool || kindLabel(e.kind), 80)
    state.errorStatusVisible = true
    // 只在新事件推进时刷 DOM 提示；历史回填保持状态卡显示。
    if (spawn && (!state.lastErrorToastAt || now - state.lastErrorToastAt > 1500)) {
      state.lastErrorToastAt = now
      showErrorAlert(state.latestErrorLabel)
    }
  }

  if (e.kind === 'tool.call') {
    state.toolStartedAt = e.ts
    if (spawn && state.lastToolCall && state.lastToolCall.tool === e.tool && e.ts - state.lastToolCall.ts <= 20000) {
      spawnEcho(hashAngle(e.event_id), now, index) // 同工具短时间重复：回声环
    }
    state.lastToolCall = { tool: e.tool, ts: e.ts }
    if (spawn) {
      spawnPulseForEvent(e, index, now)
      if (e.net) spawnNetFromEvent(e, index, now)
    }
  } else if (e.kind === 'tool.result') {
    state.toolStartedAt = null
    if (spawn && e.net) {
      const prev = state.lastNetByTool.get(String(e.tool || ''))
      if (prev && Math.abs(e.ts - prev.ts) <= 10000) {
        if (isFailureEvent(e)) prev.fx.failed = true
      } else {
        spawnNetFromEvent(e, index, now)
      }
    }
  } else if (e.kind === 'step.start' && spawn) {
    spawnPulseForEvent(e, index, now)
  }
  if (spawn) spawnRayPacket(e, index, now)
  if (spawn && (e.kind === 'model.end' || e.kind === 'tool.result')) spawnPulseForEvent(e, index, now)
  // 拖动/跳转时会一次补发大量波纹：只保留最新 24 个，避免满屏同时扩散。
  if (fx.pulses.length > 24) fx.pulses.splice(0, fx.pulses.length - 24)
}

// 光线上的光包 = 一次真实事件的到来：
//   工具调用/返回 → 沿“同一工具”的所有现存光线各跑一个光包（这个工具又被用了一次）；
//   模型输出     → 沿“同一模型”的所有现存光线各跑一个光包（这个模型又产出了一次）。
// 没有事件就没有光包；光包亮度/速度由触发它的那次事件的数值决定。
function rayKey(e) {
  if (!e) return null
  if (e.kind === 'tool.call' || e.kind === 'tool.result') return 'tool:' + String(e.tool || '')
  if (e.kind === 'model.end') return 'model:' + String(e.label || '')
  if (e.kind === 'user.message') return 'user'
  if (e.kind === 'subagent.start') return 'sub'
  if (e.kind === 'approval.request') return 'approval'
  if (e.kind === 'error') return 'error'
  return null
}
function rayLevel(e) {
  if (e.kind === 'tool.result' && Number(e.duration_ms) > 0) return clamp(Math.log10(1 + Number(e.duration_ms)) / Math.log10(1 + 60000), 0, 1)
  if (e.kind === 'model.end' && e.tokens && Number(e.tokens.out) > 0) return clamp(Math.log10(1 + Number(e.tokens.out)) / Math.log10(1 + 8000), 0, 1)
  return 0
}
function spawnRayPacket(e, index, now) {
  const key = rayKey(e)
  if (!key) return
  const lvl = rayLevel(e)
  // 调用本身没有数值：给一个固定的中等强度，表示“发起”。
  const power = e.kind === 'tool.call' ? 0.45 : e.kind === 'tool.result' || e.kind === 'model.end' ? 0.35 + 0.65 * lvl : 0.6
  fx.rayPackets.push({ key, index, ts: e.ts, start: now, dur: 1500 - 500 * lvl, power })
  if (fx.rayPackets.length > 80) fx.rayPackets.splice(0, fx.rayPackets.length - 80)
}

/* ── 清理 ───────────────────────────────────────────────────── */
function clearTransient() {
  fx.pulses = fx.pulses.filter((p) => p.demo)
  fx.echoes = []
  fx.sweeps = []
  fx.nets = []
  fx.markers = []
  fx.approvals = []
  fx.dust = []
  fx.brainSignals = []
  fx.brainFlashes = []
  fx.rayPackets = []
  state.stallFlashUntil = 0
  state.stallFlashSeconds = 0
}

function pruneFx(now) {
  const ts = state.curTs
  fx.pulses = fx.pulses.filter((p) => now - p.start < p.dur)
  fx.echoes = fx.echoes.filter((p) => now - p.start < p.dur)
  fx.sweeps = fx.sweeps.filter((p) => now - p.start < p.dur)
  fx.markers = fx.markers.filter((m) => now - m.start < 9000)
  fx.nets = fx.nets.filter((n) => now - n.start < n.dur + 700)
  fx.approvals = fx.approvals.filter((a) => now - a.start < a.dur)
  fx.dust = fx.dust.filter((d) => now - d.start < d.life)
  fx.brainSignals = fx.brainSignals.filter((s) => now - s.start < s.dur)
  fx.rayPackets = fx.rayPackets.filter((p) => now - p.start < p.dur)
  fx.brainFlashes = fx.brainFlashes.filter((f) => now - f.start < f.dur)
  fx.demoNets = fx.demoNets.filter((n) => now - n.start < n.dur + 400)
  fx.demoNotches = fx.demoNotches.filter((n) => now - n.start < n.dur)
  fx.demoScars = fx.demoScars.filter((n) => now - n.start < n.dur)
  fx.demoApprovals = fx.demoApprovals.filter((a) => now - a.start < a.dur)
  state.satellites = state.satellites.filter((s) => ts - s.ts < 60000)
  state.notches = state.notches.filter((n) => ts - n.ts < 60000)
  state.scars = state.scars.filter((s) => ts - s.ts < 300000)
}

/* ── 播放推进 ───────────────────────────────────────────────── */
function advanceTo(now) {
  const idx = indexAt(state.pt)
  if (idx < 0) return
  if (idx > state.pointer) {
    const crossed = idx - state.pointer
    const prev = state.pointer
    for (let k = state.pointer + 1; k <= idx; k += 1) {
      const e = state.events[k]
      // 高速跳跃时不要一次点亮几百个脉冲，只保留最近与关键事件。
      const allow = crossed <= 20 || k > idx - 8 || !!e.net ||
        e.kind === 'approval.request' || isFailureEvent(e)
      applyEvent(e, k, { spawn: allow, now })
    }
    state.pointer = idx
    state.curTs = interpTs(idx, state.pt)
    // 神经网信号：事件跨过指针时，沿真实关系边传播一次。
    emitBrainSignals(Math.max(prev + 1, idx - 3), idx, now)
    syncListHighlight()
  } else if (idx < state.pointer) {
    state.pointer = idx
    state.curTs = interpTs(idx, state.pt)
    rebuildAmbient(idx)
    clearTransient()
    // 往回拖/拖时间轴：补发当前位置附近的动效（每 120ms 最多一次）
    { const tNow = performance.now(); if (tNow - (state.lastScrubFx || 0) > 120) { replayRecentFx(idx); state.lastScrubFx = tNow } }
    state.forceDraw = true
    syncListHighlight()
  } else {
    state.curTs = interpTs(idx, state.pt)
  }
}

function seekToEvent(i) {
  if (!state.events.length) return
  const idx = clamp(i, 0, state.events.length - 1)
  state.pointer = idx
  state.pt = state.pts[idx] || 0
  state.curTs = state.events[idx].ts
  rebuildAmbient(idx)
  state.forceDraw = true
  clearTransient()
  replayRecentFx(idx)
  syncListHighlight()
  updatePanel()
  syncSlider()
}

// 跳转后重新触发目标事件附近的瞬时动效（光柱光包、环外波纹、网络流线、织网传导），
// 否则跳到某一轮时画面是“静止”的。补目标及之前最多 6 个事件（不限时间），用户输入发白色波。
function replayRecentFx(idx) {
  // 暂停状态下动画时钟不走：把补发的动效“拨到”进行中的那一帧，冻结画面里也能看到
  const shift = !state.playing
  const now = state.animNow
  const mark = { p: fx.pulses.length, n: fx.nets.length, s: fx.brainSignals.length, k: fx.rayPackets.length }
  const tsEnd = state.events[idx].ts
  let n = 0
  for (let i = idx; i >= 0 && n < 6; i -= 1) {
    const e = state.events[i]
    try {
      if (e.kind === 'tool.call' || e.kind === 'step.start' || e.kind === 'model.end' || e.kind === 'tool.result') spawnPulseForEvent(e, i, now)
      if (e.net && (e.kind === 'tool.call' || e.kind === 'tool.result')) spawnNetFromEvent(e, i, now)
      if (e.kind === 'user.message') fx.pulses.push({ type: 'user', angle: hashAngle(e.event_id), start: now, dur: 2400, rgb: '255,255,255', eventIndex: i, demo: false })
      spawnRayPacket(e, i, now)
    } catch {}
    n += 1
  }
  try { emitBrainSignals(Math.max(0, idx - 2), idx, now) } catch {}
  if (shift) {
    for (const p of fx.pulses.slice(mark.p)) p.start = state.animNow - p.dur * 0.4
    for (const n of fx.nets.slice(mark.n)) n.start = state.animNow - (n.dur || 1800) * 0.4
    for (const g of fx.brainSignals.slice(mark.s)) g.start = state.animNow - g.dur * 0.5
    for (const k of fx.rayPackets.slice(mark.k)) k.start = state.animNow - k.dur * 0.4
  }
}

function seekToPt(pt) {
  if (!state.events.length) return
  state.pt = clamp(pt, 0, state.total)
  const idx = indexAt(state.pt)
  if (idx !== state.pointer) {
    state.pointer = idx
    state.curTs = interpTs(idx, state.pt)
    rebuildAmbient(idx)
    clearTransient()
    // 往回拖/拖时间轴：补发当前位置附近的动效（每 120ms 最多一次）
    { const tNow = performance.now(); if (tNow - (state.lastScrubFx || 0) > 120) { replayRecentFx(idx); state.lastScrubFx = tNow } }
    state.forceDraw = true
    syncListHighlight()
  } else {
    state.curTs = interpTs(idx, state.pt)
  }
  updatePanel()
  syncSlider()
}

function syncPlayBtn() {
  dom.playBtn.textContent = LANG === 'en' ? (state.playing ? 'PAUSE' : 'PLAY') : (state.playing ? '暂停' : '播放')
  dom.playBtn.setAttribute('aria-pressed', state.playing ? 'true' : 'false')
}

function togglePlay() {
  if (state.live) {
    state.playing = !state.playing
    if (state.playing && state.events.length) {
      seekToEvent(state.events.length - 1)
      state.selected = -1
      syncSelectedClass()
      clearDetails()
    }
    syncPlayBtn()
    return
  }
  if (!state.events.length) return
  if (!state.playing && state.pt >= state.total - 0.5) {
    state.playing = false
    seekToEvent(0)
    state.playing = true
    syncPlayBtn()
    return
  }
  state.playing = !state.playing
  syncPlayBtn()
  updatePanel()
}

function stepBy(delta) {
  if (!state.events.length) return
  const base = state.pointer < 0 ? 0 : state.pointer
  const idx = clamp(base + delta, 0, state.events.length - 1)
  state.playing = false
  syncPlayBtn()
  seekToEvent(idx)
  selectEvent(idx)
}

function goNextAnomaly() {
  const n = state.events.length
  if (!n) return
  const start = state.pointer < 0 ? -1 : state.pointer
  for (let off = 1; off <= n; off += 1) {
    const i = ((start + off) % n + n) % n
    if (isAnomaly(state.events[i])) {
      state.playing = false
      syncPlayBtn()
      seekToEvent(i)
      selectEvent(i)
      showToast(i <= start ? '已回到最早的异常' : '下一个异常')
      return
    }
  }
  showToast('这个回放里没有异常事件')
}

/* ── 主循环 ─────────────────────────────────────────────────── */
function frame(now) {
  const dt = Math.min(Math.max(0, now - state.lastNow), 100)
  state.lastNow = now

  // 动画时钟只在回放推进时走动：暂停 = 画面完全静止，不是空转。
  if (state.playing || state.scrubbing) state.animNow += dt
  const anow = state.animNow

  if (state.playing && state.events.length && !state.live) {
    state.pt = Math.min(state.pt + dt * state.speed, state.total)
    advanceTo(anow)
    if (state.pt >= state.total - 0.01) {
      state.pt = state.total
      state.playing = false
      syncPlayBtn()
    }
  }

  pruneFx(anow)

  if (now - state.lastPanel > 130) {
    state.tokenRate = computeTokenRate(state.pointer, state.curTs)
    // 暂停时读数也冻结（原来会继续缓动几百毫秒，导致暂停后右下大数字还在变）。
    if (state.playing || state.scrubbing || state.live) state.tokenRateShown += (state.tokenRate - state.tokenRateShown) * 0.16
    updatePanel()
    if (!state.scrubbing) syncSlider()
    state.lastPanel = now
  }

  // 限帧（性能）：播放/拖动时主画面 30fps、遥测台 10fps；暂停时画面本就静止，只低频刷新（响应点选/悬停）。
  const active = state.playing || state.scrubbing || state.live || state.rehearsal.active
  // 遥测台八格轮流画：每帧只画一格（约 15fps/格 @120Hz），避免某一帧同时画八格造成卡顿尖峰。
  // 播放/暂停切换时整台重画一次，保证暂停画面是完整一致的一帧
  if (state.playing !== state.lastPlaying) { state.lastPlaying = state.playing; state.forceDraw = true }
  if (state.forceDraw) { drawDeck(anow); state.lastDeck = now }
  else if (now - (state.lastDeck || 0) > (active ? 8 : 250)) { drawDeckOne(anow); state.lastDeck = now }
  // 自适应：一帧画得快（<12ms）就每帧都画（60fps）；画不动才降到 30fps。
  // 播放时不限帧（跟随显示器刷新率，120Hz 屏即 120fps）；只有单帧超过 20ms 才降到 30fps 保护机器。
  // 画面占满主线程时，原生下拉框/按钮会卡：
  //  · 有表单控件处于焦点（如正在选速度）→ 降到约 20fps 把主线程让给界面；
  //  · 单帧 > 8ms（跟不上 120Hz）→ 限 60fps；> 20ms → 30fps。
  const uiBusy = document.activeElement && document.activeElement.tagName === 'SELECT'
  const cost = state.drawCost || 0
  // 暂停时为了呼吸摆动仍保持约 30fps（巨环才需要）。
  const minGap = !active ? (W >= 760 ? 33 : 250) : uiBusy ? 50 : cost < 8 ? 0 : cost < 20 ? 15 : 32
  if (now - (state.lastDraw || 0) >= minGap || state.forceDraw) {
    const t0 = performance.now()
    draw(anow)
    if (window.__haloApi) for (const f of window.__haloApi.hooks.afterDraw) { try { f(anow) } catch {} }
    state.drawCost = (state.drawCost || 0) * 0.9 + (performance.now() - t0) * 0.1
    state.lastDraw = now
    state.forceDraw = false
  }

  requestAnimationFrame(frame)
}

/* ── 面板与列表 ─────────────────────────────────────────────── */
function updatePanel() {
  const ph = state.phase || 'idle'
  dom.phaseText.textContent = phaseName(ph)
  dom.phaseText.dataset.phase = ph
  dom.toolText.textContent = state.tool || '—'
  dom.tokenRate.textContent = String(Math.round(state.tokenRateShown || 0))
  const ratio = Number(state.contextRatio)
  dom.contextPct.textContent = Number.isFinite(ratio) && ratio > 0 ? `${Math.round(ratio * 100)}%` : '0%'
  dom.stepText.textContent = (state.turn != null || state.step != null)
    ? `${state.turn != null ? state.turn : '—'}/${state.step != null ? state.step : '—'}`
    : '—'
  dom.subagentText.textContent = String(countSatellites())
  dom.clockText.textContent = fmtClock(state.curTs)
  if (dom.topClock) dom.topClock.textContent = fmtClock(state.curTs)
}

// 时间轴缩放：state.zoom = { lo, hi }（占全程比例）。滑块只映射这一段；滚轮缩放、双击复位。
function zoomRange() { const z = state.zoom || { lo: 0, hi: 1 }; return [z.lo, Math.max(z.lo + 1e-4, z.hi)] }
function syncSlider() {
  const [lo, hi] = zoomRange()
  const f = state.total > 0 ? state.pt / state.total : 0
  // 回放走出缩放窗口时窗口跟着平移
  if (state.zoom && (f < lo || f > hi)) { const w = hi - lo; const nlo = clamp(f - w * 0.1, 0, 1 - w); state.zoom = { lo: nlo, hi: nlo + w } }
  const [lo2, hi2] = zoomRange()
  const v = Math.round(((f - lo2) / (hi2 - lo2)) * 1000)
  dom.timeline.value = String(clamp(v, 0, 1000))
}

