'use strict'
// agent-halo · draw-fx.js — 网络流、波纹、审批、状态块、横幅
// 由原 halo.js 第 4430–5201 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

/* ── 网络：路径与流 ─────────────────────────────────────────── */
function makePath(points) {
  const segs = []
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len < 0.01) continue
    segs.push({ a, b, len, start: total, ang: Math.atan2(dy, dx) })
    total += len
  }
  return { points, segs, total: Math.max(total, 0.001) }
}

function pointAtDist(path, dist) {
  const d = clamp(dist, 0, path.total)
  for (const s of path.segs) {
    if (d <= s.start + s.len) {
      const f = (d - s.start) / s.len
      return { x: lerp(s.a[0], s.b[0], f), y: lerp(s.a[1], s.b[1], f), ang: s.ang }
    }
  }
  const last = path.segs[path.segs.length - 1]
  return { x: last.b[0], y: last.b[1], ang: last.ang }
}

function pointAt(path, t) { return pointAtDist(path, clamp(t, 0, 1) * path.total) }

function slicePoints(path, from, to) {
  const total = path.total
  const d0 = clamp(from, 0, 1) * total
  const d1 = clamp(to, 0, 1) * total
  const out = []
  if (d1 <= d0) return out
  let started = false
  for (const s of path.segs) {
    const s0 = s.start
    const s1 = s.start + s.len
    if (s1 <= d0 || s0 >= d1) continue
    const a = Math.max(s0, d0)
    const b = Math.min(s1, d1)
    const pa = pointAtDist(path, a)
    const pb = pointAtDist(path, b)
    if (!started) { out.push([pa.x, pa.y]); started = true }
    out.push([pb.x, pb.y])
  }
  return out
}

function strokePoints(points, color, width, dash) {
  if (points.length < 2) return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1])
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = dash && dash[0] <= 1.5 ? 'round' : 'butt'
  ctx.setLineDash(dash || [])
  ctx.stroke()
  ctx.restore()
}

function drawChevron(x, y, angle, size, rgb, alpha) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(-size, -size * 0.8)
  ctx.lineTo(size * 0.45, 0)
  ctx.lineTo(-size, size * 0.8)
  ctx.strokeStyle = rgba(rgb, alpha)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
  ctx.stroke()
  ctx.restore()
}

function routeDash(route) {
  if (route === 'proxy') return [7, 6]
  if (route === 'unknown') return [1, 6]
  return []
}

function buildNetPath(eff, dir, offset, view) {
  const { cx, cy, R } = view
  const ang = ringAngle(eff.angle + offset)
  const ring = polar(cx, cy, R, ang)
  const core = view.core || [cx, cy]
  const route = netRoute(eff.net.route)
  let pts
  if (route === 'proxy') {
    const pa = -0.72 // 固定代理节点方位
    const pn = polar(cx, cy, R + 82, pa)
    const outer = polar(cx, cy, R + 112, pa)
    pts = [outer, pn, ring, core]
  } else if (route === 'gateway') {
    const gw = polar(cx, cy, R + 74, ang)
    pts = [gw, ring, core]
  } else if (route === 'unknown') {
    const host = polar(cx, cy, R + 72, ang)
    pts = [host, ring, core]
  } else {
    const host = polar(cx, cy, R + 94, ang)
    pts = [host, ring, core]
  }
  if (dir === 'out') pts = pts.slice().reverse()
  return makePath(pts)
}

function flowDirections(eff) {
  if (eff.kind === 'search' || eff.kind === 'api') return []
  if (eff.kind === 'transfer' || eff.net.direction === 'both') return ['in', 'out']
  if (eff.kind === 'upload' || eff.net.direction === 'out') return ['out']
  return ['in']
}

function drawNetEffect(eff, view, now) {
  const p = clamp((now - eff.start) / eff.dur, 0, 1)
  if (p >= 1) return
  const alpha = Math.min(1, p * 7) * (p > 0.84 ? (1 - p) / 0.16 : 1)
  if (alpha <= 0.01) return
  if (eff.kind === 'search') { drawSearch(eff, view, now, alpha, p); return }
  if (eff.kind === 'api') { drawApi(eff, view, now, alpha, p); return }

  const dirs = flowDirections(eff)
  for (const dir of dirs) {
    const offset = dirs.length > 1 ? (dir === 'out' ? 0.035 : -0.02) : 0
    const phase = dirs.length > 1 && dir === 'out' ? 0.5 : 0 // 双向流错开半个节拍
    drawFlow(eff, view, now, alpha, p, dir, offset, phase)
  }
}

function drawFlow(eff, view, now, alpha, p, dir, offset, phase) {
  const path = buildNetPath(eff, dir, offset, view)
  const route = netRoute(eff.net.route)
  const dash = routeDash(route)
  const rgb = route === 'proxy' ? PROXY_RGB : route === 'gateway' ? GW_RGB : dir === 'out' ? OUT_RGB : IN_RGB
  // 网络流加强（用户：不够明显）：亮度提高，线下垫一层同色光晕
  const baseAlpha = Math.min(1, alpha * (route === 'unknown' ? 0.8 : 1.15))
  const limit = eff.failed ? 0.55 : 1

  if (eff.failed) {
    const pts = slicePoints(path, 0, limit)
    strokePoints(pts, rgba(rgb, baseAlpha * 0.9), 1.5, dash)
    drawBreakMark(path, limit, alpha)
  } else {
    strokePoints(path.points, rgba(rgb, baseAlpha * 0.22), 7, [])
    strokePoints(path.points, rgba(rgb, baseAlpha), eff.kind === 'fetch' ? 2.2 : 2.6, dash)
  }

  // 方向箭头：色盲也能靠箭头 + 线型读懂。
  for (const f of [0.3, 0.62, 0.86]) {
    if (f > limit) continue
    const pt = pointAt(path, f)
    drawChevron(pt.x, pt.y, pt.ang, 6, rgb, Math.min(1, alpha * 1.2))
  }

  if (eff.kind === 'fetch') {
    const prog = clamp(p * 1.05, 0, 1)
    if (!eff.failed || prog <= limit + 0.05) {
      const pt = pointAt(path, Math.min(prog, limit))
      ctx.save()
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 5, 0, TAU)
      ctx.fillStyle = rgba(rgb, alpha)
      ctx.shadowColor = rgba(rgb, 0.9)
      ctx.shadowBlur = 16
      ctx.fill()
      ctx.restore()
    }
    return
  }

  const count = 7
  for (let i = 0; i < count; i += 1) {
    let prog = (p * 1.35 + phase + i / count) % 1
    if (prog < 0) prog += 1
    if (eff.failed && prog > limit) continue
    const pt = pointAt(path, prog)
    const a = alpha * (0.32 + 0.68 * Math.sin(Math.PI * clamp(prog, 0, 1)))
    drawChevron(pt.x, pt.y, pt.ang, 4.5, rgb, Math.min(1, a * 1.3))
  }
}

function drawBreakMark(path, t, alpha) {
  const pt = pointAt(path, t)
  const nx = Math.cos(pt.ang + Math.PI / 2)
  const ny = Math.sin(pt.ang + Math.PI / 2)
  ctx.save()
  ctx.strokeStyle = rgba(FAIL_RGB, alpha * 0.75)
  ctx.lineWidth = 1.4
  ctx.setLineDash([])
  for (const side of [-1, 1]) {
    const bx = pt.x + nx * side * 5
    const by = pt.y + ny * side * 5
    ctx.beginPath()
    ctx.moveTo(bx - nx * 4, by - ny * 4)
    ctx.lineTo(bx + nx * 4, by + ny * 4)
    ctx.stroke()
  }
  ctx.restore()
}

function drawSearch(eff, view, now, alpha, p) {
  const { cx, cy, R } = view
  const ang = ringAngle(eff.angle)
  const route = netRoute(eff.net.route)

  // 先叠加路由形态：搜索也有直连/代理/网关/未知的区别。
  const ring = polar(cx, cy, R, ang)
  let pts = []
  if (route === 'proxy') {
    const pa = -0.72
    pts = [ring, polar(cx, cy, R + 82, pa), polar(cx, cy, R + 112, pa)]
  } else if (route === 'gateway') {
    pts = [ring, polar(cx, cy, R + 74, ang)]
  } else if (route === 'unknown') {
    pts = [ring, polar(cx, cy, R + 72, ang)]
  } else {
    pts = [ring, polar(cx, cy, R + 94, ang)]
  }
  strokePoints(pts, rgba(SEARCH_RGB, alpha * 0.32), 1.2, routeDash(route))
  const tail = pointAt(makePath(pts), 0.86)
  drawChevron(tail.x, tail.y, tail.ang, 3, SEARCH_RGB, alpha * 0.65)

  // 雷达弧：2–3 圈向外扩散后淡出；失败时中途断流并留缺口。
  const radarLimit = eff.failed ? 0.5 : 1
  for (let k = 0; k < 3; k += 1) {
    const q = p - k * 0.16
    if (q <= 0 || q > radarLimit) continue
    const rr = R + q * 84
    ctx.beginPath()
    ctx.arc(cx, cy, rr, ang - 0.54, ang + 0.54)
    ctx.strokeStyle = rgba(SEARCH_RGB, alpha * (0.75 - k * 0.18) * (1 - q * 0.4))
    ctx.lineWidth = 1.8
    ctx.stroke()
  }
  if (eff.failed) drawBreakMark(makePath(pts), 0.55, alpha)
  const sweep = pointAt(makePath([ring, polar(cx, cy, R + 84, ang)]), clamp(p * 0.9, 0, 1))
  ctx.beginPath()
  ctx.arc(sweep.x, sweep.y, 1.8, 0, TAU)
  ctx.fillStyle = rgba(SEARCH_RGB, alpha * 0.8)
  ctx.fill()
}

function drawApi(eff, view, now, alpha, p) {
  const { cx, cy, R } = view
  const a = ringAngle(eff.angle)
  const inner = polar(cx, cy, R - 30, a)
  const outer = polar(cx, cy, R + 30, a)
  const pulse = Math.sin(Math.PI * p)
  strokePoints([inner, outer], rgba(IN_RGB, alpha * 0.55 * pulse), 1.4, [])
  const midIn = pointAt(makePath([inner, outer]), 0.5)
  drawChevron(midIn.x, midIn.y, midIn.ang + Math.PI, 3, IN_RGB, alpha * pulse)
  drawChevron(midIn.x, midIn.y, midIn.ang, 3, OUT_RGB, alpha * pulse)
}

function drawProxyNode(view, now) {
  const { cx, cy, R } = view
  const pa = -0.72
  const [x, y] = polar(cx, cy, R + 82, pa)
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.004)
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, 11, 0, TAU)
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = rgba(PROXY_RGB, 0.5 + 0.2 * pulse)
  ctx.lineWidth = 1.1
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(x, y, 4, 0, TAU)
  ctx.fillStyle = rgba(PROXY_RGB, 0.85)
  ctx.fill()
  setMonoFont(9.5, 600)
  ctx.fillStyle = rgba(PROXY_RGB, 0.8)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('PROXY', x + 14, y - 10)
  ctx.restore()
}

function drawGwNode(view, angle, alpha) {
  const { cx, cy, R } = view
  const [x, y] = polar(cx, cy, R + 74, ringAngle(angle))
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.PI / 4)
  ctx.strokeStyle = rgba(GW_RGB, 0.35 + alpha * 0.5)
  ctx.lineWidth = 1.4
  ctx.strokeRect(-6, -6, 12, 12)
  ctx.restore()
  setMonoFont(9.5, 600)
  ctx.fillStyle = rgba(GW_RGB, 0.35 + alpha * 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('GW', x + 12, y - 10)
}

function drawNetworks(view, now) {
  const nets = fx.nets.concat(fx.demoNets)
  if (!nets.length) return
  let hasProxy = false
  for (const n of nets) if (netRoute(n.net.route) === 'proxy' && now - n.start < n.dur + 400) hasProxy = true
  if (hasProxy) drawProxyNode(view, now)

  for (const n of nets) {
    if (netRoute(n.net.route) !== 'gateway') continue
    const p = clamp((now - n.start) / n.dur, 0, 1)
    if (p >= 1) continue
    drawGwNode(view, n.angle, Math.min(1, p * 7) * (p > 0.85 ? (1 - p) / 0.15 : 1))
  }
  for (const n of nets) drawNetEffect(n, view, now)
}

/* ── 脉冲、回声、卫星、字形 ─────────────────────────────────── */
// 两端渐隐的细弧：分 18 小段画，透明度按 sin 分布，避免粗圆头弧的“贴纸感”。
function taperArc(cx, cy, r, mid, half, rgb, alpha, width) {
  if (alpha <= 0.005 || half <= 0) return
  const n = 9 // 9 段已足够平滑（原 18 段，波纹是第二大开销）
  ctx.lineWidth = width
  ctx.lineCap = 'butt'
  for (let k = 0; k < n; k += 1) {
    const u0 = k / n
    const u1 = (k + 1) / n
    ctx.beginPath()
    ctx.arc(cx, cy, r, mid - half + 2 * half * u0, mid - half + 2 * half * u1)
    ctx.strokeStyle = rgba(rgb, alpha * Math.sin(Math.PI * (u0 + u1) / 2))
    ctx.stroke()
  }
}

// 环外波纹的配色（用户要求“用不同的颜色、层数多、明显”）：按事件类型区分，红色仍只留给审批。
const WAVE_RGB = { user: '255,255,255', step: '242,198,110', model: '242,198,110', tool: '96,226,176', result: '170,240,214', echo: '255,255,255' }
const WAVE_SPEC = {
  step: { layers: 5, span: 100, w: 3.6 },
  model: { layers: 5, span: 100, w: 3.6 },
  tool: { layers: 4, span: 72, w: 3.2 },
  result: { layers: 3, span: 60, w: 2.8 },
  user: { layers: 6, span: 110, w: 3.4 },
}
function drawWaveLayers(cx, cy, R, ang, t, rgb, spec, far) {
  for (let k = 0; k < spec.layers; k += 1) {
    const q = t * 1.3 - k * 0.13
    if (q <= 0 || q >= 1) continue
    const e = 1 - Math.pow(1 - q, 3)
    const alpha = Math.min(1, (1 - q) * 1.15 * (1 - k * 0.14))
    // far：巨环模式按可用宽度放大传播距离（约 40%），波一直传到光柱中段。
    const span = spec.span * (far || 1)
    taperArc(cx, cy, R + 6 + e * span, ang, (0.03 + e * 0.17) / Math.max(1, (far || 1) * 0.6), rgb, alpha, Math.max(1.2, spec.w - k * 0.5))
  }
}
function drawPulses(view, now) {
  const { cx, cy, R } = view
  const far = view.big ? clamp((view.rayMax * 0.4) / 100, 1, 5) : 1
  for (const p of fx.pulses) {
    const t = clamp((now - p.start) / p.dur, 0, 1)
    if (t >= 1) continue
    const pa = fxAngle(view, p.angle, p.eventIndex)
    const type = WAVE_SPEC[p.type] ? p.type : 'tool'
    // 多层同心细弧依次外扩：层层错开 13% 时间，越外越细越淡；颜色按事件类型。
    drawWaveLayers(cx, cy, R, pa, t, WAVE_RGB[type], WAVE_SPEC[type], far)
    if (p.type === 'tool') {
      const e = 1 - Math.pow(1 - t, 3)
      const [x, y] = polar(cx, cy, R + 8 + e * 14, pa)
      drawGlyph(p.glyph || 'file', x, y, 11, WAVE_RGB.tool, (1 - t) * 0.9)
    }
  }
  for (const e of fx.echoes) {
    const t = clamp((now - e.start) / e.dur, 0, 1)
    if (t >= 1) continue
    // 短时间重复调用同一工具：白色 5 层连续波纹
    const ea = fxAngle(view, e.angle, e.index)
    drawWaveLayers(cx, cy, R, ea, t, WAVE_RGB.echo, { layers: 6, span: 84, w: 3 }, far)
  }
}

function drawMarkers(view, now) {
  const { cx, cy, R } = view
  const spin = ringSpin()
  for (const m of fx.markers) {
    const a = 1 - (now - m.start) / 9000
    if (a <= 0) continue
    const [x, y] = polar(cx, cy, R + 2, fxAngle(view, m.angle, m.index))
    ctx.beginPath()
    ctx.arc(x, y, 2.4, 0, TAU)
    ctx.fillStyle = `rgba(212,216,220,${a * 0.38})`
    ctx.fill()
  }
}

function drawSatellites(view, now) {
  const { cx, cy, R } = view
  for (const s of state.satellites) {
    const age = state.curTs - s.ts
    if (age >= 60000) continue
    const alpha = age < 45000 ? 1 : Math.max(0, 1 - (age - 45000) / 15000) // 无结束事件时 TTL 淡出
    const ang = s.angle + now * 0.00006
    const [x, y] = polar(cx, cy, R + 17, ang)
    ctx.beginPath()
    ctx.arc(x, y, 2.6, 0, TAU)
    ctx.fillStyle = rgba(SUB_RGB, alpha * 0.55)
    ctx.fill()
    drawGlyph('subtask', x, y, 10, SUB_RGB, alpha * 0.7)
  }
}

function drawCurrentGlyph(view, now) {
  if (!state.tool) return
  const { cx, cy, R } = view
  const ang = ringAngle((SEG.tool.start + SEG.tool.end) / 2)
  const [x, y] = polar(cx, cy, tapeGeom(view).rIn - 24, ang)
  const alpha = state.phase === 'tool' ? 0.9 : 0.3
  const rgb = state.phase === 'tool' ? SEG.tool.rgb : IDLE_RGB
  drawGlyph(glyphType(state.tool, null), x, y, 15, rgb, alpha)
}

function drawGlyph(type, x, y, s, rgb, alpha) {
  const c = rgba(rgb, alpha)
  const h = s / 2
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = c
  ctx.fillStyle = c
  ctx.lineWidth = Math.max(1, s * 0.09)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])

  if (type === 'terminal') {
    roundRectPath(-h * 0.95, -h * 0.7, h * 1.9, h * 1.4, h * 0.22)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-h * 0.5, -h * 0.16)
    ctx.lineTo(-h * 0.2, 0)
    ctx.lineTo(-h * 0.5, h * 0.16)
    ctx.moveTo(h * 0.02, h * 0.22)
    ctx.lineTo(h * 0.45, h * 0.22)
    ctx.stroke()
  } else if (type === 'file') {
    ctx.beginPath()
    ctx.moveTo(-h * 0.72, -h)
    ctx.lineTo(h * 0.3, -h)
    ctx.lineTo(h * 0.72, -h * 0.58)
    ctx.lineTo(h * 0.72, h)
    ctx.lineTo(-h * 0.72, h)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(h * 0.3, -h)
    ctx.lineTo(h * 0.3, -h * 0.58)
    ctx.lineTo(h * 0.72, -h * 0.58)
    ctx.moveTo(-h * 0.42, 0)
    ctx.lineTo(h * 0.35, 0)
    ctx.moveTo(-h * 0.42, h * 0.4)
    ctx.lineTo(h * 0.15, h * 0.4)
    ctx.stroke()
  } else if (type === 'search') {
    ctx.beginPath()
    ctx.arc(-h * 0.14, -h * 0.14, h * 0.55, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(h * 0.28, h * 0.28)
    ctx.lineTo(h * 0.8, h * 0.8)
    ctx.stroke()
  } else if (type === 'write') {
    ctx.beginPath()
    ctx.moveTo(-h * 0.85, h * 0.2)
    ctx.lineTo(h * 0.2, -h * 0.8)
    ctx.lineTo(h * 0.72, -h * 0.28)
    ctx.lineTo(-h * 0.35, h * 0.7)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-h * 0.85, h * 0.2)
    ctx.lineTo(-h * 0.52, h * 0.76)
    ctx.moveTo(h * 0.2, -h * 0.8)
    ctx.lineTo(h * 0.56, -h * 0.42)
    ctx.stroke()
  } else if (type === 'network') {
    ctx.beginPath()
    ctx.arc(0, 0, h * 0.82, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(0, 0, h * 0.34, h * 0.82, 0, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-h * 0.78, 0)
    ctx.lineTo(h * 0.78, 0)
    ctx.moveTo(-h * 0.68, -h * 0.4)
    ctx.lineTo(h * 0.68, -h * 0.4)
    ctx.moveTo(-h * 0.68, h * 0.4)
    ctx.lineTo(h * 0.68, h * 0.4)
    ctx.stroke()
  } else if (type === 'subtask') {
    ctx.beginPath()
    ctx.arc(0, 0, h * 0.3, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(0, 0, h * 0.88, h * 0.36, -0.5, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(h * 0.72, -h * 0.32, h * 0.16, 0, TAU)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(0, 0, h * 0.7, 0, TAU)
    ctx.stroke()
  }
  ctx.restore()
}

/* ── 审批（唯一红色） ───────────────────────────────────────── */
function approvalIntensity(now) {
  let v = 0
  if (state.latestApprovalTs != null && state.curTs - state.latestApprovalTs < 60000) {
    const age = Math.max(0, state.curTs - state.latestApprovalTs)
    v = 1 - age / 60000
  }
  for (const a of fx.approvals) {
    if (now - a.start < a.dur) v = Math.max(v, 1 - (now - a.start) / a.dur)
  }
  for (const a of fx.demoApprovals) {
    if (now - a.start < a.dur) v = Math.max(v, 1 - (now - a.start) / a.dur)
  }
  return clamp(v, 0, 1)
}

function errorIntensity() {
  return state.errorStatusVisible ? 1 : 0
}

function drawApproval(view, now) {
  const v = approvalIntensity(now)
  if (v <= 0.001) return
  const { cx, cy, R } = view
  const pulse = 0.55 + 0.45 * Math.sin(now * 0.008)
  const a = v * (0.35 + 0.4 * pulse)

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R + 4, 0, TAU)
  ctx.strokeStyle = rgba(APPROVAL_RGB, a)
  ctx.lineWidth = 2.4
  ctx.stroke()

  // 巨环模式：等人段多半在画面外，告警点与文字放到环上可见的中线处（与停滞提示同一位置区域）
  const mid = view.big ? 0 : ringAngle((SEG.waiting_user.start + SEG.waiting_user.end) / 2)
  const [x, y] = polar(cx, cy, R, mid)
  ctx.beginPath()
  ctx.arc(x, y, 4 + 2 * pulse, 0, TAU)
  ctx.fillStyle = rgba(APPROVAL_RGB, 0.55 + 0.35 * pulse)
  ctx.shadowColor = rgba(APPROVAL_RGB, 0.8)
  ctx.shadowBlur = 12
  ctx.fill()
  ctx.restore()

  setUiFont(11, 600)
  ctx.fillStyle = rgba(APPROVAL_RGB, 0.65 + 0.3 * pulse)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (view.big) {
    // 告警文字已合并到右下角读数
  } else {
    const [tx, ty] = polar(cx, cy, R + 18, mid)
    ctx.fillText('要人确认', tx, ty)
  }
}

/* ── 大字状态块：参考片式左下角标题 ─────────────────────────── */
function drawStatus(view, now) {
  const { R, deckH } = view
  const approval = approvalIntensity(now)
  const error = errorIntensity()
  const ph = state.phase || 'idle'
  const fade = phaseFade(now)
  let en = 'IDLE'
  let detail = '等待回放'
  let rgb = IDLE_RGB

  if (error > 0.001) {
    en = LANG === 'en' ? 'ERROR' : '错误'
    detail = `${LANG === 'en' ? 'FAILED' : '失败'} · ${truncate(state.latestErrorLabel, 30)}`
    rgb = APPROVAL_RGB
  } else if (approval > 0.001) {
    const secs = state.latestApprovalTs != null ? Math.max(0, (state.curTs - state.latestApprovalTs) / 1000) : 0
    en = 'APPROVAL'
    detail = `要人确认 · ${secs.toFixed(1)}S · 等待输入`
    rgb = APPROVAL_RGB
  } else if (!state.events.length) {
    en = state.loading ? 'LOADING' : (state.error ? 'ERROR' : 'IDLE')
    detail = state.loading ? '载入中 · 请稍候' : (state.error ? `载入失败 · ${truncate(state.error, 30)}` : '等待回放 · 没有事件')
    rgb = state.error ? APPROVAL_RGB : IDLE_RGB
  } else if (ph === 'tool') {
    const base = state.toolStartedAt != null ? state.toolStartedAt : state.phaseStartTs
    const secs = Math.max(0, (state.curTs - base) / 1000)
    en = 'TOOL'
    detail = `${state.tool || '—'} · ${secs.toFixed(1)}S`
    rgb = SEG.tool.rgb
  } else if (ph === 'model') {
    const secs = Math.max(0, (state.curTs - state.phaseStartTs) / 1000)
    en = 'MODEL'
    detail = `生成中 · ${secs.toFixed(1)}S`
    rgb = SEG.model.rgb
  } else if (ph === 'waiting_user') {
    const secs = Math.max(0, (state.curTs - state.phaseStartTs) / 1000)
    en = 'WAIT'
    detail = `待输入 · ${secs.toFixed(1)}S`
    rgb = SEG.waiting_user.rgb
  } else {
    en = 'IDLE'
    detail = '等待事件'
    rgb = IDLE_RGB
  }

  const x = 24
  const blockW = W - 48
  const big = clamp(R * 0.19, 32, 52)
  const y = H - deckH - 114
  if (blockW < 120 || y < 80) return

  // 左侧相位色细杆：唯一的彩色锚点。
  ctx.fillStyle = rgba(rgb, 0.82)
  ctx.fillRect(x - 12, y - 7, 2, big + 10)

  // 顶行：状态码 + 位置。
  setMonoFont(8, 500)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(178,182,186,0.56)'
  ctx.fillText(state.live ? '// 实时状态' : '// 回放状态', x, y)
  // SYS 行放在 TOK / SEC 左侧，两者同一右缘会叠字。
  setMonoFont(7.5, 500)
  const tokLabelW = ctx.measureText('TOK / SEC').width
  setMonoFont(8, 500)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(178,182,186,0.38)'
  ctx.fillText(`SYS 01 · ${state.playing ? 'RUN' : 'HOLD'}`, x + blockW - tokLabelW - 14, y)

  // 巨大英文状态：冷色渐变 + 轻辉光，像仪器铭牌上的发光字符。
  let size = big
  setUiFont(size, 600)
  ctx.letterSpacing = '4px'
  while (size > 28 && ctx.measureText(en).width > blockW * 0.6) {
    size -= 1
    setUiFont(size, 600)
  }
  ctx.textAlign = 'left'
  const statusRgb = approval > 0.001 ? APPROVAL_RGB : rgb
  const fadeA = 0.55 + 0.45 * fade
  const tg = ctx.createLinearGradient(x, y - big * 0.05, x, y + big * 1.02)
  tg.addColorStop(0, `rgba(250,252,254,${0.97 * fadeA})`)
  tg.addColorStop(0.58, `rgba(230,234,238,${0.94 * fadeA})`)
  tg.addColorStop(1, rgba(statusRgb, 0.86 * fadeA))
  ctx.save()
  ctx.shadowColor = rgba(statusRgb, 0.14 * fadeA)
  ctx.shadowBlur = 8
  ctx.fillStyle = tg
  ctx.fillText(en, x, y + big)
  ctx.restore()
  ctx.letterSpacing = '0px'

  // 右侧大数字：token/s。
  const numSize = clamp(R * 0.15, 28, 44)
  const num = String(Math.round(state.tokenRateShown || 0)).padStart(3, '0')
  setMonoFont(numSize, 300)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(238,242,246,0.95)'
  ctx.fillText(num, x + blockW, y + big)
  setMonoFont(7.5, 500)
  ctx.fillStyle = 'rgba(198,202,206,0.55)'
  ctx.fillText('TOK / SEC', x + blockW, y - 1)

  // 细分隔线：只给左侧状态块收口，止于频谱柱左缘之前，不横穿柱子。
  const lineW = Math.min(blockW, 236)
  const lg = ctx.createLinearGradient(x, 0, x + lineW, 0)
  lg.addColorStop(0, 'rgba(206,210,214,0.30)')
  lg.addColorStop(0.55, 'rgba(206,210,214,0.12)')
  lg.addColorStop(1, 'rgba(206,210,214,0)')
  ctx.beginPath()
  ctx.moveTo(x, y + big + 8.5)
  ctx.lineTo(x + lineW, y + big + 8.5)
  ctx.strokeStyle = lg
  ctx.lineWidth = 1
  ctx.stroke()

  // 中文说明：工具名/动作。
  setUiFont(clamp(size * 0.30, 11, 15), 500)
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(198,202,206,0.88)'
  ctx.fillText(truncate(detail, 42), x, y + big + 25)

  // 次级遥测。
  const parts = []
  if (state.events.length) {
    parts.push(`STEP ${state.step != null ? state.step : '—'}`)
    if (state.turn != null) parts.push(`TURN ${state.turn}`)
    parts.push(`EVT ${state.pointer + 1}/${state.events.length}`)
    const t0 = state.events[0] && state.events[0].ts ? state.events[0].ts : state.curTs
    parts.push(`T+${Math.max(0, (state.curTs - t0) / 1000).toFixed(1)}S`)
  } else {
    parts.push('NO EVENTS')
  }
  const stall = stallSeconds()
  if (stall > 8) parts.push(`STALL ${Math.floor(stall)}S`)
  setMonoFont(8, 500)
  ctx.fillStyle = 'rgba(178,182,186,0.66)'
  ctx.fillText(parts.join('   ·   '), x, y + big + 41)

  // 上下文细条。
  const ratio = clamp(Number(state.contextRatio) || 0, 0, 1)
  const barW = blockW - 84
  const by = y + big + 51
  ctx.beginPath()
  ctx.moveTo(x, by)
  ctx.lineTo(x + barW, by)
  ctx.strokeStyle = 'rgba(206,210,214,0.12)'
  ctx.lineWidth = 1
  ctx.stroke()
  if (ratio > 0) {
    ctx.beginPath()
    ctx.moveTo(x, by)
    ctx.lineTo(x + barW * ratio, by)
    ctx.strokeStyle = ratio > 0.8 ? 'rgba(196,164,112,0.85)' : 'rgba(206,210,214,0.42)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  setMonoFont(7.5, 500)
  ctx.textAlign = 'right'
  ctx.fillStyle = ratio > 0.8 ? 'rgba(196,164,112,0.85)' : 'rgba(178,182,186,0.48)'
  ctx.fillText(`CTX ${Math.round(ratio * 100)}%`, x + blockW, by + 2.5)
}

/* ── 演练横幅 ───────────────────────────────────────────────── */
function drawRehearsalBanner(view, now) {
  if (!state.rehearsal.active) return
  ctx.save()
  ctx.setLineDash([4, 6])
  ctx.strokeStyle = 'rgba(196,164,112,0.30)'
  ctx.lineWidth = 1
  ctx.strokeRect(6.5, 6.5, W - 13, H - 13)
  ctx.restore()

  const text = '演练 / REHEARSAL · 合成脉冲'
  setMonoFont(8.5, 600)
  const tw = ctx.measureText(text).width
  const x = 12
  const y = 10
  ctx.fillStyle = '#050505'
  ctx.fillRect(x, y, tw + 18, 19)
  ctx.strokeStyle = 'rgba(196,164,112,0.62)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, tw + 17, 18)
  ctx.fillStyle = 'rgba(214,188,138,0.95)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 9, y + 10)

  if (fx.demoCaption) {
    setMonoFont(8, 400)
    ctx.fillStyle = 'rgba(196,164,112,0.72)'
    ctx.textBaseline = 'top'
    ctx.fillText(`// ${fx.demoCaption}`, x + 1, y + 25)
  }
}

