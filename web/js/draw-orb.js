'use strict'
// agent-halo · draw-orb.js — 绘制基础、背景、神经网/织网
// 由原 halo.js 第 1728–2624 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

/* ── 绘制基础 ───────────────────────────────────────────────── */
function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

function setUiFont(px, weight) {
  ctx.font = `${weight || 500} ${px}px ${FONT_UI}`
}
function setMonoFont(px, weight) {
  ctx.font = `${weight || 500} ${px}px ${FONT_MONO}`
}

function activeNotches(now) {
  const ts = state.curTs
  const list = []
  for (const n of state.notches) if (ts - n.ts < 60000) list.push(n)
  for (const n of fx.demoNotches) if (now - n.start < n.dur) list.push(n)
  return list
}

function activeScars(now) {
  const ts = state.curTs
  const list = []
  for (const s of state.scars) {
    const age = ts - s.ts
    if (age >= 0 && age < 300000) list.push({ angle: s.angle, alpha: 0.16 * (1 - age / 300000) })
  }
  for (const s of fx.demoScars) {
    if (now - s.start < s.dur) list.push({ angle: s.angle, alpha: 0.16 * (1 - (now - s.start) / s.dur) })
  }
  return list
}

function subtractCuts(span, cuts) {
  let segs = [[0, span]]
  for (const cut of cuts) {
    const cs = Math.max(0, cut[0])
    const ce = Math.min(span, cut[1])
    if (ce <= cs) continue
    const next = []
    for (const s of segs) {
      if (ce <= s[0] || cs >= s[1]) { next.push(s); continue }
      if (cs > s[0]) next.push([s[0], cs])
      if (ce < s[1]) next.push([ce, s[1]])
    }
    segs = next
  }
  return segs.filter((s) => s[1] - s[0] > 0.006)
}

function notchCuts(start, span, notches) {
  const cuts = []
  for (const n of notches) {
    const rel = ((n.angle - start) % TAU + TAU) % TAU
    if (rel < span) {
      const half = (n.width || 0.07) / 2
      cuts.push([rel - half, rel + half])
    }
  }
  return cuts
}

/* ── 背景 ───────────────────────────────────────────────────── */
// 稳定伪随机：同一序号每帧都落在同一位置，不会闪烁。
function ambient01(i, salt) {
  const x = Math.sin((i + 1) * 127.1 + (salt || 0) * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// 背景层与时间无关：按尺寸/布局缓存到离屏画布，之后每帧一次 drawImage。
const backdropCache = { key: '', cv: null }
function drawBackdropCached(view, now) {
  const key = `${W}x${H}@${DPR}|${Math.round(view.cx)}|${Math.round(view.cy)}|${Math.round(view.R)}|${view.deckH}`
  if (backdropCache.key !== key) {
    const cv = document.createElement('canvas')
    cv.width = Math.round(W * DPR)
    cv.height = Math.round(H * DPR)
    const saved = ctx
    const off = cv.getContext('2d')
    off.setTransform(DPR, 0, 0, DPR, 0, 0)
    ctx = off
    try { drawBackdrop(view, now) } finally { ctx = saved }
    backdropCache.key = key
    backdropCache.cv = cv
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(backdropCache.cv, 0, 0)
  ctx.restore()
}
function drawBackdrop(view, now) {
  // 巨环模式：纯黑底，不要任何灰色雾/网格（用户要求全面提升对比度）。
  if (view.big) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return }
  const { cx, cy, R } = view
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, W, H)

  // 顶部天光：深空舱内的冷色反光，避免整块纯黑。
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, 'rgba(26,27,29,0.20)')
  sky.addColorStop(0.30, 'rgba(11,11,12,0.10)')
  sky.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  // 中心冷光辉光：强度跟真实产出走，空闲时几乎不可见。
  const energy = neuralEnergy()
  const g0 = 0.055 + 0.10 * energy
  const g = ctx.createRadialGradient(cx, cy, R * 0.04, cx, cy, R * 2.05)
  g.addColorStop(0, `rgba(184,188,192,${g0})`)
  g.addColorStop(0.40, `rgba(140,145,150,${g0 * 0.42})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // 发丝网格：每 4 格一条主刻线，只做空间参考。
  ctx.save()
  ctx.lineWidth = 1
  const step = 48
  ctx.beginPath()
  let col = 0
  for (let x = (W / 2) % step; x < W; x += step, col += 1) {
    if (col % 4 === 0) continue
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, H)
  }
  let row = 0
  for (let y = (H / 2) % step; y < H; y += step, row += 1) {
    if (row % 4 === 0) continue
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(W, Math.round(y) + 0.5)
  }
  ctx.strokeStyle = 'rgba(150,154,158,0.035)'
  ctx.stroke()
  ctx.beginPath()
  col = 0
  for (let x = (W / 2) % step; x < W; x += step, col += 1) {
    if (col % 4 !== 0) continue
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, H)
  }
  row = 0
  for (let y = (H / 2) % step; y < H; y += step, row += 1) {
    if (row % 4 !== 0) continue
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(W, Math.round(y) + 0.5)
  }
  ctx.strokeStyle = 'rgba(190,194,198,0.060)'
  ctx.stroke()
  ctx.restore()

  // 同心参考弧 + 十字轴：把画面钉在坐标系里。
  ctx.save()
  for (const [rr, a] of [[R * 0.55, 0.05], [R * 0.82, 0.06], [R * 1.26, 0.045]]) {
    ctx.beginPath()
    ctx.arc(cx, cy, rr, 0, TAU)
    ctx.strokeStyle = `rgba(190,194,198,${a})`
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.44, 0, TAU)
  ctx.setLineDash([2, 12])
  // 虚线相位跟着环的自转角走：静止时冻结，播放时缓慢流动。
  ctx.lineDashOffset = -ringSpin() * R * 1.44
  ctx.strokeStyle = 'rgba(190,194,198,0.05)'
  ctx.stroke()
  ctx.setLineDash([1, 9])
  ctx.strokeStyle = 'rgba(190,194,198,0.07)'
  ctx.beginPath()
  ctx.moveTo(0, Math.round(cy) + 0.5)
  ctx.lineTo(W, Math.round(cy) + 0.5)
  ctx.moveTo(Math.round(cx) + 0.5, 0)
  ctx.lineTo(Math.round(cx) + 0.5, H)
  ctx.stroke()
  ctx.restore()

  // 横向光带：固定位置，冷青色，不做高频漂移。
  ctx.save()
  for (let i = 0; i < 22; i += 1) {
    const yBase = cy + (ambient01(i, 7) - 0.5) * R * 3.1
    const x0 = (ambient01(i, 8) - 0.25) * W
    const len = 60 + ambient01(i, 9) * 260
    const a = 0.012 + ambient01(i, 10) * 0.04
    const grad = ctx.createLinearGradient(x0, 0, x0 + len, 0)
    grad.addColorStop(0, 'rgba(212,216,220,0)')
    grad.addColorStop(0.55, `rgba(212,216,220,${a})`)
    grad.addColorStop(1, 'rgba(212,216,220,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 0.7 + ambient01(i, 11) * 1.3
    ctx.beginPath()
    ctx.moveTo(x0, yBase)
    ctx.lineTo(x0 + len, yBase)
    ctx.stroke()
  }
  ctx.restore()
}

/* ── 核心粒子球：不是环，是三维线团 + 示波器 ───────────────── */
function projectOrb(x, y, z, cx, cy, rs, ay, ax) {
  const cy1 = Math.cos(ay)
  const sy1 = Math.sin(ay)
  const x1 = x * cy1 + z * sy1
  const z1 = -x * sy1 + z * cy1
  const cx1 = Math.cos(ax)
  const sx1 = Math.sin(ax)
  const y1 = y * cx1 - z1 * sx1
  const z2 = y * sx1 + z1 * cx1
  const persp = 1 / (1 - z2 * 0.16)
  return [cx + x1 * rs * persp, cy + y1 * rs * 0.92 * persp, z2]
}

/* ── 事件神经网 ───────────────────────────────────────────────
   节点 = 一次真实行为（回合/步/模型/调用/返回/子代理）
   边   = 真实关系（调用→返回、模型→调用、返回→下一次模型、回合→步）
   动画 = 事件跨过回放指针时沿边传播一次信号；没有事件就没有信号。 */
const BRAIN_KINDS = new Set([
  'session.start', 'user.message', 'turn.start', 'turn.end', 'step.start', 'step.end',
  'context.update', 'model.end', 'tool.call', 'tool.result', 'subagent.start',
  'approval.request', 'error',
])
const BRAIN_MAX = 170
const BRAIN_PHI = {
  'session.start': 1.22,
  'user.message': 1.02,
  'turn.start': 0.86,
  'step.start': 0.67,
  'context.update': 0.55,
  'model.end': 0.42,
  'step.end': 0.28,
  'tool.call': 0.02,
  'tool.result': -0.44,
  'turn.end': -0.70,
  'subagent.start': -0.86,
  'approval.request': -0.62,
  error: -0.62,
}
const BRAIN_LAYERS = [
  { kinds: ['model.end'], label: 'MODEL', phi: 0.47, theta: -1.9 },
  { kinds: ['tool.call'], label: 'TOOL', phi: 0.02, theta: -0.35 },
  { kinds: ['tool.result'], label: 'RESULT', phi: -0.44, theta: 2.3 },
  { kinds: ['subagent.start'], label: 'AGENT', phi: -0.86, theta: 1.1 },
]
const BRAIN_KIND_LABEL = {
  'session.start': 'SESSION',
  'user.message': 'USER',
  'turn.start': 'TURN',
  'turn.end': 'TURN END',
  'step.start': 'STEP',
  'step.end': 'STEP END',
  'context.update': 'CTX',
  'model.end': 'MODEL',
  'tool.call': 'TOOL',
  'tool.result': 'RESULT',
  'subagent.start': 'AGENT',
  'approval.request': 'APPROVAL',
  error: 'ERROR',
}
const BRAIN_RELATION = { exec: '调用与返回（按顺序匹配）', emit: '模型与调用（同一步推断）', feed: '返回与后续模型（推断）', spawn: '先后', repeat: '同工具重复', enter: '步内先后', turn: '回合内先后', seq: '事件先后' }
const brain = { key: '', nodes: [], edges: [], byKey: new Map() }

function brainNode(e, index) {
  const rnd = (salt) => ambient01(index + salt * 137, 67)
  const base = BRAIN_PHI[e.kind] ?? 0
  return {
    key: 'n' + index,
    index,
    e,
    kind: e.kind,
    ts: e.ts,
    phi: clamp(base + (rnd(1) - 0.5) * 0.55, -1.32, 1.32),
    theta: index * 0.19 + (rnd(2) - 0.5) * 0.16,
    rad: 0.62 + rnd(3) * 0.40,
  }
}

function brainRgb(n) {
  const e = n.e
  if (n.kind === 'model.end') return SEG.model.rgb
  if (n.kind === 'tool.call') return e.net && typeof e.net === 'object' ? IN_RGB : SEG.tool.rgb
  if (n.kind === 'tool.result') return isFailureEvent(e) ? FAIL_RGB : SEG.tool.rgb
  if (n.kind === 'subagent.start') return PROXY_RGB
  if (n.kind === 'approval.request') return APPROVAL_RGB
  if (n.kind === 'error') return FAIL_RGB
  return '198,206,212'
}

function buildBrain() {
  const key = `${state.file}|${state.events.length}|${state.pointer}`
  if (brain.key === key) return
  brain.key = key
  brain.nodes = []
  brain.edges = []
  brain.byKey = new Map()
  const end = state.pointer
  if (end < 0) return

  const all = []
  for (let i = Math.max(0, end - 900); i <= end; i += 1) {
    const e = state.events[i]
    if (e && BRAIN_KINDS.has(e.kind)) all.push(brainNode(e, i))
  }
  const nodes = all.slice(-BRAIN_MAX)
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const edges = []
  const seen = new Set()
  const add = (a, b, type) => {
    if (!a || !b || a === b) return
    const k = a.key + '>' + b.key
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ a: a.key, b: b.key, type })
  }

  // 1) 调用 → 返回：同一 agent / 回合 / 步 / 工具，按发生顺序配对。
  const pending = new Map()
  for (const n of nodes) {
    const e = n.e
    if (n.kind === 'tool.call') {
      const k = `${e.session_id || ''}|${e.agent_id || ''}|${e.turn ?? ''}|${e.step ?? ''}|${e.tool || ''}`
      if (!pending.has(k)) pending.set(k, [])
      pending.get(k).push(n)
    } else if (n.kind === 'tool.result') {
      const q = pending.get(`${e.session_id || ''}|${e.agent_id || ''}|${e.turn ?? ''}|${e.step ?? ''}|${e.tool || ''}`)
      if (q && q.length) add(q.shift(), n, 'exec')
    }
  }

  // 2) 模型 → 工具：同一步里模型刚产出的调用。
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i]
    if (n.kind !== 'tool.call') continue
    let src = null
    for (let j = i - 1; j >= Math.max(0, i - 12); j -= 1) {
      const p = nodes[j]
      if (p.kind !== 'model.end') continue
      if ((p.e.turn ?? null) === (n.e.turn ?? null) && (p.e.step ?? null) === (n.e.step ?? null)) { src = p; break }
      if (!src && (p.e.turn ?? null) === (n.e.turn ?? null)) src = p
    }
    add(src, n, 'emit')
  }

  // 3) 返回 → 下一次模型：结果喂回推理。
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i]
    if (n.kind !== 'tool.result') continue
    for (let j = i + 1; j < Math.min(nodes.length, i + 16); j += 1) {
      const nx = nodes[j]
      if (nx.kind === 'model.end' && (nx.e.turn ?? null) === (n.e.turn ?? null)) { add(n, nx, 'feed'); break }
    }
  }

  // 4) 回合 → 步；步 → 第一步行为；子代理挂到上一条事件。
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i]
    const e = n.e
    if (n.kind === 'step.start') {
      for (let j = i + 1; j < Math.min(nodes.length, i + 12); j += 1) {
        const nx = nodes[j]
        if (nx.e.turn === e.turn && nx.e.step === e.step) { add(n, nx, 'enter'); break }
      }
    } else if (n.kind === 'turn.start') {
      for (let j = i + 1; j < Math.min(nodes.length, i + 12); j += 1) {
        const nx = nodes[j]
        if (nx.kind === 'step.start' && nx.e.turn === e.turn) { add(n, nx, 'turn'); break }
      }
    } else if (n.kind === 'subagent.start') {
      add(nodes[i - 1], n, 'spawn')
    }
  }

  // 5) 相邻事件本身就是真实的先后关系：全部连上，让网络有密度。
  for (let i = 1; i < nodes.length; i += 1) add(nodes[i - 1], nodes[i], 'seq')

  // 6) 同工具连续调用：真实的重复动作，连成一条回路。
  const lastCallByTool = new Map()
  for (const n of nodes) {
    if (n.kind !== 'tool.call') continue
    const key = String(n.e.tool || '')
    const prev = lastCallByTool.get(key)
    if (prev) add(prev, n, 'repeat')
    lastCallByTool.set(key, n)
  }

  // 7) 仍然孤立的点接到上一条事件上，保证网络不断裂。
  const linked = new Set()
  for (const ed of edges) { linked.add(ed.a); linked.add(ed.b) }
  for (let i = 1; i < nodes.length; i += 1) {
    if (!linked.has(nodes[i].key)) add(nodes[i - 1], nodes[i], 'seq')
  }

  brain.nodes = nodes
  brain.edges = edges
  brain.byKey = byKey
}

function emitBrainSignals(from, to, now) {
  buildBrain()
  for (let i = Math.max(from, to - 2); i <= to; i += 1) {
    const n = brain.byKey.get('n' + i)
    if (!n) continue
    // 级联：新事件沿真实关系向“上游”回溯 3 跳，每跳延迟 260ms，像神经冲动在网里传导。
    // 颜色与环外波纹一致：模型金、工具青绿、返回浅青绿。
    const e = n.e || state.events[i] || {}
    const rgb = e.kind === 'model.end' ? WAVE_RGB.model : e.kind === 'tool.call' ? WAVE_RGB.tool : e.kind === 'tool.result' ? WAVE_RGB.result : '255,255,255'
    fx.brainFlashes.push({ key: n.key, start: now, dur: 1400, rgb })
    let frontier = [n.key]
    const seenK = new Set(frontier)
    for (let hop = 0; hop < 3 && frontier.length; hop += 1) {
      const next = []
      for (const key of frontier) {
        const inc = brain.edges.filter((ed) => ed.b === key && !seenK.has(ed.a)).slice(0, 3)
        inc.forEach((ed, k) => {
          // 方向：从当前节点往上游跑（b → a）
          fx.brainSignals.push({ a: ed.b, b: ed.a, start: now + hop * 260 + k * 60, dur: 900, rgb })
          fx.brainFlashes.push({ key: ed.a, start: now + hop * 260 + 900, dur: 900, rgb })
          seenK.add(ed.a)
          next.push(ed.a)
        })
      }
      frontier = next.slice(0, 4)
    }
  }
  if (fx.brainSignals.length > 120) fx.brainSignals.splice(0, fx.brainSignals.length - 120)
  if (fx.brainFlashes.length > 80) fx.brainFlashes.splice(0, fx.brainFlashes.length - 80)
}

// 线的粗细也有语义：调用→返回是行为主干，最亮最粗；纯时序相邻最淡。
const BRAIN_EDGE_STYLE = {
  exec: { w: 1.6, a: 1.35 },
  emit: { w: 1.3, a: 1.05 },
  feed: { w: 1.3, a: 1.05 },
  spawn: { w: 1.2, a: 1.0 },
  repeat: { w: 1.1, a: 0.95 },
  enter: { w: 1.0, a: 0.85 },
  turn: { w: 1.0, a: 0.85 },
  seq: { w: 1.0, a: 0.55 },
}

const webChordCache = { key: '', cv: null }
function drawBrainNetwork(view, now, spot) {
  const { cx, cy } = view
  const nodes = brain.nodes
  if (!nodes.length) return
  // 内部网络不参与呼吸：球壳胀缩时节点和连线保持原尺寸、原位置、原亮度。
  ctx.save()
  const proj = (n) => {
    const cp = Math.cos(n.phi)
    return spot(Math.cos(n.theta) * cp * n.rad, Math.sin(n.phi) * n.rad, Math.sin(n.theta) * cp * n.rad)
  }
  const P = new Map()
  for (const n of nodes) P.set(n.key, proj(n))
  const selectedKey = brain.byKey.has('n' + state.selected) ? 'n' + state.selected : null
  const related = new Set(selectedKey ? [selectedKey] : [])
  if (selectedKey) for (const edge of brain.edges) {
    if (edge.a === selectedKey) related.add(edge.b)
    if (edge.b === selectedKey) related.add(edge.a)
  }
  const ctrl = (a, b) => {
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    return [mx + (cx - mx) * 0.18, my + (cy - my) * 0.18]
  }

  // 神经团辉光：半径和亮度都跟真实产出（token/s）与相位走。
  // 用叠加混合，而不是 shadowBlur，避免每帧大半径模糊拖慢渲染。
  const energy = neuralEnergy()
  // 光团半径固定：只有球壳呼吸，内部光晕不跟着胀缩。
  const bloomR = view.web ? 0 : view.R * 0.88
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, bloomR)
  bloom.addColorStop(0, `rgba(206,210,214,${0.045 + 0.13 * energy})`)
  bloom.addColorStop(0.46, `rgba(136,141,146,${0.025 + 0.055 * energy})`)
  bloom.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = bloom
  ctx.beginPath()
  ctx.arc(cx, cy, bloomR, 0, TAU)
  ctx.fill()
  ctx.restore()

  // 连线：每一条都对应上面列出的真实关系。
  // 性能：按（颜色, 线宽, 量化亮度）分桶，一桶一条路径一次 stroke，代替每条边两三次 stroke。
  const chordR = view.R * 0.80
  const buckets = new Map()
  const chordBuckets = new Map()
  const addTo = (map, rgb, w, alpha, seg) => {
    if (alpha < 0.004) return
    const q = Math.min(40, Math.round(alpha * 160))
    const key = rgb + '|' + w + '|' + q
    let bk = map.get(key)
    if (!bk) { bk = { rgb, w, a: q / 160, segs: [] }; map.set(key, bk) }
    bk.segs.push(seg)
  }
  const addSeg = (rgb, w, alpha, seg) => addTo(buckets, rgb, w, alpha, seg)
  // 织网模式下节点位置不动，长弦只随“热度”缓慢变化：弦单独成层，按会话秒级缓存（性能大头）。
  const chordKey = view.web ? `${brain.key}|${brain.nodes.length}|${Math.floor(state.curTs / 1500)}|${Math.floor(performance.now() / 40)}|${selectedKey}|${W}x${H}@${DPR}|${view.web.x1}|${view.web.y1}` : ''
  const chordCached = view.web && webChordCache.key === chordKey
  const addChord = (rgb, w, alpha, seg) => { if (!chordCached) addTo(view.web ? chordBuckets : buckets, rgb, w, alpha, seg) }
  for (const ed of brain.edges) {
    const a = P.get(ed.a)
    const b = P.get(ed.b)
    if (!a || !b) continue
    const depth = (a[2] + b[2]) / 2
    if (depth < -0.55) continue
    const na = brain.byKey.get(ed.a)
    const nb = brain.byKey.get(ed.b)
    const st = BRAIN_EDGE_STYLE[ed.type] || BRAIN_EDGE_STYLE.seq
    const age = Math.max(0, state.curTs - Math.min(na.ts, nb.ts))
    const heat = clamp(1 - age / 90000, 0, 1)
    const focus = !selectedKey ? 1 : (ed.a === selectedKey || ed.b === selectedKey ? 2.8 : 0.15)
    // 冷热分层：90 秒内的关系是主角，更早的退成底纹；亮度不乘呼吸。
    const alpha = (0.03 + Math.pow(heat, 1.6) * 0.24) * (0.35 + ((depth + 1) / 2) * 0.65) * st.a * focus
    // 织网：把这条真实关系延长成贯穿球体的弦。
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L = Math.hypot(dx, dy)
    if (L > 1) {
      const ux = dx / L
      const uy = dy / L
      const ox = a[0] - cx
      const oy = a[1] - cy
      const bb = ox * ux + oy * uy
      // 织网模式：弦解析地裁到弧内矩形（不再画 4000px 长线再靠 clip 裁，后者光栅化极慢）。
      let disc = 0
      let t0 = 0
      let t1 = 0
      if (view.web) {
        const wb = view.web
        let lo = -1e9
        let hi = 1e9
        for (const [p0, d, mn, mx] of [[a[0], ux, wb.x0 - 20, wb.x1 + 60], [a[1], uy, 0, wb.y1 + 24]]) {
          if (Math.abs(d) < 1e-9) { if (p0 < mn || p0 > mx) { lo = 1; hi = 0 } continue }
          const ta = (mn - p0) / d
          const tb = (mx - p0) / d
          lo = Math.max(lo, Math.min(ta, tb))
          hi = Math.min(hi, Math.max(ta, tb))
        }
        disc = hi > lo ? 1 : 0
        t0 = lo
        t1 = hi
      } else {
        disc = bb * bb - (ox * ox + oy * oy - chordR * chordR)
        if (disc > 0) {
          const sq0 = Math.sqrt(disc)
          t0 = -bb - sq0
          t1 = -bb + sq0
        }
      }
      if (disc > 0) {
        addChord('255,255,255', 1, (0.1 + 0.3 * heat) * (selectedKey ? (focus > 1 ? 2 : 0.4) : 1),
          [a[0] + ux * t0, a[1] + uy * t0, null, null, a[0] + ux * t1, a[1] + uy * t1])
      }
    }
    const [qx, qy] = ctrl(a, b)
    const seg = [a[0], a[1], qx, qy, b[0], b[1]]
    if (heat > 0.15 || focus > 1) addSeg('186,190,194', st.w * 3.4, alpha * 0.55, seg)
    addSeg('234,238,242', st.w, alpha * 0.92, seg)
  }
  if (view.web) {
    if (!chordCached) {
      // 只覆盖织网所在的左侧区域，贴图面积约为整屏的 1/4。
      const cw0 = Math.ceil((view.web.x1 + 60) * DPR)
      const ch0 = Math.ceil((view.web.y1 + 24) * DPR)
      const cv = webChordCache.cv || document.createElement('canvas')
      if (cv.width !== cw0) cv.width = cw0
      if (cv.height !== ch0) cv.height = ch0
      const oc = cv.getContext('2d')
      oc.setTransform(1, 0, 0, 1, 0, 0)
      oc.clearRect(0, 0, cv.width, cv.height)
      oc.setTransform(DPR, 0, 0, DPR, 0, 0)
      oc.lineCap = 'butt'
      for (const bk of chordBuckets.values()) {
        oc.beginPath()
        for (const g of bk.segs) { oc.moveTo(g[0], g[1]); oc.lineTo(g[4], g[5]) }
        oc.strokeStyle = rgba(bk.rgb, bk.a)
        oc.lineWidth = bk.w
        oc.stroke()
      }
      webChordCache.key = chordKey
      webChordCache.cv = cv
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(webChordCache.cv, 0, 0)
    ctx.restore()
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.globalCompositeOperation = view.web ? 'source-over' : 'lighter'
  for (const bk of buckets.values()) {
    ctx.beginPath()
    for (const g of bk.segs) {
      ctx.moveTo(g[0], g[1])
      if (g[2] == null) ctx.lineTo(g[4], g[5])
      else ctx.quadraticCurveTo(g[2], g[3], g[4], g[5])
    }
    ctx.strokeStyle = rgba(bk.rgb, bk.a)
    ctx.lineWidth = bk.w
    ctx.stroke()
  }
  ctx.restore()

  // 信号：事件到来时沿边跑一次；暂停即停。
  for (const sig of fx.brainSignals) {
    const t = (now - sig.start) / sig.dur
    if (t < 0 || t > 1) continue
    const a = P.get(sig.a)
    const b = P.get(sig.b)
    if (!a || !b) continue
    const [qx, qy] = ctrl(a, b)
    const at = (tt) => [(1 - tt) * (1 - tt) * a[0] + 2 * (1 - tt) * tt * qx + tt * tt * b[0], (1 - tt) * (1 - tt) * a[1] + 2 * (1 - tt) * tt * qy + tt * tt * b[1]]
    // 拖尾：一段亮线跟在头后面（沿边走过的路被“点亮”）
    const tail = Math.max(0, t - 0.35)
    ctx.beginPath()
    for (let k = 0; k <= 8; k += 1) {
      const [x, y] = at(tail + ((t - tail) * k) / 8)
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y)
    }
    ctx.strokeStyle = rgba(sig.rgb, 0.75 * (1 - t * 0.5))
    ctx.lineWidth = 2
    ctx.stroke()
    const [hx, hy] = at(t)
    ctx.beginPath()
    ctx.arc(hx, hy, 3.4, 0, TAU)
    ctx.fillStyle = rgba(sig.rgb, 1)
    ctx.fill()
  }

  // 节点：按深度排序，前面的盖住后面的。
  const order = nodes.slice().sort((u, v) => P.get(u.key)[2] - P.get(v.key)[2])
  for (const n of order) {
    const p = P.get(n.key)
    const front = (p[2] + 1) / 2
    const age = Math.max(0, state.curTs - n.ts)
    const heat = clamp(1 - age / 90000, 0, 1)
    const rgb = brainRgb(n)
    const baseR = n.kind === 'model.end' ? 2.1 : n.kind === 'tool.call' ? 1.9 : n.kind === 'tool.result' ? 1.5 : 1.3
    const rad = (baseR + front * 0.9) * (0.6 + 0.4 * heat) + (n.index === state.pointer ? 0.8 : 0)
    const alpha = (0.16 + 0.76 * heat) * (0.35 + 0.65 * front) * (selectedKey && !related.has(n.key) ? 0.15 : 1)
    if (n.index === state.pointer) {
      ctx.beginPath()
      ctx.arc(p[0], p[1], rad + 5, 0, TAU)
      ctx.strokeStyle = rgba(rgb, 0.55)
      ctx.lineWidth = 1
      ctx.stroke()
    }
    // 节点辉光用叠加混合：亮的更亮，暗的不会糊成一片。
    // 只给前面或刚发生的节点铺光，省掉一半以上的无效圆。
    if (heat > 0.25 || n.index === state.pointer || (selectedKey && related.has(n.key))) {
      ctx.save()
      ctx.globalCompositeOperation = view.web ? 'source-over' : 'lighter'
      ctx.beginPath()
      ctx.arc(p[0], p[1], rad + 6.4, 0, TAU)
      ctx.fillStyle = rgba(rgb, alpha * 0.17)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p[0], p[1], rad + 1.4, 0, TAU)
      ctx.fillStyle = rgba(rgb, alpha * 0.30)
      ctx.fill()
      ctx.restore()
    }
    ctx.beginPath()
    ctx.arc(p[0], p[1], rad, 0, TAU)
    ctx.fillStyle = rgba(rgb, alpha)
    ctx.fill()
  }

  // 当前事件：在节点旁标真实行为名，而不是装饰文字。
  const cur = nodes.find((n) => n.index === state.pointer)
  if (cur) {
    const p = P.get(cur.key)
    const text = cur.e.tool || BRAIN_KIND_LABEL[cur.kind] || cur.kind
    const rgb = brainRgb(cur)
    setMonoFont(7, 500)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = rgba(rgb, 0.82)
    ctx.fillText(truncate(text, 18), p[0] + 10, p[1] - 8)
    ctx.beginPath()
    ctx.moveTo(p[0] + 4, p[1] - 4)
    ctx.lineTo(p[0] + 8, p[1] - 7)
    ctx.strokeStyle = rgba(rgb, 0.45)
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  // 节点首次出现：一圈短促的确认环（由事件触发，不是常驻闪烁）。
  for (const f of fx.brainFlashes) {
    const t = (now - f.start) / f.dur
    if (t < 0 || t > 1) continue
    const p = P.get(f.key)
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p[0], p[1], 3 + t * 18, 0, TAU)
    ctx.strokeStyle = rgba(f.rgb, (1 - t) * 0.9)
    ctx.lineWidth = 1.6
    ctx.stroke()
  }

  // 层名：只有该层真的存在事件时才显示。
  const present = new Set(nodes.map((n) => n.kind))
  setMonoFont(6.5, 500)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const L of BRAIN_LAYERS) {
    if (!L.kinds.some((k) => present.has(k))) continue
    const cp = Math.cos(L.phi)
    const [x, y, z] = spot(Math.cos(L.theta) * cp * 1.06, Math.sin(L.phi) * 1.06, Math.sin(L.theta) * cp * 1.06)
    if (z < -0.4) continue
    ctx.fillStyle = 'rgba(198,202,206,0.32)'
    ctx.fillText(L.label, x, y)
  }
  ctx.restore()
}

// 织网投影（巨环模式）：把神经网节点的球面坐标按经纬度摊平到弧内矩形区域。
// 经纬范围按当前节点实际分布归一化，节点铺满整片区域而不是挤在一角。
function webRange() {
  let lo = Infinity, hi = -Infinity, ylo = Infinity, yhi = -Infinity
  for (const n of brain.nodes) {
    const cp = Math.cos(n.phi)
    const lon = Math.atan2(Math.sin(n.theta) * cp, Math.cos(n.theta) * cp)
    const y = Math.sin(n.phi) * n.rad
    if (lon < lo) lo = lon
    if (lon > hi) hi = lon
    if (y < ylo) ylo = y
    if (y > yhi) yhi = y
  }
  if (!(hi > lo)) { lo = -Math.PI; hi = Math.PI }
  if (!(yhi > ylo)) { ylo = -1; yhi = 1 }
  return { lo, hi, ylo, yhi }
}
// 转速：约 80 秒一圈；真实时钟驱动（和呼吸摆动一致，暂停也缓慢自转）。
// 整片织网绕竖轴自转（地球仪式，不画球框），约 80 秒一圈；真实时钟驱动。
function webRot() { return (performance.now() / 80000) * TAU }
function webProject(web, x, y, z) {
  const rg = web.range || { lo: -Math.PI, hi: Math.PI, ylo: -1, yhi: 1 }
  // 地球仪式自转：经度随时间绕竖轴转（从屏幕内转向屏幕外），按正弦投影到横向，
  // 第三分量返回 cos(经度) 作为深度——转到背面的节点和连线自动变暗/被剔除。
  const lon = Math.atan2(z, x) + (web.rot || 0)
  const u = 0.5 + 0.47 * Math.sin(lon)
  const depth = Math.cos(lon)
  const v = 0.06 + 0.88 * clamp((y - rg.ylo) / (rg.yhi - rg.ylo), -0.2, 1.2)
  return [web.x0 + u * (web.x1 - web.x0), web.y0 + v * (web.y1 - web.y0), depth]
}
// 包住织网的线框球（地球仪）：经线绕竖轴自转，从屏幕内转向屏幕外；正面亮、背面暗。
// 真实时钟驱动，约 60s 一圈（与呼吸摆动一致，暂停也慢转）。
function drawGlobe(web) {
  const gx = (web.x0 + web.x1) / 2
  const gy = (web.y0 + web.y1) / 2
  const r = Math.min((web.x1 - web.x0) / 2, (web.y1 - web.y0) / 2) * 0.98
  const rot = (performance.now() / 60000) * TAU
  const tilt = 0.32
  const ct = Math.cos(tilt)
  const st = Math.sin(tilt)
  const proj = (lat, lon) => {
    const x = Math.cos(lat) * Math.sin(lon)
    const y0 = Math.sin(lat)
    const z0 = Math.cos(lat) * Math.cos(lon)
    const y = y0 * ct - z0 * st
    const z = y0 * st + z0 * ct
    return [gx + x * r, gy - y * r, z]
  }
  const drawCurve = (pts) => {
    const front = new Path2D()
    const back = new Path2D()
    for (let k = 1; k < pts.length; k += 1) {
      const p0 = pts[k - 1]
      const p1 = pts[k]
      const pth = (p0[2] + p1[2]) / 2 >= 0 ? front : back
      pth.moveTo(p0[0], p0[1])
      pth.lineTo(p1[0], p1[1])
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    ctx.stroke(back)
    ctx.strokeStyle = 'rgba(255,255,255,0.42)'
    ctx.lineWidth = 1.3
    ctx.stroke(front)
  }
  ctx.save()
  // 外轮廓
  ctx.beginPath()
  ctx.arc(gx, gy, r, 0, TAU)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1.6
  ctx.stroke()
  // 经线（随 rot 转）
  for (let m = 0; m < 12; m += 1) {
    const lon = rot + (m / 12) * Math.PI
    const pts = []
    for (let k = 0; k <= 48; k += 1) pts.push(proj(-Math.PI / 2 + (k / 48) * Math.PI, lon))
    const pts2 = []
    for (let k = 0; k <= 48; k += 1) pts2.push(proj(-Math.PI / 2 + (k / 48) * Math.PI, lon + Math.PI))
    drawCurve(pts)
    drawCurve(pts2)
  }
  // 纬线（固定，经度采样随 rot 不变即可）
  for (let l = -2; l <= 2; l += 1) {
    const lat = (l / 3) * (Math.PI / 2)
    const pts = []
    for (let k = 0; k <= 72; k += 1) pts.push(proj(lat, (k / 72) * TAU))
    drawCurve(pts)
  }
  ctx.restore()
}

function drawWeb(view, now) {
  const web = view.web
  buildBrain()
  web.range = webRange()
  web.rot = webRot()
  // 不用 clip：弦已解析裁到矩形，伸进环带的部分会被随后画的黑色环带盖住。
  drawBrainNetwork(view, now, (x, y, z) => webProject(web, x, y, z))
}

function drawOrb(view, now) {
  if (view.web) { drawWeb(view, now); return }
  const { cx, cy, R } = view
  const rs = R * 0.81
  // 旋转跟会话时间走，不跟墙钟走：暂停回放时球体完全静止。
  const ay = state.curTs * 0.00004
  const ax = 0.36 + Math.sin(state.curTs * 0.000018) * 0.08
  const spot = (x, y, z) => projectOrb(x, y, z, cx, cy, rs, ay, ax)
  buildBrain()

  // 只有球壳（半径、大气层、边缘光、表面高光）参与呼吸；
  // 内部神经网用固定 rs 投影，节点位置、连线尺寸、亮度都不随呼吸变化。
  const b = breath(now)
  const shellR = rs * orbBreathScale(now)
  const atmo = ctx.createRadialGradient(cx, cy, shellR * 0.10, cx, cy, shellR * 1.14)
  atmo.addColorStop(0, `rgba(210,216,222,${0.045 + 0.06 * b})`)
  atmo.addColorStop(0.60, `rgba(150,156,162,${0.018 + 0.02 * b})`)
  atmo.addColorStop(1, 'rgba(150,156,162,0)')
  ctx.fillStyle = atmo
  ctx.beginPath()
  ctx.arc(cx, cy, shellR * 1.14, 0, TAU)
  ctx.fill()

  // 1. 球体内部完全由事件神经网构成：不再画无意义的经纬线框。

  // 2. 神经网在 drawBrainNetwork 里按真实事件绘制（见下方）。

  // 3.5 轴向光柱 + 高光：给球体一点体积感。
  const vg = ctx.createLinearGradient(cx, cy - rs * 1.9, cx, cy + rs * 1.9)
  vg.addColorStop(0, 'rgba(212,216,220,0)')
  vg.addColorStop(0.48, 'rgba(212,216,220,0.060)')
  vg.addColorStop(0.52, 'rgba(212,216,220,0.060)')
  vg.addColorStop(1, 'rgba(212,216,220,0)')
  ctx.fillStyle = vg
  ctx.fillRect(cx - 0.5, cy - rs * 1.9, 1, rs * 3.8)
  const hg = ctx.createLinearGradient(cx - rs * 1.6, cy, cx + rs * 1.6, cy)
  hg.addColorStop(0, 'rgba(212,216,220,0)')
  hg.addColorStop(0.5, 'rgba(212,216,220,0.045)')
  hg.addColorStop(1, 'rgba(212,216,220,0)')
  ctx.fillStyle = hg
  ctx.fillRect(cx - rs * 1.6, cy - 0.5, rs * 3.2, 1)

  const spec = ctx.createRadialGradient(cx - shellR * 0.32, cy - shellR * 0.38, 0, cx - shellR * 0.32, cy - shellR * 0.38, shellR * 0.9)
  spec.addColorStop(0, 'rgba(218,222,226,0.075)')
  spec.addColorStop(1, 'rgba(218,222,226,0)')
  ctx.fillStyle = spec
  ctx.beginPath()
  ctx.arc(cx - shellR * 0.32, cy - shellR * 0.38, shellR * 0.9, 0, TAU)
  ctx.fill()

  // 3.6 神经网：节点、连线、信号全部来自真实事件。
  drawBrainNetwork(view, now, spot)

  // 3.7 玻璃球边缘光：一层薄薄的冷青，把网络收进球体里。
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const rim = ctx.createRadialGradient(cx, cy, shellR * 0.72, cx, cy, shellR * 1.02)
  rim.addColorStop(0, 'rgba(0,0,0,0)')
  rim.addColorStop(0.80, 'rgba(204,209,213,0)')
  rim.addColorStop(0.96, 'rgba(205,210,214,0.055)')
  rim.addColorStop(1, 'rgba(205,210,214,0)')
  ctx.fillStyle = rim
  ctx.beginPath()
  ctx.arc(cx, cy, shellR * 1.02, 0, TAU)
  ctx.fill()
  ctx.restore()

}

