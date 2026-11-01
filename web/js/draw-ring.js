'use strict'
// agent-halo · draw-ring.js — 两侧仪表、仪器框、时间尺、环、卡带、光柱、刻度、核心
// 由原 halo.js 第 2625–4429 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

/* ── 左右信号柱：把画面从“只有环”里拉出来 ─────────────────── */
function sideCounts() {
  const start = Math.max(0, state.pointer - 199)
  const list = state.events.slice(start, state.pointer + 1)
  const counts = { model: 0, tool: 0, net: 0, sub: 0 }
  for (const e of list) {
    if (e.kind === 'model.end') counts.model += 1
    if (e.kind === 'tool.call') counts.tool += 1
    if (e.net) counts.net += 1
    if (e.kind === 'subagent.start') counts.sub += 1
  }
  return counts
}

// 面板数据一律来自真实事件，不造波形。
function lastEvents(max, pred, maxScan = 600) {
  const out = []
  for (let i = state.pointer; i >= 0 && out.length < max && i >= state.pointer - maxScan; i -= 1) {
    const e = state.events[i]
    if (e && pred(e)) out.push(e)
  }
  return out.reverse()
}

function latencySeries(n) {
  return lastEvents(n, (e) => e.kind === 'tool.result' && Number(e.duration_ms) > 0)
    .map((e) => Number(e.duration_ms))
}

function eventRateSeries(n, windowMs) {
  const bins = new Array(n).fill(0)
  if (state.pointer < 0) return bins
  const from = state.curTs - windowMs
  for (let i = state.pointer; i >= 0; i -= 1) {
    const e = state.events[i]
    if (!e || e.ts < from) break
    const idx = clamp(Math.floor(((e.ts - from) / windowMs) * n), 0, n - 1)
    bins[idx] += 1
  }
  return bins
}

function tokenOutSeries(n) {
  return lastEvents(n, (e) => e.kind === 'model.end' && e.tokens && Number(e.tokens.out) > 0)
    .map((e) => Number(e.tokens.out))
}

function drawPanelFrame(x, y, w, h, title, tag) {
  ctx.strokeStyle = 'rgba(190,194,198,0.11)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w, h)
  setMonoFont(7, 500)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(185,193,200,0.52)'
  ctx.fillText(title, x + 9, y + 14)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(185,193,200,0.30)'
  ctx.fillText(tag, x + w - 9, y + 14)
  ctx.beginPath()
  ctx.moveTo(x + 8, y + 21.5)
  ctx.lineTo(x + w - 8, y + 21.5)
  ctx.strokeStyle = 'rgba(190,194,198,0.09)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawSideTelemetry(view, now) {
  const { cx, cy, R } = view
  const counts = sideCounts()
  const leftSpace = cx - R
  const rightSpace = W - (cx + R)
  const wide = leftSpace > 250 && rightSpace > 250

  if (wide) {
    // 宽屏：左右各放一块真正的仪表盘，填满空白，而不是贴边细条。
    const pw = 190
    const ph = Math.min(R * 1.5, H - view.deckH - 150)
    const ly = cy - ph / 2
    const lx = (leftSpace - pw) / 2
    // 左侧：真实工具耗时（tool.result.duration_ms），没有结果就空着。
    const bars = 22
    const gap = 2
    const innerW = pw - 20
    const barW = Math.max(2, (innerW - gap * (bars - 1)) / bars)
    const baseline = ly + ph - 34
    const maxH = ph - 88
    const lat = latencySeries(bars)
    const latMax = Math.max(1, ...lat)
    drawPanelFrame(lx, ly, pw, ph, 'TOOL LATENCY / 22', lat.length ? `${lat.length} RSLT` : 'WAIT')
    for (let g = 1; g <= 3; g += 1) {
      const gy = baseline - (g / 4) * maxH
      ctx.beginPath()
      ctx.moveTo(lx + 9, gy + 0.5)
      ctx.lineTo(lx + pw - 9, gy + 0.5)
      ctx.strokeStyle = 'rgba(190,194,198,0.06)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (!lat.length) {
      setMonoFont(6.5, 500)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = 'rgba(185,193,200,0.32)'
      ctx.fillText('NO TOOL RESULTS', lx + 10, baseline - 10)
    }
    for (let i = 0; i < bars; i += 1) {
      const v = i >= bars - lat.length ? lat[i - (bars - lat.length)] : 0
      const level = v > 0 ? Math.pow(v / latMax, 0.6) : 0
      const bh = v > 0 ? Math.max(2, maxH * level) : 1
      const bx = lx + 10 + i * (barW + gap)
      const by = baseline - bh
      ctx.fillStyle = `rgba(206,210,214,${v > 0 ? 0.05 + level * 0.15 : 0.04})`
      // 细柱：槽位宽度不变，实际只画 3px，读数清楚又不压过中心的球。
      const sw = Math.min(barW, 3)
      ctx.fillRect(bx + (barW - sw) / 2, by, sw, bh)
      if (v > 0) {
        ctx.fillStyle = `rgba(244,248,250,${0.42 + level * 0.40})`
        ctx.fillRect(bx + (barW - sw) / 2 - 1, by, sw + 2, 1.4)
      }
    }
    setMonoFont(6.5, 500)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(185,193,200,0.34)'
    ctx.fillText('TOOL / MS', lx + 9, ly + ph - 9)
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(190,194,198,0.55)'
    ctx.fillText(lat.length ? `${latMax} MAX` : '—', lx + pw - 9, ly + ph - 9)

    const rp = 190
    const rh = Math.min(R * 1.15, 320)
    const rx = cx + R + (rightSpace - rp) / 2
    const ry = cy - rh / 2
    drawPanelFrame(rx, ry, rp, rh, 'EVENT MIX / 200', `${Math.max(0, state.pointer + 1)} EV`)
    const rows2 = [
      ['MODEL', counts.model, SEG.model.rgb],
      ['TOOL', counts.tool, SEG.tool.rgb],
      ['NET', counts.net, IN_RGB],
      ['SUB', counts.sub, PROXY_RGB],
    ]
    const max = Math.max(1, ...rows2.map((r) => r[1]))
    const mixH = rh * 0.60
    const rowH = (mixH - 40) / 4
    rows2.forEach(([name, n, rgb], i) => {
      const y = ry + 30 + i * rowH
      setMonoFont(6.5, 500)
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(185,193,200,0.45)'
      ctx.fillText(name, rx + 9, y)
      setMonoFont(18, 400)
      ctx.textAlign = 'right'
      ctx.fillStyle = rgba(rgb, 0.88)
      ctx.fillText(String(n).padStart(2, '0'), rx + rp - 9, y + 14)
      ctx.fillStyle = 'rgba(190,194,198,0.07)'
      ctx.fillRect(rx + 9, y + 20, rp - 18, 1)
      ctx.fillStyle = rgba(rgb, 0.55)
      ctx.fillRect(rx + 9, y + 20, (rp - 18) * (n / max), 1)
    })

    // 下半区：最近 12 秒的真实事件密度，事件越密柱子越高。
    const divY = ry + mixH + 6
    ctx.fillStyle = 'rgba(190,194,198,0.10)'
    ctx.fillRect(rx + 9, divY, rp - 18, 1)
    setMonoFont(6.5, 500)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(185,193,200,0.40)'
    ctx.fillText('EVENT RATE / 60S', rx + 9, divY + 11)
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(190,194,198,0.50)'
    ctx.fillText('NOW', rx + rp - 9, divY + 11)

    const pn = 24
    const pGap = 2
    const pInner = rp - 20
    const pbW = Math.max(2, (pInner - pGap * (pn - 1)) / pn)
    const pBase = ry + rh - 10
    const pTop = divY + 20
    const pMax = pBase - pTop
    const rateBins = eventRateSeries(pn, 60000)
    const rMax = Math.max(1, ...rateBins)
    for (let i = 0; i < pn; i += 1) {
      const v = rateBins[i]
      const level = v > 0 ? Math.pow(v / rMax, 0.65) : 0
      const bh = v > 0 ? Math.max(1.6, pMax * level) : 1
      const bx = rx + 10 + i * (pbW + pGap)
      ctx.fillStyle = `rgba(206,210,214,${v > 0 ? 0.05 + level * 0.14 : 0.04})`
      ctx.fillRect(bx + (pbW - Math.min(pbW, 3)) / 2, pBase - bh, Math.min(pbW, 3), bh)
      if (v > 0) {
        ctx.fillStyle = `rgba(244,248,250,${0.38 + level * 0.34})`
        ctx.fillRect(bx + (pbW - Math.min(pbW, 3)) / 2 - 1, pBase - bh, Math.min(pbW, 3) + 2, 1)
      }
    }
    return
  }

  const top = Math.max(70, cy - R * 0.78)
  const bottom = Math.min(H - view.deckH - 130, cy + R * 0.78)
  if (bottom - top < 80) return
  const leftX = 16
  const leftW = Math.min(48, cx - R - 66)
  const rightX = W - 16

  // 左侧：真实工具耗时条。
  if (leftW > 22) {
    setMonoFont(6.5, 500)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(172,176,180,0.40)'
    ctx.fillText('TOOL / MS', leftX, top - 8)
    const rows = 22
    const step = (bottom - top) / rows
    const lat = latencySeries(rows)
    const latMax = Math.max(1, ...lat)
    for (let i = 0; i < rows; i += 1) {
      const v = i >= rows - lat.length ? lat[i - (rows - lat.length)] : 0
      const level = v > 0 ? Math.pow(v / latMax, 0.6) : 0
      const y = top + i * step
      ctx.fillStyle = `rgba(184,188,192,${v > 0 ? 0.10 + level * 0.34 : 0.06})`
      ctx.fillRect(leftX, y, v > 0 ? Math.max(1, leftW * level) : 1, 1)
      if (i % 6 === 0) {
        ctx.fillStyle = 'rgba(184,188,192,0.24)'
        ctx.fillRect(leftX + leftW + 4, y, 4, 1)
      }
    }
  }

  // 右侧：最近事件分类计数，横向条。
  const rows = [
    ['MODEL', counts.model, SEG.model.rgb],
    ['TOOL', counts.tool, SEG.tool.rgb],
    ['NET', counts.net, IN_RGB],
    ['SUB', counts.sub, PROXY_RGB],
  ]
  const max = Math.max(1, ...rows.map((r) => r[1]))
  const rowH = 30
  const sy = Math.max(top, cy - rowH * 1.7)
  setMonoFont(6.5, 500)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(172,176,180,0.36)'
  ctx.fillText('MIX / 200', rightX, sy - 12)
  rows.forEach(([name, n, rgb], i) => {
    const y = sy + i * rowH
    ctx.fillStyle = 'rgba(172,176,180,0.42)'
    ctx.fillText(name, rightX, y)
    ctx.fillStyle = rgba(rgb, 0.72)
    ctx.fillText(String(n).padStart(2, '0'), rightX, y + 9)
    const bw = 44
    ctx.fillStyle = 'rgba(184,188,192,0.07)'
    ctx.fillRect(rightX - bw, y + 13, bw, 1)
    ctx.fillStyle = rgba(rgb, 0.50)
    ctx.fillRect(rightX - bw, y + 13, bw * (n / max), 1)
  })
}

/* ── 仪器框线：角标、标尺、坐标 ─────────────────────────────── */
function drawInstrumentFrame(view, now) {
  if (view.big) return // 巨环模式：不画仪器框与横向网格（灰线），保持纯黑
  const { cx, cy, R } = view
  const m = 14
  const L = 22
  const bottom = H - view.deckH - 10
  ctx.save()
  ctx.strokeStyle = 'rgba(190,194,198,0.20)'
  ctx.lineWidth = 1
  // 左上、右上、右下角标；左下留给大标题。
  for (const [x, y, sx, sy] of [
    [m, m, 1, 1],
    [W - m, m, -1, 1],
    [W - m, bottom, -1, -1],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x + sx * L, y + 0.5)
    ctx.lineTo(x + 0.5, y + 0.5)
    ctx.lineTo(x + 0.5, y + sy * L)
    ctx.stroke()
  }
  // 左侧标尺。
  ctx.strokeStyle = 'rgba(184,188,192,0.10)'
  for (let y = m + 48; y < bottom - 8; y += 18) {
    const major = Math.round((y - m) / 18) % 5 === 0
    ctx.beginPath()
    ctx.moveTo(m, y + 0.5)
    ctx.lineTo(m + (major ? 7 : 3), y + 0.5)
    ctx.stroke()
  }
  // 顶部坐标文字。
  setMonoFont(7, 500)
  ctx.fillStyle = 'rgba(178,182,186,0.42)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('HALO / 01', m + 9, m + 12)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(178,182,186,0.34)'
  ctx.fillText(state.live ? 'TRACE · 实时' : 'TRACE · 回放', W - m - 9, m + 12)
  // 顶部中央：坐标/半径读数。
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(178,182,186,0.24)'
  ctx.fillText(`X ${Math.round(cx)}   Y ${Math.round(cy)}   R ${Math.round(R)}`, cx, m + 12)
  ctx.restore()
}

/* ── 顶部横向时间尺：替代圆形刻度带 ─────────────────────────── */
function drawTimeRuler(view) {
  if (!state.events.length) return
  const x0 = 64
  const x1 = W - 64
  if (x1 - x0 < 120) return
  const y = 64
  const t0 = state.events[0].ts
  const t1 = state.events[state.events.length - 1].ts
  const span = Math.max(1, t1 - t0)
  const bins = 96
  const counts = new Array(bins).fill(0)
  const colors = new Array(bins).fill('200,208,214')
  for (const e of state.events) {
    const idx = clamp(Math.floor(((e.ts - t0) / span) * bins), 0, bins - 1)
    counts[idx] += 1
    if (e.kind === 'tool.call' || e.kind === 'tool.result') colors[idx] = SEG.tool.rgb
    if (isFailureEvent(e)) colors[idx] = APPROVAL_RGB
  }
  const max = Math.max(1, ...counts)
  const curX = x0 + clamp((state.curTs - t0) / span, 0, 1) * (x1 - x0)

  // 基线 + 分格。
  ctx.beginPath()
  ctx.moveTo(x0, y + 0.5)
  ctx.lineTo(x1, y + 0.5)
  ctx.strokeStyle = 'rgba(190,194,198,0.14)'
  ctx.lineWidth = 1
  ctx.stroke()
  for (let i = 0; i <= 16; i += 1) {
    const x = x0 + (i / 16) * (x1 - x0)
    ctx.beginPath()
    ctx.moveTo(x + 0.5, y)
    ctx.lineTo(x + 0.5, y + (i % 4 === 0 ? 5 : 2.5))
    ctx.strokeStyle = 'rgba(190,194,198,0.12)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  // 事件密度波形：比柱状条更安静，也更像仪器。
  const bw = (x1 - x0) / bins
  const smooth = counts.map((v, i) => {
    const a = counts[Math.max(0, i - 1)]
    const b = counts[Math.min(bins - 1, i + 1)]
    return (a + v * 2 + b) / 4
  })
  const smax = Math.max(1, ...smooth)
  const pts = smooth.map((v, i) => [x0 + i * bw, y - (v / smax) * 12])
  const cut = clamp(Math.floor(((curX - x0) / (x1 - x0)) * (bins - 1)), 0, bins - 1)

  // 未来段：压暗的细线。
  ctx.beginPath()
  for (let i = 0; i < pts.length; i += 1) {
    if (i === 0) ctx.moveTo(pts[i][0], pts[i][1])
    else ctx.lineTo(pts[i][0], pts[i][1])
  }
  ctx.strokeStyle = 'rgba(190,194,198,0.10)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 已播放段：亮线 + 极淡填充。
  ctx.beginPath()
  ctx.moveTo(pts[0][0], y)
  for (let i = 0; i <= cut; i += 1) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.lineTo(pts[cut][0], y)
  ctx.closePath()
  ctx.fillStyle = 'rgba(198,202,206,0.06)'
  ctx.fill()
  ctx.beginPath()
  for (let i = 0; i <= cut; i += 1) {
    if (i === 0) ctx.moveTo(pts[i][0], pts[i][1])
    else ctx.lineTo(pts[i][0], pts[i][1])
  }
  ctx.strokeStyle = 'rgba(228,235,240,0.62)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 播放头。
  const px = curX
  ctx.beginPath()
  ctx.moveTo(px + 0.5, y - 18)
  ctx.lineTo(px + 0.5, y + 7)
  ctx.strokeStyle = 'rgba(242,246,248,0.80)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(px - 3, y - 21)
  ctx.lineTo(px + 3, y - 21)
  ctx.lineTo(px, y - 16)
  ctx.closePath()
  ctx.fillStyle = 'rgba(242,246,248,0.9)'
  ctx.fill()

  // 端点标签。
  setMonoFont(7, 500)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(178,182,186,0.40)'
  ctx.textAlign = 'left'
  ctx.fillText(`T0  ${fmtClock(t0)}`, x0, y + 16)
  ctx.textAlign = 'right'
  ctx.fillText(`NOW  ${fmtClock(state.curTs)}`, x1, y + 16)
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(178,182,186,0.26)'
  ctx.fillText('SESSION / EVENT DENSITY', (x0 + x1) / 2, y + 16)
}

/* ── 环 + 扫光 + 疤痕 ───────────────────────────────────────── */
// 主题下方的主频谱：竖向跳动柱属于主体构图，不是边角装饰。
function drawSpectrum(view, now) {
  const { cx, cy, R, deckH, specH } = view
  // 基线 = 环外家具底边 + 布局预留的柱高；布局已按此预留空间。
  const baseline = Math.min(cy + R + 58 + Math.max(specH || 0, 14), H - deckH - 22)
  // 环外还有刻度带（R+44）和停滞标签（R+20）；柱顶必须停在它们之下，不能压到球和环。
  const headroom = baseline - (cy + R + 58)
  if (headroom < 14 || W < 620) return
  const maxH = Math.min(headroom, 72)
  const n = 33
  const gap = 3
  const totalW = Math.min(R * 1.80, W * 0.46)
  const bw = Math.max(2, (totalW - gap * (n - 1)) / n)
  const span = n * bw + (n - 1) * gap
  const x0 = cx - span / 2
  // 左下角有大号状态块，窄窗口里不硬挤，避免和 STEP/CTX 行叠字。
  if (x0 - 12 < 262) return
  // 每根柱子 = 一次 model.end 的真实输出 token 数。
  const vals = tokenOutSeries(n)
  const maxV = Math.max(1, ...vals)

  ctx.fillStyle = 'rgba(190,194,198,0.20)'
  ctx.fillRect(x0 - 12, baseline + 0.5, span + 24, 1)
  ctx.fillStyle = 'rgba(230,234,238,0.45)'
  ctx.fillRect(cx - 0.5, baseline + 1, 1, 4)

  for (let i = 0; i < n; i += 1) {
    const v = i >= n - vals.length ? vals[i - (n - vals.length)] : 0
    const level = v > 0 ? Math.pow(v / maxV, 0.55) : 0
    const bh = v > 0 ? Math.max(2, maxH * level) : 1
    // 槽位不变，实际柱宽收到 5px 以内，和左右仪表的细柱同一语言。
    const sw = Math.min(bw, 5)
    const bx = x0 + i * (bw + gap) + (bw - sw) / 2
    // 基线下方的倒影：只给一点纵向纵深，不抢主体。
    ctx.fillStyle = `rgba(186,190,194,${v > 0 ? 0.04 + level * 0.08 : 0.02})`
    ctx.fillRect(bx, baseline + 1, sw, bh * 0.30)
    ctx.fillStyle = `rgba(214,218,222,${v > 0 ? 0.14 + level * 0.38 : 0.06})`
    ctx.fillRect(bx, baseline - bh, sw, bh)
    if (v > 0) {
      ctx.fillStyle = `rgba(248,250,252,${0.50 + level * 0.44})`
      ctx.fillRect(bx, baseline - bh, sw, 1.3)
    }
  }

  setMonoFont(6.5, 500)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(178,182,186,0.40)'
  ctx.fillText(vals.length ? 'SPECTRUM / TOKEN OUT' : 'SPECTRUM / NO MODEL STEPS', x0 - 12, baseline + 13)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(190,194,198,0.55)'
  ctx.fillText(`${Math.round(state.tokenRateShown || 0)} T/S`, x0 + span + 12, baseline + 13)
}

/* ── 事件卡带：环内侧的厚带，按时间顺序排着最近的真实事件 ─────────
   参考「仪表盘式厚环」的审美，但每张卡都是一条真实事件：
   - 最新事件贴在索引刻痕（环上 0° + spin）处，越旧越逆时针排开；
   - 模型输出 = 若干行微型文字条，行数随输出 token 增长；
   - 工具调用 = 4×5 点阵，图案由工具名哈希决定（同一工具永远同一图案）；
   - 工具返回 = 同图案暗一档 + 底部耗时条；失败 = 灰色斜杠；审批 = 唯一的红框。
   卡带位置用 tapePos 缓动跟随回放指针；用 animNow 推进，暂停即停。 */
let tapePos = null
let tapeLast = 0
function tapeGeomBig(R, usableH) {
  const bandW = clamp(R * 0.2, 96, 190)
  const rOut = R - 5
  const rIn = rOut - bandW
  const slotPx = clamp(usableH * 0.085, 46, 70)
  const slot = slotPx / ((rIn + rOut) / 2)
  // 可见竖弧的半角；卡带头（最新）在弧上部，旧事件顺时针向下流走。
  const halfVis = Math.asin(clamp((usableH / 2 + 30) / R, 0, 1))
  return { bandW, rIn, rOut, rMid: (rIn + rOut) / 2, N: 90, slot, on: true, big: true, head: -halfVis * 0.92, halfVis }
}
function tapeGeom(view) {
  if (view.big) return tapeGeomBig(view.R, view.usableH)
  const { R } = view
  const bandW = clamp(R * 0.13, 18, 40)
  const rOut = R - 5
  const rIn = rOut - bandW
  const slotPx = clamp(R * 0.11, 18, 30)
  const N = Math.round(clamp((TAU * (rIn + rOut) / 2) / slotPx, 28, 72))
  return { bandW, rIn, rOut, rMid: (rIn + rOut) / 2, N, slot: TAU / N, on: R >= 110 }
}
function tapeAdvance(now) {
  const target = state.pointer
  // 只有跨度很大（拖时间轴/跳转）才直接对齐；连续到达的多个事件一律平滑推入，不再一帧跳 4 格。
  const dtT = Math.max(0, now - tapeLast)
  if (tapePos == null || Math.abs(target - tapePos) > 40 || dtT === 0 && state.scrubbing) tapePos = target
  else tapePos += (target - tapePos) * (1 - Math.exp(-dtT / 220))
  tapeLast = now
}

// 巨环卡带布局：参考 haloflux 的做法——每个事件是一条“径向条带”，长边沿半径铺满环带，
// 短边（高度）沿圆周，条带之间留小缝；许多直条带绕弧排开，整体就自然贴合弧形。
// 条带高度由事件数据决定：模型输出越多越高、工具耗时越长越高、调用本身很窄。
const STRIP_GAP = 4
function stripH(e) {
  if (!e) return 14
  if (e.kind === 'model.end') return Math.round(28 + 34 * rayLevel(e))
  if (e.kind === 'tool.result') return Math.round(24 + 26 * rayLevel(e))
  if (e.kind === 'tool.call') return 18
  if (e.kind === 'user.message' || e.kind === 'approval.request') return 24
  return 14
}
const bigLayoutMemo = { key: '', map: null, list: null }
// 空闲呼吸：没有任务在跑（等人/空闲）时，卡带环像呼吸一样小幅正反来回摆动（约 ±0.9°，周期 7.5s）；
// agent 一开始干活，摆幅在约 1 秒内平滑收回到 0。用动画时钟：暂停即停。
let swayW = 0
let swayLast = 0
function idleSway() {
  // 用户要求：放大模式下没事就要呼吸——暂停/播完也摆，所以这里用真实时钟而不是动画时钟（唯一例外）。
  const now = performance.now()
  // “静止”按画面判断而不是相位：卡带没在推进（指针已追上）就呼吸；1× 回放里模型/工具长时间
  // 没有新事件时环也不再僵住。新事件到来、卡带开始推进时摆幅平滑收回。
  const idle = tapePos == null || Math.abs(state.pointer - tapePos) < 0.05
  const dt = clamp(now - swayLast, 0, 100)
  swayLast = now
  swayW += ((idle ? 1 : 0) - swayW) * (1 - Math.exp(-dt / 900))
  return swayW * 0.045 * Math.sin((now / 7500) * TAU)
}
function bigLayout(g) {
  const sway = idleSway()
  const key = `${tapePos}|${state.pointer}|${state.events.length}|${g.rMid}|${g.head}|${sway.toFixed(5)}`
  if (bigLayoutMemo.key === key && bigLayoutMemo.events === state.events) return bigLayoutMemo
  const map = new Map()
  const list = []
  const ptr = Math.min(state.pointer, state.events.length - 1)
  if (ptr >= 0 && tapePos != null) {
    // 新事件到达时 tapePos 落后于指针：整条带向“头”方向退回一个新条带的高度，随后缓动推入。
    // 未“推入”的部分按像素累加（多个事件同时到达也连续滑动，原来 clamp 到 1 格导致跳变）。
    let lagPx = 0
    for (let k = ptr; k > tapePos && k > ptr - 60; k -= 1) lagPx += Math.min(1, k - tapePos) * (stripH(state.events[k]) + STRIP_GAP)
    let y = g.head * g.rMid - lagPx
    const yEnd = g.halfVis * g.rMid + 80
    for (let i = ptr; i >= 0 && y < yEnd; i -= 1) {
      const h = stripH(state.events[i])
      const c = y + h / 2
      const it = { i, a: c / g.rMid + sway, h, age: list.length }
      map.set(i, it)
      list.push(it)
      y += h + STRIP_GAP
    }
  }
  Object.assign(bigLayoutMemo, { key, map, list, events: state.events })
  return bigLayoutMemo
}
function tapeAngle(idx, g) {
  if (g.big) {
    const it = bigLayout(g).map.get(idx)
    return it ? it.a : Math.PI
  }
  // 小环模式同样呼吸摆动（大图模式在 bigLayout 里已加）。
  return ringAngle(0) - (tapePos - idx) * g.slot + idleSway()
}
function tapeVisible(idx, g) {
  if (g.big) return bigLayout(g).map.has(idx)
  return tapePos != null && idx >= 0 && idx <= state.pointer && tapePos - idx <= g.N - 0.6
}

function rayStreak(i) {
  // 同一工具连续调用次数（到 i 为止，中间夹着别的工具调用即中断）。
  const e = state.events[i]
  const tool = String(e.tool || '')
  let n = 0
  for (let k = i; k >= 0 && k > i - 40; k -= 1) {
    const x = state.events[k]
    if (x.kind !== 'tool.call') continue
    if (String(x.tool || '') !== tool) break
    n += 1
  }
  return clamp(n, 1, 5)
}

// 每种事件的光线语言（全部来自事件字段，没有随机装饰）：
//   模型输出  实线；长度 = 输出 token；根数 1–4 随输出量；粗细 = 上下文占用比例。
//   工具返回  实线；长度 = 耗时；根数 = 同工具连续调用次数；粗细随耗时；失败 = 灰色断线。
//   工具调用  短虚线（发起）；根数 = 同工具连续调用次数。
//   用户输入  琥珀单线；子任务 = 分叉双线；审批 = 唯一的红线；错误 = 灰色断线。
// 亮度不按墙钟/会话时间衰减，而是“被同类后续事件顶替一次就暗一档”（×0.7）；没有新事件就保持。
// 光柱只用三种颜色（克制）：模型＝金、工具＝青绿、其余（用户/子任务）＝白；失败灰、审批红是例外标记。
const RAY_MODEL_RGB = '242,198,110'
const RAY_TOOL_RGB = '96,226,176'
function raySpec(e, i) {
  const failed = isFailureEvent(e)
  if (e.kind === 'model.end') {
    const lvl = rayLevel(e)
    const ratio = e.context && Number(e.context.ratio) > 0 ? clamp(Number(e.context.ratio), 0, 1) : 0
    return { lvl, lines: 1 + Math.floor(lvl * 3), width: 1.1 + 1.8 * ratio, rgb: RAY_MODEL_RGB, dash: null }
  }
  if (e.kind === 'tool.result') {
    const lvl = Math.max(0.12, rayLevel(e))
    return { lvl, lines: rayStreak(i), width: 1.2 + 1.0 * lvl, rgb: failed ? FAIL_RGB : RAY_TOOL_RGB, dash: failed ? [2, 3] : null }
  }
  if (e.kind === 'tool.call') return { lvl: 0.16, lines: rayStreak(i), width: 1.2, rgb: RAY_TOOL_RGB, dash: [3, 3], weak: true }
  if (e.kind === 'user.message') return { lvl: 0.5, lines: 1, width: 1.6, rgb: '232,236,240', dash: null }
  if (e.kind === 'subagent.start') return { lvl: 0.4, lines: 2, width: 1.3, rgb: '232,236,240', dash: null, fork: true }
  if (e.kind === 'approval.request') return { lvl: 0.8, lines: 1, width: 1.9, rgb: APPROVAL_RGB, dash: null }
  if (e.kind === 'error') return { lvl: 0.3, lines: 1, width: 1.3, rgb: FAIL_RGB, dash: [3, 3] }
  return null
}

// 光柱贴图（巨环模式）：预渲染一次，之后每束光柱只是一次 drawImage，替代每帧上百个渐变对象。
// 扫描条纹：1px 横线叠成的带，亮度沿长度衰减，并有确定性的块状缺口，像信号残影。
const raySprites = new Map()
function raySprite(rgb) {
  let sp = raySprites.get(rgb)
  if (sp) return sp
  const w = 256
  const h = 16
  const scan = document.createElement('canvas')
  scan.width = w
  scan.height = h
  const c = scan.getContext('2d')
  let seed = hash32(rgb)
  const rnd = () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0; return (seed & 1023) / 1023 }
  for (let y = 0; y < h; y += 1) {
    // 高反差：亮行接近纯白、暗行全黑，避免叠加后发灰。
    const rowA = y % 2 === 0 ? 0.8 + 0.2 * rnd() : 0
    let x = 0
    while (x < w) {
      const seg = 6 + Math.floor(rnd() * 40)
      const on = rnd() > 0.3
      if (on) {
        const fall = Math.pow(1 - x / w, 0.9)
        c.fillStyle = `rgba(${rgb},${rowA * fall * (0.6 + 0.4 * rnd())})`
        c.fillRect(x, y, seg, 1)
      }
      x += seg
    }
  }
  const glow = document.createElement('canvas')
  glow.width = 128
  glow.height = 16
  const gc = glow.getContext('2d')
  const gh = gc.createLinearGradient(0, 0, 128, 0)
  gh.addColorStop(0, `rgba(${rgb},1)`)
  gh.addColorStop(1, `rgba(${rgb},0)`)
  gc.fillStyle = gh
  gc.fillRect(0, 0, 128, 16)
  gc.globalCompositeOperation = 'destination-in'
  const gv = gc.createLinearGradient(0, 0, 0, 16)
  gv.addColorStop(0, 'rgba(0,0,0,0)')
  gv.addColorStop(0.5, 'rgba(0,0,0,1)')
  gv.addColorStop(1, 'rgba(0,0,0,0)')
  gc.fillStyle = gv
  gc.fillRect(0, 0, 128, 16)
  const pack = document.createElement('canvas')
  pack.width = 64
  pack.height = 4
  const pc = pack.getContext('2d')
  const pg = pc.createLinearGradient(0, 0, 64, 0)
  pg.addColorStop(0, `rgba(${rgb},0)`)
  pg.addColorStop(1, 'rgba(250,252,254,1)')
  pc.fillStyle = pg
  pc.fillRect(0, 0, 64, 4)
  sp = { scan, glow, pack }
  raySprites.set(rgb, sp)
  return sp
}

const rayAnim = new Map()
let rayAnimLast = 0
function drawTapeRays(view, now) {
  const g = tapeGeom(view)
  if (!g.on || state.pointer < 0 || tapePos == null) return
  const { cx, cy, R } = view
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const lo = Math.max(0, Math.ceil(tapePos) - g.N + 1)
  const later = new Map()
  // 拖影角 = 角速度 × 180 会话毫秒，限幅；平时只有底速，几乎没有拖影。
  const smear = clamp((ringSpinVel() - SPIN_BASE) * 180, 0, 0.12)
  const smearN = smear > 0.006 ? 3 : 0
  const beamK = view.big ? clamp(view.usableH / 160, 2.4, 4.2) : clamp(R / 110, 1.6, 3.2)
  // 生长动画用动画时钟（播放时按真实帧推进、暂停即停），不再用会话时间：
  // 4× 回放时会话时间 2.5s 只有 0.6s 真实时间，看起来像“刷”出来。
  const rdt = clamp(now - rayAnimLast, 0, 100)
  rayAnimLast = now
  const seen = new Set()
  for (let i = Math.min(state.pointer, state.events.length - 1); i >= lo; i -= 1) {
    const e = state.events[i]
    const key = rayKey(e)
    const n = key ? (later.get(key) || 0) : 0
    if (key) later.set(key, n + 1)
    const sp = raySpec(e, i)
    if (!sp) continue
    if (view.big && !tapeVisible(i, g)) continue
    // 光柱：宽度随画面尺寸放大（R=268 时约 ×2.4），参考视频里是粗光束而不是发丝。
    sp.width *= beamK
    // 巨环模式保底 0.22：被顶替的旧光柱仍留在通道里当底纹，让右侧铺满。
    const fadeT = view.big ? Math.max(0.3, Math.pow(0.6, n)) : Math.pow(0.7, n)
    if (fadeT < 0.04) continue
    // 每束光柱的生长与粗细都是平滑过渡：出生后 1.1 秒（动画时间）从环上长出来；
    // 被同类新事件顶替时，粗细/亮度在约 0.3 秒内缓缓收窄，而不是一帧跳变。
    let ra = rayAnim.get(e.event_id)
    // 暂停/跳转时动画时钟不走：新出现的光柱直接视为已长成，否则一直是 0 长度（看起来“光柱没了”）
    if (!ra) { ra = { born: state.playing ? now : now - 5000, f: fadeT }; rayAnim.set(e.event_id, ra) }
    seen.add(e.event_id)
    ra.f += (fadeT - ra.f) * (1 - Math.exp(-rdt / 300))
    const fade = ra.f
    const a0 = tapeAngle(i, g)
    const hf = (hash32(e.event_id) & 1023) / 1023
    // 巨环：光柱至少射出 45% 的可用宽度，右侧不再大片空白；数值越大越长。
    const fullLen = view.big ? view.rayMax * (0.7 + 0.3 * sp.lvl) * (0.9 + 0.1 * hf) : R * (0.08 + 0.46 * sp.lvl) * (0.8 + 0.2 * hf)
    const growT = clamp((now - ra.born) / 1100, 0, 1)
    const grow = 1 - Math.pow(1 - growT, 3)
    const len = fullLen * grow
    if (len < 1) continue
    const isCur = i === state.pointer
    const alpha = 0.42 * fade * (0.45 + 0.55 * sp.lvl) * (sp.weak ? 0.6 : 1) * (isCur ? 1.4 : 1)
    const muzzle = 1 - grow
    const pk = key ? fx.rayPackets.filter((p) => p.key === key && p.index >= i) : []
    // 巨环模式：光柱从卡片所在的弧点水平向右射出（平行光柱通道）；经典模式：沿半径向外。
    const big = !!view.big
    const ptAt = (aa, r, fk) => {
      if (!big) return polar(cx, cy, r, aa)
      const [ox, oy] = polar(cx, cy, R + 3, aa)
      return [ox + (r - R - 3), oy + (r - R - 3) * fk]
    }
    if (big) {
      // 巨环：光柱沿条带自身的半径方向延伸——像条带被“拉长”射出，和卡片严丝合缝。
      // 由一组锐利的矢量细线组成（不是贴图缩放），纯白对纯黑，任何角度都清晰。
      // 厚度 = 条带高度 ×(0.3 + 0.65·fade)：刚发生的几乎和卡片一样宽，被顶替后收成几根细线。
      const it = bigLayout(g).map.get(i)
      // 律动：
      //  ① 呼吸：一道慢波沿弧从上往下传（相位随角度错开），光柱长度 ±8%、亮度 ±25% 起伏，7s 一周期；
      //  ② 节拍：同一工具/模型每来一次真实事件，它的所有光柱同时“踢”一下——伸长 18%、变亮，600ms 回落。
      const tReal = performance.now()
      const br = 0.5 + 0.5 * Math.sin((tReal / 7000) * TAU - a0 * 9)
      let beat = 0
      for (const p of pk) beat += Math.exp(-Math.max(0, now - p.start) / 600) * p.power
      beat = Math.min(1.5, beat)
      const pulseLen = 0.92 + 0.08 * br + 0.18 * beat
      const pulseA = 0.75 + 0.25 * br + 0.6 * beat
      const T = Math.max(2, (it ? it.h : 20) * (0.3 + 0.65 * fade) * (1 + 0.25 * beat))
      // 线的数量与位置固定（按最大宽度），不随粗细变化而增减——避免线条“凭空出现/消失”。
      // 宽度收窄时，外侧的线是缩回根部；变宽时是从根部长出去。
      const Tmax = Math.max(4, (it ? it.h : 20) * 0.95 * 1.25)
      // 稀疏（用户：全亮时太密）：线间距 6 → 12px
      const n = Math.max(2, Math.floor(Tmax / 12))
      const ca = Math.cos(a0)
      const sa = Math.sin(a0)
      const nx = -sa
      const ny = ca
      const [bx0, by0] = polar(cx, cy, R + 2, a0)
      let seed = hash32(e.event_id)
      const rnd = () => { seed = Math.imul(seed ^ (seed >>> 13), 1274126177) >>> 0; return (seed & 1023) / 1023 }
      const bright = new Path2D()
      const dim = new Path2D()
      const tint = new Path2D()
      const isTinted = sp.rgb !== '232,236,240'
      const ends = []
      for (let k = 0; k < n; k += 1) {
        const o = n === 1 ? 0 : -Tmax / 2 + (k * Tmax) / (n - 1)
        const inside = clamp((T / 2 - Math.abs(o)) / 8 + 1, 0, 1)
        const insideE = inside * inside * (3 - 2 * inside)
        // 每根细线错开 0–180ms 起长，像一束纤维依次伸出来
        const lag = rnd() * 180
        const gk = 1 - Math.pow(1 - clamp((now - ra.born - lag) / 1100, 0, 1), 3)
        const lk = fullLen * (0.7 + 0.3 * rnd()) * gk * pulseLen * insideE
        const s0 = 0
        rnd()
        const isBright = rnd() < 0.3
        if (lk < 1) continue
        const x0 = bx0 + nx * o + ca * s0
        const y0 = by0 + ny * o + sa * s0
        // 发散：越往外，线与线的间距越大（末端横向偏移放大到 1+2.2×行程比例），整束呈扇形张开
        const fan = 1 + 2.2 * (lk / Math.max(1, view.rayMax))
        const x1 = bx0 + nx * o * fan + ca * lk
        const y1 = by0 + ny * o * fan + sa * lk
        // 以白为主：只有约 1/6 的线带类型色（点缀），其余亮/暗线都是白
        const pth = (k % 6 === 2 && isTinted) ? tint : isBright ? bright : dim
        pth.moveTo(x0, y0)
        pth.lineTo(x1, y1)
        ends.push([o, lk])
      }
      ctx.lineCap = 'butt'
      // 加粗（用户：有点细）：亮线 2.2px，暗线 1.4px，亮线下再垫一层 6px 淡光
      ctx.lineWidth = 18
      const keep = (sp.rgb === FAIL_RGB || sp.rgb === APPROVAL_RGB) ? sp.rgb : '255,255,255'
      ctx.strokeStyle = rgba(keep, Math.min(0.25, alpha * 0.5 * pulseA))
      ctx.stroke(bright)
      ctx.lineWidth = 7
      ctx.strokeStyle = rgba(keep, Math.min(1, alpha * 3.2 * (1 + 0.5 * muzzle) * pulseA))
      ctx.stroke(bright)
      ctx.lineWidth = 5
      ctx.strokeStyle = rgba(keep, Math.min(1, alpha * 1.3 * pulseA))
      ctx.stroke(dim)
      ctx.lineWidth = 5
      ctx.strokeStyle = rgba(sp.rgb, Math.min(1, alpha * 2.6 * pulseA))
      ctx.stroke(tint)
      // 光包：沿半径跑的一段 2px 纯白亮线
      for (const p of pk) {
        const ph = clamp((now - p.start) / p.dur, 0, 1)
        if (ph <= 0 || ph >= 1) continue
        const r1 = R + 2 + len * ph
        const r0 = Math.max(R + 2, r1 - Math.min(60, len * 0.3))
        const pa = Math.min(1, (0.5 + alpha * 1.6) * p.power * Math.sin(Math.PI * ph))
        for (const o of [-T * 0.25, T * 0.25]) {
          ctx.beginPath()
          ctx.moveTo(cx + ca * r0 + nx * o, cy + sa * r0 + ny * o)
          ctx.lineTo(cx + ca * r1 + nx * o, cy + sa * r1 + ny * o)
          ctx.strokeStyle = `rgba(255,255,255,${pa})`
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
      continue
    }
    for (let j = 0; j < sp.lines; j += 1) {
      const fk = sp.fork ? (j ? 0.06 : -0.06) : 0
      const a = sp.fork && !big ? a0 + (j ? 0.035 : -0.035) : a0
      const tx = big ? 0 : -Math.sin(a)
      const ty = big ? 1 : Math.cos(a)
      const off = sp.fork ? 0 : (j - (sp.lines - 1) / 2) * (1.2 + sp.width * 1.15)
      const lj = len * (1 - j * 0.07)
      const [x0, y0] = ptAt(a, R + 3, fk)
      const [x1, y1] = ptAt(a, R + 3 + lj, fk)
      // 小图同样以白为主：线芯白色（失败灰/审批红除外），类型色只用在线下的淡光晕上作点缀
      const coreRgb = (sp.rgb === FAIL_RGB || sp.rgb === APPROVAL_RGB) ? sp.rgb : '255,255,255'
      const gr = ctx.createLinearGradient(x0, y0, x1, y1)
      gr.addColorStop(0, rgba(coreRgb, alpha * 0.7))
      gr.addColorStop(1, rgba(coreRgb, alpha * 0.9 * muzzle))
      const gg = ctx.createLinearGradient(x0, y0, x1, y1)
      // 光晕也用白：小图线细、光晕宽，带色光晕会让整束看起来是彩色的（用户反馈）
      gg.addColorStop(0, rgba(coreRgb, alpha * 0.9))
      gg.addColorStop(1, rgba(coreRgb, 0))
      // 运动拖影：环被事件“踢”转时，光柱沿转动反方向留下几道残影；角速度回落即消失。
      for (let k = smearN; k >= 1; k -= 1) {
        const sa = a - smear * (k / smearN)
        const [sx0, sy0] = ptAt(sa, R + 3, fk)
        const [sx1, sy1] = ptAt(sa, R + 3 + lj * (1 - 0.12 * k / smearN), fk)
        const sg = ctx.createLinearGradient(sx0, sy0, sx1, sy1)
        sg.addColorStop(0, rgba(coreRgb, alpha * 0.30 * (1 - k / (smearN + 1))))
        sg.addColorStop(1, rgba(coreRgb, 0))
        ctx.beginPath()
        ctx.moveTo(sx0 + tx * off, sy0 + ty * off)
        ctx.lineTo(sx1 + tx * off, sy1 + ty * off)
        ctx.strokeStyle = sg
        ctx.lineWidth = sp.width * 1.8
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(x0 + tx * off, y0 + ty * off)
      ctx.lineTo(x1 + tx * off, y1 + ty * off)
      ctx.strokeStyle = gg
      ctx.globalAlpha = 0.28
      ctx.lineWidth = sp.width * 3.2
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.strokeStyle = gr
      ctx.setLineDash(sp.dash || [])
      ctx.lineWidth = sp.width
      ctx.stroke()
      ctx.setLineDash([])
      for (const p of pk) {
        const ph = clamp((now - p.start) / p.dur - j * 0.06, 0, 1)
        if (ph <= 0 || ph >= 1) continue
        const rHead = R + 3 + lj * ph
        const seg = Math.min(big ? 40 : 14, lj * 0.25)
        const [hx, hy] = ptAt(a, rHead, fk)
        const [bx, by] = ptAt(a, Math.max(R + 3, rHead - seg), fk)
        const pa = Math.min(0.9, (0.25 + alpha * 1.6) * p.power * Math.sin(Math.PI * ph))
        const pg = ctx.createLinearGradient(bx, by, hx, hy)
        pg.addColorStop(0, rgba(sp.rgb, 0))
        pg.addColorStop(1, rgba(sp.rgb === '232,236,240' ? '244,247,250' : sp.rgb, pa))
        ctx.beginPath()
        ctx.moveTo(bx + tx * off, by + ty * off)
        ctx.lineTo(hx + tx * off, hy + ty * off)
        ctx.strokeStyle = pg
        ctx.lineWidth = sp.width * 1.25
        ctx.stroke()
      }
    }
  }
  ctx.restore()
  for (const k of rayAnim.keys()) if (!seen.has(k)) rayAnim.delete(k)
}

// 环外特效的角度：事件仍在卡带上时，从它自己的卡片位置出发；否则退回哈希角。
// drawPulses / drawMarkers / hitTest 共用，保证画的位置和点得中的位置一致。
function fxAngle(view, staticAngle, index) {
  const g = tapeGeom(view)
  if (g.on && tapePos != null && index >= 0 && tapeVisible(index, g)) return tapeAngle(index, g)
  return ringAngle(staticAngle)
}

function drawTape(view, now) {
  const g = tapeGeom(view)
  if (!g.on) return
  tapeAdvance(now)
  const { cx, cy } = view
  // 底带：深色实心厚环 + 内外两条发丝边，是整幅画面的“机械骨架”。
  ctx.beginPath()
  ctx.arc(cx, cy, g.rOut, 0, TAU)
  ctx.arc(cx, cy, g.rIn, 0, TAU, true)
  ctx.fillStyle = '#040404'
  ctx.fill()
  for (const r of [g.rIn, g.rOut]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, TAU)
    ctx.strokeStyle = 'rgba(200,204,208,0.16)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  if (state.pointer < 0 || tapePos == null) return

  if (g.big) { drawTapeCardsBig(view, g); return }
  const cw = g.rMid * g.slot * 0.80
  const ch = g.bandW * 0.78
  const lo = Math.max(0, Math.ceil(tapePos) - g.N + 1)
  for (let i = Math.min(state.pointer, state.events.length - 1); i >= lo; i -= 1) {
    const e = state.events[i]
    const age = tapePos - i
    if (age > g.N - 0.6) continue
    const heat = clamp(1 - age / g.N, 0, 1)
    const cur = i === state.pointer
    const sel = i === state.selected
    const base = cur ? 1 : 0.18 + 0.62 * heat * heat
    const a = tapeAngle(i, g)
    const [px, py] = polar(cx, cy, g.rMid, a)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(a + Math.PI / 2)
    const x0 = -cw / 2
    const y0 = -ch / 2
    const failed = isFailureEvent(e)
    const approval = e.kind === 'approval.request'
    const rgb = approval ? APPROVAL_RGB : failed ? FAIL_RGB
      : e.kind === 'user.message' ? SEG.waiting_user.rgb : '222,226,230'
    // 卡框
    ctx.strokeStyle = rgba(rgb, (approval ? 0.9 : 0.16) * (cur || sel ? 2.2 : 1) * (0.4 + 0.6 * heat))
    ctx.lineWidth = approval || cur || sel ? 1.4 : 1
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1)
    if (cur) {
      ctx.fillStyle = 'rgba(232,236,240,0.07)'
      ctx.fillRect(x0, y0, cw, ch)
    }
    const h = hash32(e.tool || e.label || e.kind)
    const ix = x0 + 2.5
    const iw = cw - 5
    if (e.kind === 'tool.call' || e.kind === 'tool.result') {
      const cols = 4
      const rows = 5
      const cell = Math.min(iw / cols, (ch - 7) / rows)
      const gx = ix + (iw - cell * cols) / 2
      const gy = y0 + 2.5
      const dim = e.kind === 'tool.result' ? 0.5 : 1
      ctx.fillStyle = rgba(rgb, base * 0.85 * dim)
      for (let k = 0; k < cols * rows; k += 1) {
        if (!((h >>> k) & 1)) continue
        ctx.fillRect(gx + (k % cols) * cell + 0.4, gy + Math.floor(k / cols) * cell + 0.4, cell - 1, cell - 1)
      }
      if (e.kind === 'tool.result') {
        const d = clamp(Math.log10(1 + (Number(e.duration_ms) || 0)) / Math.log10(1 + 60000), 0, 1)
        ctx.fillStyle = rgba(rgb, base * 0.9)
        ctx.fillRect(ix, y0 + ch - 3, Math.max(1, iw * d), 1.2)
      }
    } else {
      // 文字条：模型输出按 token 数决定行数，其余事件一到两行。
      let rowsOn = 1
      if (e.kind === 'model.end') {
        const out = e.tokens ? Number(e.tokens.out) || 0 : 0
        rowsOn = 1 + Math.round(clamp(Math.log10(1 + out) / Math.log10(1 + 8000), 0, 1) * 5)
      } else if (e.kind === 'user.message' || approval) rowsOn = 2
      const rowH = (ch - 5) / 6
      ctx.fillStyle = rgba(rgb, base * 0.8)
      for (let r = 0; r < rowsOn; r += 1) {
        const frac = 0.35 + 0.65 * (((h >>> (r * 3)) & 7) / 7)
        ctx.fillRect(ix, y0 + 2.5 + r * rowH, Math.max(2, iw * frac), Math.max(0.8, rowH * 0.42))
      }
    }
    if (failed) {
      ctx.beginPath()
      ctx.moveTo(x0 + 1.5, y0 + ch - 1.5)
      ctx.lineTo(x0 + cw - 1.5, y0 + 1.5)
      ctx.strokeStyle = rgba(FAIL_RGB, 0.75 * (0.4 + 0.6 * heat))
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.restore()
  }
}

// 巨环模式的卡片 = 一块小仪表（参考 haloflux 环带），每块对应卡带上的一个真实事件：
//   标题行：工具名 / MODEL / USER（大写粗体）+ 右侧大数字（该工具第几次调用 / 输出 token）
//   数值表：工具 → 耗时、状态、该工具平均耗时；模型 → in / out / ctx
//   右侧：工具 = 该工具最近 24 次耗时的方格热力图；模型 = 最近 16 次输出的折线
// 两侧梳齿：外圈是随环自转的精细刻度；内圈每根齿的长度 = 那个位置上事件的数值（耗时/输出量）。
// 弧内亮线束：同一工具连续调用 ≥2 次时，在它的卡片内侧画一束平行亮线，根数 = 连续次数 × 2。
function tapeStats() {
  const tools = new Map()
  const outs = []
  const lo = Math.max(0, state.pointer - 600)
  for (let i = lo; i <= state.pointer && i < state.events.length; i += 1) {
    const e = state.events[i]
    if (e.kind === 'tool.call') {
      const k = e.tool || ''
      if (!tools.has(k)) tools.set(k, { calls: 0, durs: [], idxCalls: new Map() })
      const t = tools.get(k)
      t.calls += 1
      t.idxCalls.set(i, t.calls)
    } else if (e.kind === 'tool.result') {
      const k = e.tool || ''
      if (!tools.has(k)) tools.set(k, { calls: 0, durs: [], idxCalls: new Map() })
      tools.get(k).durs.push({ i, ms: Number(e.duration_ms) || 0, fail: isFailureEvent(e) })
    } else if (e.kind === 'model.end' && e.tokens) outs.push({ i, out: Number(e.tokens.out) || 0 })
  }
  return { tools, outs }
}

const stripCache = new Map()
function stripCanvas(e, i, w, h) {
  const key = `${e.event_id}|${i}|${Math.round(w)}|${h}`
  let cv = stripCache.get(key)
  if (cv) return cv
  const S = Math.max(2, DPR)
  cv = document.createElement('canvas')
  cv.width = Math.max(4, Math.round(w * S))
  cv.height = Math.max(4, Math.round(h * S))
  const c = cv.getContext('2d')
  c.scale(S, S)
  renderStrip(c, e, i, w, h)
  stripCache.set(key, cv)
  if (stripCache.size > 260) stripCache.delete(stripCache.keys().next().value)
  return cv
}

// 一条条带的内容（只依赖该事件及其之前的数据，所以可以缓存）：
//   左缘色条 · 大写标题 · 右侧数值 · 第二行明细 · 高条带再加方格热力图 / 输出折线 · 底部数值条
function renderStrip(c, e, i, w, h) {
  const failed = isFailureEvent(e)
  const approval = e.kind === 'approval.request'
  const rgb = approval ? APPROVAL_RGB : failed ? FAIL_RGB : e.kind === 'user.message' ? SEG.waiting_user.rgb : '255,255,255'
  c.fillStyle = '#050505'
  c.fillRect(0, 0, w, h)
  c.fillStyle = rgba(rgb, approval ? 0.95 : 0.55)
  c.fillRect(0, 0, 2, h)
  const tool = String(e.tool || '').replace(/^mcp__[^_]+__/, '')
  let title = tool
  let value = ''
  let sub = ''
  if (e.kind === 'model.end') {
    title = 'MODEL'
    value = e.tokens ? `${e.tokens.out || 0}` : ''
    const ratio = e.context ? Math.round((Number(e.context.ratio) || 0) * 100) : 0
    sub = `in ${e.tokens ? e.tokens.in || 0 : 0} · ctx ${ratio}%`
  } else if (e.kind === 'tool.result') {
    value = fmtDuration(e.duration_ms)
    sub = `${failed ? 'FAIL' : 'OK'} · ${e.label || ''}`
  } else if (e.kind === 'tool.call') {
    value = `×${rayStreak(i)}`
    sub = e.label || ''
  } else {
    title = kindLabel(e.kind)
    sub = e.label || ''
  }
  const pad = 6
  c.textBaseline = 'middle'
  if (h < 22) {
    c.font = `700 8px ${FONT_MONO}`
    c.textAlign = 'left'
    c.fillStyle = rgba(rgb, 0.95)
    c.fillText(truncate(title.toUpperCase(), 12), pad, h / 2)
    c.font = `500 7px ${FONT_MONO}`
    c.textAlign = 'right'
    c.fillStyle = rgba(rgb, 0.8)
    c.fillText(value, w - pad, h / 2)
    return
  }
  c.font = `700 ${h >= 40 ? 10 : 8.5}px ${FONT_MONO}`
  c.textAlign = 'left'
  c.fillStyle = rgba(rgb, 0.98)
  c.fillText(truncate(title.toUpperCase(), 12), pad, 8)
  c.font = `500 ${h >= 40 ? 9 : 7.5}px ${FONT_MONO}`
  c.textAlign = 'right'
  c.fillStyle = rgba(rgb, 0.9)
  c.fillText(value, w - pad, 8)
  c.font = `500 7px ${FONT_MONO}`
  c.textAlign = 'left'
  c.fillStyle = 'rgba(200,204,208,0.95)'
  const half = h >= 40 ? w * 0.5 : w - pad * 2
  c.fillText(truncate(sub, Math.max(6, Math.floor(half / 4.3))), pad, 19)
  if (h >= 40) {
    const vx = w * 0.56
    const vw = w - vx - pad
    const vy = 15
    const vh = h - vy - 7
    if (e.kind === 'model.end') {
      const os = lastEventsBefore(i, 16, (x) => x.kind === 'model.end' && x.tokens)
      if (os.length > 1) {
        const mx = Math.max(1, ...os.map((x) => Number(x.tokens.out) || 0))
        c.beginPath()
        os.forEach((x, k) => {
          const px = vx + (k / (os.length - 1)) * vw
          const py = vy + vh - ((Number(x.tokens.out) || 0) / mx) * vh
          if (k) c.lineTo(px, py); else c.moveTo(px, py)
        })
        c.strokeStyle = rgba(rgb, 0.9)
        c.lineWidth = 1
        c.stroke()
      }
    } else if (e.tool) {
      const ds = lastEventsBefore(i, 24, (x) => x.kind === 'tool.result' && x.tool === e.tool)
      const cols = 8
      const rowsN = 3
      const cs = Math.min(vw / cols, vh / rowsN)
      for (let k = 0; k < cols * rowsN; k += 1) {
        const d = ds[k]
        const lv = d ? clamp(Math.log10(1 + (Number(d.duration_ms) || 0)) / Math.log10(1 + 60000), 0, 1) : 0
        c.fillStyle = d ? (isFailureEvent(d) ? rgba(FAIL_RGB, 0.9) : rgba('228,232,236', 0.12 + 0.82 * lv)) : 'rgba(70,74,78,0.35)'
        c.fillRect(vx + (k % cols) * cs + 0.5, vy + Math.floor(k / cols) * cs + 0.5, cs - 1.3, cs - 1.3)
      }
    }
  }
  const lv = e.kind === 'tool.call' ? 0.2 : rayLevel(e)
  c.fillStyle = rgba(rgb, 0.16)
  c.fillRect(pad, h - 3, w - pad * 2, 1)
  c.fillStyle = rgba(rgb, 0.9)
  c.fillRect(pad, h - 3, Math.max(1, (w - pad * 2) * lv), 1)
}
function lastEventsBefore(i, max, pred) {
  const out = []
  for (let k = i; k >= 0 && out.length < max && k > i - 600; k -= 1) {
    const x = state.events[k]
    if (x && pred(x)) out.push(x)
  }
  return out.reverse()
}

// 多环差速：每道环有自己的方向与速度，并各自对应一个真实量（动画时钟积分，暂停即停）。
//   A 外圈刻度：顺时针匀速 = 时间流逝（见下方 spin）
//   B 外侧细刻环（rOut+44）：逆时针，速度 ∝ 当前输出速率 token/s（模型越能写转得越快）
//   C 内侧虚线环（rIn−34）：顺时针慢转，工具运行中加速 ×3（工具在跑）
//   D 最内点阵环（rIn−46）：逆时针极慢，等人时几乎停住
const ringPhase = { B: 0, C: 0, D: 0, last: 0 }
function advanceRingPhases() {
  const now = state.animNow
  const dt = clamp(now - ringPhase.last, 0, 100)
  ringPhase.last = now
  const rate = clamp((state.tokenRateShown || 0) / 60, 0, 3)
  ringPhase.B -= dt * 0.00006 * (0.4 + rate)
  ringPhase.C += dt * 0.00003 * (state.phase === 'tool' ? 3 : 1)
  ringPhase.D -= dt * 0.000012 * (state.phase === 'waiting_user' ? 0.1 : 1)
}
function drawDiffRings(cx, cy, g, a0, a1) {
  advanceRingPhases()
  const tickRing = (r, step, phase, len, every, alpha, lw) => {
    const k0 = Math.floor((a0 - phase) / step)
    const k1 = Math.ceil((a1 - phase) / step)
    ctx.beginPath()
    for (let k = k0; k <= k1; k += 1) {
      const a = k * step + phase
      const L = k % every === 0 ? len * 2 : len
      const [x0, y0] = polar(cx, cy, r, a)
      const [x1, y1] = polar(cx, cy, r + L, a)
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
    }
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`
    ctx.lineWidth = lw
    ctx.stroke()
  }
  // B：逆时针、密、中等亮
  tickRing(g.rOut + 44, 6 / g.rOut, ringPhase.B, 4, 8, 0.6, 1)
  ctx.beginPath(); ctx.arc(cx, cy, g.rOut + 43, a0, a1); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke()
  // C：顺时针、虚线弧段
  ctx.save()
  ctx.setLineDash([18, 10, 4, 10])
  ctx.lineDashOffset = -ringPhase.C * (g.rIn - 34)
  ctx.beginPath(); ctx.arc(cx, cy, g.rIn - 34, a0, a1)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.6; ctx.stroke()
  ctx.restore()
  // D：逆时针、点阵
  const step = 9 / g.rIn
  const k0 = Math.floor((a0 - ringPhase.D) / step)
  const k1 = Math.ceil((a1 - ringPhase.D) / step)
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  for (let k = k0; k <= k1; k += 1) {
    const [x, y] = polar(cx, cy, g.rIn - 46, k * step + ringPhase.D)
    ctx.fillRect(x - 0.9, y - 0.9, k % 4 === 0 ? 2.6 : 1.8, k % 4 === 0 ? 2.6 : 1.8)
  }
}

function drawTapeCardsBig(view, g) {
  const { cx, cy } = view
  const L = bigLayout(g)
  const lvlAt = (i) => {
    const e = state.events[i]
    if (!e) return 0
    if (e.kind === 'tool.result' || e.kind === 'model.end') return rayLevel(e)
    if (e.kind === 'tool.call') return 0.25
    if (e.kind === 'user.message') return 0.6
    return 0.1
  }
  const a0 = -g.halfVis - 0.05
  const a1 = g.halfVis + 0.05

  drawDiffRings(cx, cy, g, a0, a1)
  // ── 外圈梳齿：精细刻度，随环自转
  const step = 3.2 / g.rOut
  // 外圈刻度＝时间：只按会话时间匀速转动，不受事件冲量、不参与呼吸摆动。
  const spin = ((state.curTs || 0) * SPIN_BASE) % TAU
  const k0 = Math.floor((a0 - spin) / step)
  const k1 = Math.ceil((a1 - spin) / step)
  ctx.beginPath()
  for (let k = k0; k <= k1; k += 1) {
    const a = k * step + spin
    const len = k % 10 === 0 ? 9 : k % 5 === 0 ? 6 : 3
    const [x0, y0] = polar(cx, cy, g.rOut + 2, a)
    const [x1, y1] = polar(cx, cy, g.rOut + 2 + len, a)
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 1
  ctx.stroke()
  // 内外两道实心白轨：环带的轮廓，高对比
  for (const [r, lw] of [[g.rOut + 0.5, 2], [g.rIn - 0.5, 1.5], [g.rOut + 15, 1]]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, a0, a1)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = lw
    ctx.stroke()
  }
  // 外圈条码带：每条带外侧一排 2px 间距的径向短条，长度 = 该事件数值（参考图里环外缘的密集条码）
  ctx.beginPath()
  for (const it of L.list) {
    const lv = lvlAt(it.i)
    const n2 = Math.max(1, Math.floor(it.h / 2))
    for (let k = 0; k < n2; k += 1) {
      const a = it.a + ((k - (n2 - 1) / 2) * 2) / g.rOut
      const len = 3 + 16 * lv * (0.55 + 0.45 * Math.abs(Math.sin(k * 2.3 + it.i)))
      const [x0, y0] = polar(cx, cy, g.rOut + 17, a)
      const [x1, y1] = polar(cx, cy, g.rOut + 17 + len, a)
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.78)'
  ctx.lineWidth = 1
  ctx.stroke()

  // ── 内圈数据齿：每条带内侧一排齿，长度 = 该事件的数值
  ctx.beginPath()
  for (const it of L.list) {
    const len = 2 + 14 * lvlAt(it.i)
    const n = Math.max(1, Math.floor(it.h / 3.2))
    for (let k = 0; k < n; k += 1) {
      const a = it.a + ((k - (n - 1) / 2) * 3.2) / g.rIn
      const [x0, y0] = polar(cx, cy, g.rIn - 2, a)
      const [x1, y1] = polar(cx, cy, g.rIn - 2 - len * (k % 3 === 0 ? 1 : 0.6), a)
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.2
  ctx.stroke()

  // ── 弧内亮线束：同一工具连续调用 ≥2 次
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const it of L.list) {
    const e = state.events[it.i]
    if (e.kind !== 'tool.call') continue
    const streak = rayStreak(it.i)
    if (streak < 2) continue
    const heat = clamp(1 - it.age / Math.max(1, L.list.length), 0, 1)
    const n = streak * 2
    const tx = -Math.sin(it.a)
    const ty = Math.cos(it.a)
    const len = 26 + 10 * streak
    ctx.beginPath()
    for (let k = 0; k < n; k += 1) {
      const off = (k - (n - 1) / 2) * 3.2
      const [x0, y0] = polar(cx, cy, g.rIn - 22, it.a)
      const [x1, y1] = polar(cx, cy, g.rIn - 22 - len * (0.7 + 0.3 * Math.sin(k * 1.7 + it.i)), it.a)
      ctx.moveTo(x0 + tx * off, y0 + ty * off)
      ctx.lineTo(x1 + tx * off, y1 + ty * off)
    }
    ctx.strokeStyle = `rgba(240,243,246,${0.18 + 0.6 * heat})`
    ctx.lineWidth = 1.6
    ctx.lineCap = 'butt'
    ctx.stroke()
  }
  ctx.restore()

  // ── 径向条带：每个事件一条，长边沿半径铺满环带，按自身角度旋转 → 整体贴合弧形
  const w = g.bandW + 2
  // 条带是直矩形：裁进环带的圆环里，长条两端随内外弧切齐，任何窗口大小都贴合弧形。
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, g.rOut - 1, 0, TAU)
  ctx.arc(cx, cy, g.rIn + 1, 0, TAU, true)
  ctx.clip()
  for (const it of L.list) {
    const e = state.events[it.i]
    const cur = it.i === state.pointer
    const sel = it.i === state.selected
    const heat = clamp(1 - it.age / Math.max(1, L.list.length), 0, 1)
    const cv = stripCanvas(e, it.i, w, it.h)
    const [px, py] = polar(cx, cy, g.rIn + 1, it.a)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(it.a)
    ctx.globalAlpha = cur ? 1 : 0.6 + 0.4 * heat
    ctx.drawImage(cv, 0, -it.h / 2, w, it.h)
    ctx.globalAlpha = 1
    if (cur || sel || e.kind === 'approval.request') {
      ctx.strokeStyle = e.kind === 'approval.request' ? rgba(APPROVAL_RGB, 0.9) : 'rgba(236,240,244,0.7)'
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, -it.h / 2 + 0.5, w - 1, it.h - 1)
    }
    if (isFailureEvent(e)) {
      ctx.beginPath()
      ctx.moveTo(1.5, it.h / 2 - 1.5)
      ctx.lineTo(w - 1.5, -it.h / 2 + 1.5)
      ctx.strokeStyle = rgba(FAIL_RGB, 0.6)
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.restore()
  }
  ctx.restore()
}

function tapeHit(view, mx, my) {
  const g = tapeGeom(view)
  if (!g.on || tapePos == null || state.pointer < 0) return null
  const dx = mx - view.cx
  const dy = my - view.cy
  const r = Math.hypot(dx, dy)
  if (r < g.rIn || r > g.rOut) return null
  if (g.big) {
    const ang = Math.atan2(dy, dx)
    for (const it of bigLayout(g).list) if (Math.abs(ang - it.a) * g.rMid <= it.h / 2 + STRIP_GAP / 2) return it.i
    return null
  }
  let d = (ringAngle(0) + idleSway() - Math.atan2(dy, dx)) % TAU
  if (!g.big && d < 0) d += TAU
  const idx = Math.round(tapePos - d / g.slot)
  if (idx < 0 || idx > state.pointer || tapePos - idx > g.N - 0.6) return null
  return idx
}

function drawRing(view, now) {
  const { cx, cy, R } = view
  const notches = activeNotches(now)
  const idle = !state.phase || state.phase === 'idle'
  const b = breath(now)
  const fade = phaseFade(now)
  // 整环共用的自转角：所有环上元素都加同一个偏移，相对位置不变。
  const spin = ringSpin()

  // 内圈发丝线保留；外圈不再画完整圆，让三段弧自己断开。
  ctx.beginPath()
  ctx.arc(cx, cy, tapeGeom(view).rIn - 4, 0, TAU)
  ctx.strokeStyle = 'rgba(190,194,198,0.11)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 120 格刻度，每 10 格加长；跟着环一起转，是最好认的转动参照。
  ctx.save()
  for (let i = 0; i < 120; i += 1) {
    const a = (i / 120) * TAU + spin
    const major = i % 10 === 0
    const len = major ? 8.5 : 3.2
    const [x0, y0] = polar(cx, cy, R + 12, a)
    const [x1, y1] = polar(cx, cy, R + 12 + len, a)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.strokeStyle = major ? 'rgba(202,206,210,0.46)' : 'rgba(192,196,200,0.21)'
    ctx.lineWidth = major ? 1.15 : 0.8
    ctx.stroke()
  }
  ctx.restore()

  // 相位段本体：非活动段是 1px 细线，活动段才允许亮。
  for (const key of SEG_KEYS) {
    const seg = SEG[key]
    const span = seg.end - seg.start
    const isActive = !idle && state.phase === key
    const parts = subtractCuts(span, notchCuts(seg.start, span, notches))
    for (const part of parts) {
      const gap = 0.035
      const a0 = seg.start + part[0] + gap + spin
      const a1 = seg.start + part[1] - gap + spin
      if (a1 <= a0) continue
      ctx.beginPath()
      ctx.arc(cx, cy, R, a0, a1)
      ctx.lineCap = 'butt'
      if (isActive) {
        // 三层叠加：宽晕给出体量，中带给出重量，亮线给出边界。
        // 宽晕收窄：原来 16–25px 的灰带像一圈厚胶圈，现在只留一层薄雾。
        ctx.strokeStyle = rgba(seg.rgb, 0.035 + 0.03 * b)
        ctx.lineWidth = 9 + 4 * b
        ctx.stroke()
        ctx.strokeStyle = rgba(seg.rgb, (0.16 + 0.08 * b) * (0.55 + 0.45 * fade))
        ctx.lineWidth = 6
        ctx.stroke()
        ctx.strokeStyle = rgba(seg.rgb, (0.85 + 0.15 * b) * (0.55 + 0.45 * fade))
        ctx.lineWidth = 1.8 + 0.8 * b
        ctx.stroke()
      } else {
        ctx.strokeStyle = rgba(seg.rgb, 0.22)
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }

  // 活动段上的慢速巡游光点：连续运动会带来节拍感，但不闪。
  if (!idle && SEG[state.phase]) {
    const seg = SEG[state.phase]
    const span = seg.end - seg.start
    const head = seg.start + ((now / 7000) % 1) * span
    ctx.beginPath()
    ctx.arc(cx, cy, R, Math.max(seg.start, head - 0.20) + spin, head + spin)
    ctx.strokeStyle = 'rgba(236,240,244,0.20)'
    ctx.lineWidth = 2.2
    ctx.stroke()
    const [px, py] = polar(cx, cy, R, head + spin)
    ctx.beginPath()
    ctx.arc(px, py, 2, 0, TAU)
    ctx.fillStyle = 'rgba(246,248,250,0.86)'
    ctx.fill()
  }

  // 段边界：短径向刻度，像仪器的分区标记。
  for (const key of SEG_KEYS) {
    const seg = SEG[key]
    for (const a of [seg.start + spin, seg.end + spin]) {
      const [x0, y0] = polar(cx, cy, R - 7, a)
      const [x1, y1] = polar(cx, cy, R + 7, a)
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.strokeStyle = 'rgba(212,216,220,0.52)'
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  }

  // 段名：活动段亮，其余压到几乎不可见。
  setMonoFont(8, 500)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (view.big) {
    // 第 69 轮：相位名/停滞/告警已合并到右下角读数，环上不再写字
  } else if (false) {
    // 巨环只露出一小段弧，段名原本落在段中点（多半在画面外）。改为放在“可见部分”的中点，
    // 半径 R+58（条码带与逆转刻度环之外），中英双语，当前相位亮。
    const hv = Math.asin(clamp((view.usableH / 2) / R, 0, 1)) * 0.92
    ctx.font = `700 11px ${FONT_MONO}`
    for (const key of SEG_KEYS) {
      const seg = SEG[key]
      const active = !idle && state.phase === key
      let a0 = seg.start + spin
      let a1 = seg.end + spin
      // 把段角度平移到 −π..π 附近再与可见区间求交
      while (a0 > Math.PI) { a0 -= TAU; a1 -= TAU }
      while (a1 < -Math.PI) { a0 += TAU; a1 += TAU }
      for (const sh of [0, TAU, -TAU]) {
        const lo = Math.max(a0 + sh, -hv)
        const hi = Math.min(a1 + sh, hv)
        if (hi - lo < 0.04) continue
        const mid = (lo + hi) / 2
        const [x, y] = polar(cx, cy, R + 58, mid)
        ctx.textAlign = 'left'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 4
        ctx.strokeStyle = 'rgba(0,0,0,0.9)'
        ctx.strokeText(`${seg.en} · ${seg.name}`, x, y)
        ctx.fillStyle = rgba(seg.rgb, active ? 1 : 0.55)
        ctx.fillText(`${seg.en} · ${seg.name}`, x, y)
      }
    }
    setMonoFont(8, 500)
  } else for (const key of SEG_KEYS) {
    const seg = SEG[key]
    const active = !idle && state.phase === key
    const mid = (seg.start + seg.end) / 2
    const [x, y] = polar(cx, cy, R + 24, mid + spin)
    ctx.fillStyle = rgba(seg.rgb, active ? 0.82 : 0.30)
    ctx.fillText(seg.en, x, y)
  }

  // 淡色疤痕：留在缺口上，不用红色，随时间在 5 分钟内淡出。
  const scars = activeScars(now)
  for (const s of scars) {
    const a0 = s.angle - 0.055 + spin
    const a1 = s.angle + 0.055 + spin
    ctx.beginPath()
    ctx.arc(cx, cy, R, a0, a1)
    ctx.strokeStyle = `rgba(196,200,204,${s.alpha * 1.4})`
    ctx.lineWidth = 2
    ctx.lineCap = 'butt'
    ctx.stroke()
  }

  // 索引刻痕：环上唯一的高亮标记，随环转动，一眼能看出在转。
  // 细线 + 外点，保持银灰，不闪。
  {
    const [x0, y0] = polar(cx, cy, R - 10, spin)
    const [x1, y1] = polar(cx, cy, R + 21, spin)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.strokeStyle = 'rgba(232,236,240,0.55)'
    ctx.lineWidth = 1.6
    ctx.stroke()
    const [dx, dy] = polar(cx, cy, R + 27, spin)
    ctx.beginPath()
    ctx.arc(dx, dy, 1.6, 0, TAU)
    ctx.fillStyle = 'rgba(238,242,246,0.75)'
    ctx.fill()
  }

  const tg = tapeGeom(view)
  // 非最大化（居中小环）同样画差速环：整圈 0→2π，半径按小环卡带取。
  if (!view.big && tg.on) drawDiffRings(cx, cy, { rIn: tg.rIn + 12, rOut: tg.rOut + 40 }, 0, TAU)
  drawContextGauge(cx, cy, tg.rIn - 4)
  drawToolDwell(cx, cy, tg.rIn - 10)

  // 相位切换不再做亮光扫过；只靠段颜色变化表达状态。
}

// 上下文水位：内圈发丝线上，从索引刻痕起顺时针走 contextRatio 一圈。
// 对应真实的 context.update；超过 80% 转琥珀（与侧栏上下文条同一阈值），不闪。
function drawContextGauge(cx, cy, r) {
  const ratio = clamp(Number(state.contextRatio) || 0, 0, 1)
  if (ratio <= 0.002) return
  const a0 = ringAngle(0)
  const a1 = a0 + ratio * TAU
  const warn = ratio > 0.8
  ctx.beginPath()
  ctx.arc(cx, cy, r, a0, a1)
  ctx.strokeStyle = warn ? 'rgba(196,164,112,0.55)' : 'rgba(214,218,222,0.34)'
  ctx.lineWidth = 1.4
  ctx.lineCap = 'butt'
  ctx.stroke()
  const [x, y] = polar(cx, cy, r, a1)
  ctx.beginPath()
  ctx.arc(x, y, 1.5, 0, TAU)
  ctx.fillStyle = warn ? 'rgba(214,188,138,0.8)' : 'rgba(232,236,240,0.62)'
  ctx.fill()
}

// 工具耗时弧：只在工具相位、且有真实 tool.call 起点时出现。
// 半径 = 卡带内缘 rIn-10（上下文水位在 rIn-4，工具图标在 rIn-24），沿工具段按对数刻度生长：1s / 10s / 60s 三道细刻度，满段 = 60s。
// 用会话时间 curTs 计算，暂停即停、拖时间轴即对齐。
const DWELL_FULL_S = 60
function dwellFrac(sec) { return clamp(Math.log10(1 + sec) / Math.log10(1 + DWELL_FULL_S), 0, 1) }
function drawToolDwell(cx, cy, r) {
  if (state.phase !== 'tool' || state.toolStartedAt == null) return
  const sec = Math.max(0, (state.curTs - state.toolStartedAt) / 1000)
  const seg = SEG.tool
  const span = seg.end - seg.start - 0.14
  const base = seg.start + 0.07
  for (const t of [1, 10, DWELL_FULL_S]) {
    const a = ringAngle(base + dwellFrac(t) * span)
    const [x0, y0] = polar(cx, cy, r - 2.5, a)
    const [x1, y1] = polar(cx, cy, r + 2.5, a)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.strokeStyle = 'rgba(200,204,208,0.34)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  const f = dwellFrac(sec)
  if (f <= 0) return
  ctx.beginPath()
  ctx.arc(cx, cy, r, ringAngle(base), ringAngle(base + f * span))
  ctx.strokeStyle = rgba(seg.rgb, sec > DWELL_FULL_S ? 0.78 : 0.6)
  ctx.lineWidth = 1.6
  ctx.lineCap = 'butt'
  ctx.stroke()
}

/* ── 停滞：等待弧 + 秒数，抖动只出现在这里 ─────────────────── */
function drawStall(view, now) {
  const live = stallSeconds()
  const flash = now < state.stallFlashUntil ? state.stallFlashSeconds : 0
  const secs = Math.max(live, flash)
  if (secs <= 8) return
  const { cx, cy, R } = view
  const seg = SEG.waiting_user
  const spin = ringSpin()
  const a0 = seg.start + 0.07 + spin
  const a1 = seg.end - 0.07 + spin
  ctx.beginPath()
  ctx.arc(cx, cy, R + 6, a0, a1)
  ctx.strokeStyle = rgba(seg.rgb, 0.32)
  ctx.lineWidth = 2.5
  ctx.stroke()

  const mid = (a0 + a1) / 2
  // 巨环模式：等人段多半在画面外，停滞提示改放在环外可见处（水平中线下方）
  if (view.big) return // 停滞文字已合并到右下角读数
  const [tx, ty] = polar(cx, cy, R + 20, mid)
  setMonoFont(11, 500)
  ctx.fillStyle = rgba(seg.rgb, 0.9)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`停滞 ${Math.floor(secs)}s`, tx, ty)
}

/* ── 环外 60 秒刻度带 + 空白压缩快进带 ─────────────────────── */
function drawScaleBand(view, now) {
  const { cx, cy, R } = view
  const bandR = R + 44
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, bandR, 0, TAU)
  ctx.strokeStyle = 'rgba(180,184,188,0.10)'
  ctx.lineWidth = 1
  ctx.stroke()

  for (let i = 0; i < 60; i += 1) {
    const a = -Math.PI / 2 - i * (TAU / 60) // 0 秒在正上方，越久越逆时针
    const major = i % 5 === 0
    const len = major ? 7 : 3
    const [x0, y0] = polar(cx, cy, bandR - len / 2, a)
    const [x1, y1] = polar(cx, cy, bandR + len / 2, a)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.strokeStyle = major ? 'rgba(190,194,198,0.26)' : 'rgba(180,184,188,0.12)'
    ctx.lineWidth = major ? 1 : 0.7
    ctx.stroke()
  }

  // 空白压缩：把真实时间里的长空白画成带 » 的快进带。
  if (state.compress && state.curTs && state.gaps.length) {
    const win = 60000
    const z0 = state.curTs - win
    for (const gap of state.gaps) {
      if (gap.b <= z0 || gap.a >= state.curTs) continue
      const a = Math.max(gap.a, z0)
      const b = Math.min(gap.b, state.curTs)
      const angA = -Math.PI / 2 - ((state.curTs - a) / win) * TAU
      const angB = -Math.PI / 2 - ((state.curTs - b) / win) * TAU
      ctx.beginPath()
      ctx.arc(cx, cy, bandR, angB, angA, true)
      ctx.strokeStyle = 'rgba(196,164,112,0.28)'
      ctx.lineWidth = 4
      ctx.stroke()

      const mid = (angA + angB) / 2
      const [mx, my] = polar(cx, cy, bandR, mid)
      ctx.fillStyle = 'rgba(196,164,112,0.76)'
      setMonoFont(9, 600)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('»', mx, my)
    }
  }
  ctx.restore()
}

/* ── 光尘（token 流速只改密度，不改转速） ──────────────────── */
function drawDust(view, now) {
  const { cx, cy, R } = view
  const rate = state.tokenRate || 0
  if (rate > 0 && now - state.lastDust > 90 && fx.dust.length < 80) {
    state.lastDust = now
    const need = clamp(Math.ceil(rate / 60), 1, 3)
    for (let k = 0; k < need; k += 1) {
      fx.dust.push({
        start: now,
        life: 1800 + Math.random() * 1800,
        angle: Math.random() * TAU,
        r: R * 0.45 + Math.random() * R * 0.55,
        spin: (Math.random() - 0.5) * 0.9,
        size: 0.8 + Math.random() * 1.2,
      })
    }
  }
  for (const d of fx.dust) {
    const age = (now - d.start) / d.life
    if (age < 0 || age > 1) continue
    const a = Math.sin(Math.PI * age) * 0.22
    const [x, y] = polar(cx, cy, d.r + age * 10, d.angle + age * d.spin)
    ctx.beginPath()
    ctx.arc(x, y, d.size * 0.8, 0, TAU)
    ctx.fillStyle = `rgba(206,210,214,${a})`
    ctx.fill()
  }
}

/* ── 核心 ───────────────────────────────────────────────────── */
function drawWebCore(view, now) {
  // 巨环模式的织网中心也要有一个真实的“交会点”，所有网络流线都指向这里。
  const { R } = view
  const [cx, cy] = view.core || [view.cx, view.cy]
  const rgb = phaseRgb(state.phase)
  const b = breath(now)
  const r = clamp(R * 0.014, 2.5, 6)
  const glowR = clamp(R * 0.09, 14, 34)
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
  glow.addColorStop(0, rgba('240,244,248', 0.32 + 0.18 * b))
  glow.addColorStop(0.35, rgba(rgb, 0.12))
  glow.addColorStop(1, rgba(rgb, 0))
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, glowR, 0, TAU)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(232,238,242,0.78)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - r * 2.4, cy)
  ctx.lineTo(cx + r * 2.4, cy)
  ctx.moveTo(cx, cy - r * 2.4)
  ctx.lineTo(cx, cy + r * 2.4)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.fill()
}

function drawCore(view, now) {
  const { cx, cy, R } = view
  const rgb = phaseRgb(state.phase)
  const b = breath(now)
  const r = Math.max(4, R * 0.026)

  // 核心光晕压得很低，避免“霓虹球”；但用叠加混合保留光源感。
  const glowR = R * (0.16 + 0.035 * b)
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
  glow.addColorStop(0, rgba('236,240,244', 0.26 + 0.18 * b))
  glow.addColorStop(0.30, rgba(rgb, 0.10))
  glow.addColorStop(1, rgba(rgb, 0))
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, glowR, 0, TAU)
  ctx.fill()
  ctx.restore()

  // 细十字准星。
  ctx.strokeStyle = 'rgba(206,210,214,0.30)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - R * 0.07, cy)
  ctx.lineTo(cx + R * 0.07, cy)
  ctx.moveTo(cx, cy - R * 0.07)
  ctx.lineTo(cx, cy + R * 0.07)
  ctx.stroke()

  // 内圈 + 实心点。
  ctx.beginPath()
  ctx.arc(cx, cy, r * 2.4, 0, TAU)
  ctx.strokeStyle = 'rgba(216,220,224,0.36)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.fillStyle = 'rgba(250,252,254,0.96)'
  ctx.fill()

  // 四向星芒：很轻，但能把核心从“白点”变成光源。
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const [ang, len, alpha] of [
    [0, R * 0.30, 0.14],
    [Math.PI, R * 0.30, 0.14],
    [-Math.PI / 2, R * 0.20, 0.11],
    [Math.PI / 2, R * 0.20, 0.11],
    [-Math.PI / 4, R * 0.12, 0.07],
    [Math.PI / 4, R * 0.12, 0.07],
  ]) {
    const [x1, y1] = polar(cx, cy, len, ang)
    const grad = ctx.createLinearGradient(cx, cy, x1, y1)
    grad.addColorStop(0, `rgba(226,230,234,${alpha * 2.2})`)
    grad.addColorStop(0.35, `rgba(226,230,234,${alpha * 1.2})`)
    grad.addColorStop(1, 'rgba(226,230,234,0)')
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(x1, y1)
    ctx.strokeStyle = grad
    ctx.lineWidth = 0.7
    ctx.stroke()
  }
  ctx.restore()
}

