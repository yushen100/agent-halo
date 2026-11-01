'use strict'
// agent-halo · deck.js — 底部八格遥测台、总绘制
// 由原 halo.js 第 5202–5867 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

/* ── 底部遥测台 ─────────────────────────────────────────────── */
function prepDeck(d) {
  if (!d || !d.ctx || !d.canvas) return null
  if (!d.cw) measureDeck(d)
  const w = d.cw
  const h = d.chh
  if (w !== d.w || h !== d.h) {
    d.w = w
    d.h = h
    d.canvas.width = Math.round(w * DPR)
    d.canvas.height = Math.round(h * DPR)
    d.ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
  }
  d.ctx.clearRect(0, 0, w, h)
  return { c: d.ctx, w, h }
}

function deckWindow(maxEvents) {
  const end = clamp(state.pointer, -1, state.events.length - 1)
  const start = Math.max(0, end - maxEvents + 1)
  return { start, end, list: end >= start ? state.events.slice(start, end + 1) : [] }
}

// 遥测台动效的统一时钟：某个事件到达后 1.6 秒会话时间内从 0→1（ease-out）。
// 全部由事件时间戳与 curTs 决定，没有事件就没有动效，暂停即冻结。
const DECK_ARRIVE = 1600
// 过渡时长按真实时间约 1.6 秒：会话时间窗口随播放倍速放大（原来 4× 下只有 0.4 秒，像闪一下）。
function arrive(ts) { return clamp((state.curTs - ts) / (DECK_ARRIVE * Math.max(1, state.speed || 1)), 0, 1) }
function easeOut(t) { return 1 - Math.pow(1 - t, 3) }

function drawDeckTools() {
  const box = prepDeck(deck.tools)
  if (!box) return
  const { c, w, h } = box
  const { list } = deckWindow(240)
  const counts = new Map()
  const lastTs = new Map()
  let total = 0
  for (const e of list) {
    if (e.kind !== 'tool.call') continue
    const name = e.tool || 'unknown'
    counts.set(name, (counts.get(name) || 0) + 1)
    lastTs.set(name, e.ts)
    total += 1
  }
  if (dom.deckToolsMeta) dom.deckToolsMeta.textContent = `${total} CALLS`
  c.font = `500 7px ${FONT_MONO}`
  c.textBaseline = 'middle'

  if (!counts.size) {
    c.fillStyle = 'rgba(172,176,180,0.34)'
    c.textAlign = 'left'
    c.fillText('NO TOOL CALLS', 2, h / 2)
    return
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const max = rows[0][1] || 1
  const rowH = Math.min(15, h / 5)
  const barX = Math.min(64, w * 0.36)
  const barW = Math.max(12, w - barX - 26)
  rows.forEach(([name, n], i) => {
    const y = 6 + i * rowH
    const alpha = i === 0 ? 0.78 : 0.38 - i * 0.04
    // 这个工具刚被调用：条从上一个计数长到新计数，名字和数字亮一下，一颗光点沿条跑到末端。
    const ar = arrive(lastTs.get(name) || 0)
    const g = easeOut(ar)
    const flash = 1 - ar
    const nEff = n - 1 + g
    const running = state.phase === 'tool' && state.tool === name
    c.fillStyle = `rgba(190,198,204,${0.52 + 0.45 * flash})`
    c.textAlign = 'left'
    c.fillText(truncate(name.replace(/^mcp__[^_]+__/, ''), 13), 0, y)
    c.fillStyle = `rgba(214,218,222,${Math.max(0.12, alpha * 0.28)})`
    c.fillRect(barX, y - 0.5, barW, 1)
    const len = Math.max(1, barW * (nEff / max))
    c.fillStyle = `rgba(235,240,243,${Math.min(1, alpha + 0.3 * flash)})`
    c.fillRect(barX, y - 1, len, 2)
    if (flash > 0.01) {
      c.fillStyle = `rgba(250,252,254,${0.9 * flash})`
      c.fillRect(barX + len - 3, y - 2, 3, 4)
    }
    // 工具正在跑：条尾有一个慢速来回的游标（真实状态：该工具尚未返回）。
    if (running) {
      const ph = (state.animNow / 900) % 2
      const px = barX + len + 2 + (ph < 1 ? ph : 2 - ph) * 10
      c.fillStyle = 'rgba(236,240,244,0.7)'
      c.fillRect(px, y - 1.5, 1.5, 3)
    }
    c.fillStyle = `rgba(190,198,204,${0.62 + 0.38 * flash})`
    c.textAlign = 'right'
    c.fillText(String(n), w, y)
  })
}

function drawDeckTokens() {
  const box = prepDeck(deck.tokens)
  if (!box) return
  const { c, w, h } = box
  const { list } = deckWindow(90)
  const bars = []
  let sum = 0
  for (const e of list) {
    const tok = e.tokens || {}
    const n = Number(tok.total) || 0
    if (e.kind !== 'model.end' || n <= 0) continue
    bars.push({ in: Number(tok.in) || 0, out: Number(tok.out) || 0, total: n, ts: e.ts })
    sum += n
  }
  if (dom.deckTokensMeta) dom.deckTokensMeta.textContent = `${sum} TOK`
  c.font = `500 7px ${FONT_MONO}`
  c.textBaseline = 'middle'
  if (bars.length < 2) {
    c.fillStyle = 'rgba(172,176,180,0.34)'
    c.textAlign = 'left'
    c.fillText('NO TOKEN DATA', 2, h / 2)
    return
  }

  const shown = bars.slice(-40)
  const max = Math.max(...shown.map((b) => b.total))
  const x0 = 2
  const x1 = w - 2
  const y0 = 4
  const y1 = h - 4

  // 网格线。
  for (let i = 1; i <= 3; i += 1) {
    const y = y0 + (i / 4) * (y1 - y0)
    c.beginPath()
    c.moveTo(x0, y + 0.5)
    c.lineTo(x1, y + 0.5)
    c.strokeStyle = 'rgba(190,198,204,0.06)'
    c.lineWidth = 1
    c.stroke()
  }

  // 堆叠柱：输入（暗）+ 输出（亮），能看出每次步进的体量差。
  // 柱宽封顶，事件少时靠右对齐，避免几根柱子撑满整条变成灰块。
  const slot = Math.min(9, (x1 - x0) / shown.length)
  const barW = Math.max(1, slot - 1.4)
  // 新的一次模型输出到达：旧柱整体左移一格（滑动），新柱从基线升起、顶帽闪一下。
  const newest = shown[shown.length - 1]
  const gNew = easeOut(arrive(newest.ts))
  const slide = slot * (1 - gNew)
  shown.forEach((b, i) => {
    const isNew = i === shown.length - 1
    const bh = (2 + (b.total / max) * (y1 - y0 - 3)) * (isNew ? gNew : 1)
    const outH = Math.max(0.6, bh * (b.out / Math.max(1, b.total)))
    const x = x1 - (shown.length - i) * slot + slide
    // 细柱语言：槽位不变，实际宽度 ≤3px。
    const sw = Math.min(barW, 3)
    const sx = x + (barW - sw) / 2
    c.fillStyle = 'rgba(210,214,218,0.10)'
    c.fillRect(sx, y1 - bh, sw, bh - outH)
    c.fillStyle = 'rgba(228,232,236,0.42)'
    c.fillRect(sx, y1 - outH, sw, outH)
    c.fillStyle = `rgba(248,251,252,${isNew ? 0.65 + 0.35 * (1 - gNew) : 0.65})`
    c.fillRect(sx - 0.5, y1 - bh, sw + 1, isNew ? 1.2 + 1.5 * (1 - gNew) : 1.2)
  })

  c.beginPath()
  c.moveTo(x0, y1 + 0.5)
  c.lineTo(x1, y1 + 0.5)
  c.strokeStyle = 'rgba(190,198,204,0.16)'
  c.lineWidth = 1
  c.stroke()
}

function drawDeckRoutes() {
  const box = prepDeck(deck.routes)
  if (!box) return
  const { c, w, h } = box
  const { list } = deckWindow(360)
  const grid = {}
  const routeLast = {}
  let total = 0
  for (const e of list) {
    if (!e.net || typeof e.net !== 'object') continue
    const kind = netKind(e.net.kind)
    const route = netRoute(e.net.route)
    if (!grid[kind]) grid[kind] = { direct: 0, proxy: 0, gateway: 0, unknown: 0 }
    grid[kind][route] += 1
    routeLast[kind + '|' + route] = e.ts
    total += 1
  }
  if (dom.deckRoutesMeta) dom.deckRoutesMeta.textContent = `${total} NET`
  c.font = `500 6.5px ${FONT_MONO}`
  c.textBaseline = 'middle'

  const left = 9
  const top = 11
  const cw = Math.max(6, (w - left - 2) / 4)
  const ch = Math.max(5, (h - top - 2) / 6)
  const rowKeys = ['search', 'fetch', 'download', 'upload', 'transfer', 'api']
  const rowMark = ['SR', 'FE', 'DL', 'UP', 'TR', 'API']
  const colMark = ['D', 'P', 'G', '?']

  // 列标题。
  c.textAlign = 'center'
  c.fillStyle = 'rgba(172,176,180,0.44)'
  colMark.forEach((m, j) => c.fillText(m, left + cw * (j + 0.5), 6))

  let max = 1
  for (const k of rowKeys) if (grid[k]) for (const r of ROUTES) max = Math.max(max, grid[k][r])

  rowKeys.forEach((k, i) => {
    const y = top + i * ch
    c.fillStyle = 'rgba(172,176,180,0.38)'
    c.textAlign = 'left'
    c.fillText(rowMark[i], 0, y + ch / 2)
    ROUTES.forEach((r, j) => {
      const n = grid[k] ? grid[k][r] : 0
      const x = left + j * cw
      if (!n) {
        // 空格只留一个小点，避免没有网络行为时整块面板像一堵灰墙。
        c.fillStyle = 'rgba(190,194,198,0.18)'
        c.fillRect(x + cw / 2 - 0.75, y + ch / 2 - 0.75, 1.5, 1.5)
        return
      }
      // 刚发生一次这种网络行为：格子亮起并向外扩一圈细框。
      const fl = 1 - arrive(routeLast[k + '|' + r] || 0)
      // 有次数的格子：淡底 + 细框 + 亮数字，不再是一整块亮灰砖。
      const alpha = Math.min(1, 0.06 + 0.16 * (n / max) + 0.3 * fl)
      c.fillStyle = `rgba(210,214,218,${alpha})`
      c.fillRect(x + 1, y + 1, Math.max(2, cw - 3), Math.max(2, ch - 3))
      c.strokeStyle = `rgba(214,218,222,${0.35 + 0.4 * (n / max)})`
      c.lineWidth = 1
      c.strokeRect(x + 1.5, y + 1.5, Math.max(2, cw - 3) - 1, Math.max(2, ch - 3) - 1)
      if (fl > 0.01) {
        const grow = (1 - fl) * 3
        c.strokeStyle = `rgba(236,240,244,${0.8 * fl})`
        c.lineWidth = 1
        c.strokeRect(x + 1 - grow + 0.5, y + 1 - grow + 0.5, Math.max(2, cw - 3) + grow * 2 - 1, Math.max(2, ch - 3) + grow * 2 - 1)
      }
      if (n) {
        c.fillStyle = 'rgba(236,240,244,0.92)'
        c.textAlign = 'center'
        c.font = `500 ${Math.min(9, Math.max(6, ch * 0.5))}px ${FONT_MONO}`
        c.fillText(String(n), x + cw / 2, y + ch / 2 + 0.5)
      }
    })
  })
}

const DECK_ROWS = [
  { mark: '!', color: FAIL_RGB },
  { mark: 'T', color: '195,200,204' },
  { mark: 'M', color: '214,220,226' },
  { mark: 'U', color: '190,168,124' },
  { mark: 'S', color: '168,174,180' },
  { mark: '·', color: '150,158,166' },
]

function deckRowOf(e) {
  if (!e) return 5
  if (e.kind === 'approval.request') return 0
  if (isFailureEvent(e)) return 0
  if (e.kind === 'tool.call' || e.kind === 'tool.result') return 1
  if (e.kind === 'model.end') return 2
  if (e.kind === 'user.message') return 3
  if (e.kind === 'subagent.start') return 4
  return 5
}

// 事件矩阵（热力格风格，参考 haloflux 底部 DIFFERENCE FIELD）：
//   每行一类事件、每列一个事件位置；整张网格都画暗格作底，有事件的格子按类型着色，
//   亮度 = 该事件的数值（耗时 / 输出 token）；最新一列有亮框，列随新事件左滑。
const MATRIX_ROWS = [
  { mark: 'FAIL', rgb: FAIL_RGB },
  { mark: 'TOOL', rgb: '96,226,176' },
  { mark: 'MODEL', rgb: '242,198,110' },
  { mark: 'USER', rgb: '214,190,140' },
  { mark: 'SUB', rgb: '255,255,255' },
  { mark: 'OTHER', rgb: '150,150,150' },
]
function drawDeckMatrix() {
  const box = prepDeck(deck.matrix)
  if (!box) return
  const { c, w, h } = box
  const left = 34
  const top = 2
  const rows = MATRIX_ROWS.length
  const ch = (h - top - 4) / rows
  const cell = Math.max(4, Math.min(ch - 2, 11))
  const pitch = cell + 2
  const cols = Math.max(8, Math.floor((w - left - 4) / pitch))
  const { end, list } = deckWindow(cols)
  if (dom.deckMatrixMeta) dom.deckMatrixMeta.textContent = `${Math.max(0, end + 1)}/${state.events.length}`
  c.font = `700 6.5px ${FONT_MONO}`
  c.textBaseline = 'middle'
  c.textAlign = 'left'
  MATRIX_ROWS.forEach((r, i) => {
    c.fillStyle = rgba(r.rgb, 0.9)
    c.fillText(r.mark, 0, top + i * ch + ch / 2)
  })
  const last = list[list.length - 1]
  const gm = last ? easeOut(arrive(last.ts)) : 1
  const slide = list.length >= cols ? pitch * (1 - gm) : 0
  const x0 = w - 4 - cols * pitch
  c.save()
  c.beginPath()
  c.rect(left, 0, w - left, h)
  c.clip()
  // 底格：整张暗网格（经 boostCtx 后约 16% 白）
  c.fillStyle = 'rgba(255,255,255,0.02)'
  for (let k = -1; k < cols; k += 1) {
    for (let r = 0; r < rows; r += 1) c.fillRect(x0 + k * pitch + slide, top + r * ch + (ch - cell) / 2, cell, cell)
  }
  const off = cols - list.length
  list.forEach((e, i) => {
    let row = deckRowOf(e)
    if (row === 0 && e.kind === 'approval.request') row = 0
    const isApproval = e.kind === 'approval.request'
    const lv = e.kind === 'tool.result' || e.kind === 'model.end' ? rayLevel(e) : 0.45
    const rgb = isApproval ? APPROVAL_RGB : MATRIX_ROWS[row].rgb
    const x = x0 + (off + i) * pitch + slide
    const y = top + row * ch + (ch - cell) / 2
    const fresh = i === list.length - 1 ? 1 - gm : 0
    c.fillStyle = fresh > 0.01 ? `rgba(255,255,255,${0.6 + 0.4 * fresh})` : rgba(rgb, 0.35 + 0.65 * lv)
    c.fillRect(x, y, cell, cell)
  })
  c.restore()
  // 最新一列亮框
  if (list.length) {
    const xl = x0 + (cols - 1) * pitch
    c.strokeStyle = 'rgba(255,255,255,0.9)'
    c.lineWidth = 1
    c.strokeRect(xl - 1.5, top + 0.5, cell + 3, h - top - 5)
  }
}

/* ── 底部第二排：文字为主的信息面板（全部读真实事件） ─────────── */
function deckText(c, size, weight) {
  c.font = `${weight || 500} ${size}px ${FONT_MONO}`
  c.textBaseline = 'middle'
}

// 事件流水：最近的事件逐行滚动；新行从下方滑入并亮一下。
function drawDeckFeed() {
  const box = prepDeck(deck.feed)
  if (!box) return
  const { c, w, h } = box
  const lineH = 11
  const rows = Math.max(3, Math.floor((h - 2) / lineH))
  const { end, list } = deckWindow(rows + 1)
  if (dom.deckFeedMeta) dom.deckFeedMeta.textContent = `${Math.max(0, end + 1)} EV`
  deckText(c, 7)
  if (!list.length) {
    c.fillStyle = 'rgba(172,176,180,0.34)'
    c.fillText('NO EVENTS', 2, h / 2)
    return
  }
  const last = list[list.length - 1]
  const g = easeOut(arrive(last.ts))
  const slideY = lineH * (1 - g)
  c.save()
  c.beginPath()
  c.rect(0, 0, w, h)
  c.clip()
  const shown = list.slice(-rows - 1)
  shown.forEach((e, k) => {
    const fromBottom = shown.length - 1 - k
    const y = h - 6 - fromBottom * lineH + slideY
    if (y < -lineH) return
    const isNew = k === shown.length - 1
    const failed = isFailureEvent(e)
    const tagRgb = e.kind === 'approval.request' ? APPROVAL_RGB : failed ? FAIL_RGB
      : e.kind === 'user.message' ? SEG.waiting_user.rgb
        : e.kind === 'model.end' ? WAVE_RGB.model : e.kind === 'tool.call' ? WAVE_RGB.tool : e.kind === 'tool.result' ? WAVE_RGB.result : '214,218,222'
    const fade = 0.35 + 0.65 * (1 - fromBottom / (rows + 1))
    c.textAlign = 'left'
    c.fillStyle = `rgba(150,156,162,${0.6 * fade})`
    c.fillText(fmtClock(e.ts).slice(3), 0, y)
    c.fillStyle = rgba(tagRgb, (isNew ? 0.6 + 0.4 * (1 - g) : 0.75) * fade)
    // 类型词（彩色粗体，参考 haloflux 的 read/check/build）+ 工具名
    const VERB = { 'model.end': 'think', 'tool.call': 'call', 'tool.result': failed ? 'fail' : 'done', 'user.message': 'user', 'approval.request': 'ask', 'subagent.start': 'spawn' }
    c.font = `700 8px ${FONT_MONO}`
    c.fillText(VERB[e.kind] || 'evt', 36, y)
    c.font = `500 7.5px ${FONT_MONO}`
    c.fillStyle = `rgba(230,232,234,${0.85 * fade})`
    c.fillText(truncate(e.tool || (e.kind === 'model.end' ? 'model' : kindLabel(e.kind)), 11), 70, y)
    c.fillStyle = `rgba(170,176,182,${0.6 * fade})`
    const room = Math.max(4, Math.floor((w - 128) / 4.3))
    c.fillText(truncate(e.label || '', room), 126, y)
    if (isNew && g < 1) {
      c.fillStyle = `rgba(236,240,244,${0.10 * (1 - g)})`
      c.fillRect(0, y - lineH / 2, w, lineH)
    }
  })
  c.restore()
}

// 上下文：context.ratio 的历史折线 + 当前输入/输出/缓存读数。
function drawDeckCtx() {
  const box = prepDeck(deck.ctxp)
  if (!box) return
  const { c, w, h } = box
  const pts = lastEvents(80, (e) => e.context && Number(e.context.ratio) > 0)
  const lastM = lastEvents(1, (e) => e.kind === 'model.end' && e.tokens)[0]
  const ratio = clamp(Number(state.contextRatio) || 0, 0, 1)
  if (dom.deckCtxMeta) dom.deckCtxMeta.textContent = `${Math.round(ratio * 100)}%`
  deckText(c, 7)
  const top = 4
  const chartH = Math.max(20, h - 34)
  const x0 = 2
  const x1 = w - 2
  for (const g of [0.5, 0.8]) {
    const y = top + chartH * (1 - g)
    c.fillStyle = g === 0.8 ? 'rgba(196,164,112,0.22)' : 'rgba(190,198,204,0.08)'
    c.fillRect(x0, y, x1 - x0, 1)
  }
  if (pts.length >= 2) {
    const ev = pts
    const g = easeOut(arrive(ev[ev.length - 1].ts))
    c.beginPath()
    ev.forEach((e, i) => {
      const x = x0 + (i / (ev.length - 1)) * (x1 - x0) * (i === ev.length - 1 ? 1 : 1)
      const r = clamp(Number(e.context.ratio), 0, 1)
      const prev = i ? clamp(Number(ev[i - 1].context.ratio), 0, 1) : r
      const rr = i === ev.length - 1 ? prev + (r - prev) * g : r
      const y = top + chartH * (1 - rr)
      if (i) c.lineTo(x, y); else c.moveTo(x, y)
    })
    c.strokeStyle = 'rgba(226,230,234,0.75)'
    c.lineWidth = 1.2
    c.stroke()
    const yEnd = top + chartH * (1 - ratio)
    c.fillStyle = ratio > 0.8 ? 'rgba(214,188,138,0.95)' : 'rgba(244,247,250,0.95)'
    c.fillRect(x1 - 2, yEnd - 2, 4, 4)
  } else {
    c.fillStyle = 'rgba(172,176,180,0.34)'
    c.fillText('NO CONTEXT DATA', 2, top + chartH / 2)
  }
  const ty = h - 18
  const t = lastM && lastM.tokens ? lastM.tokens : {}
  const cells = [['IN', t.in], ['OUT', t.out], ['CACHE', t.cache_read], ['CTX', `${Math.round(ratio * 100)}%`]]
  const cw = (w - 4) / cells.length
  cells.forEach(([k, v], i) => {
    c.textAlign = 'left'
    c.fillStyle = 'rgba(150,156,162,0.6)'
    c.fillText(k, 2 + i * cw, ty)
    c.fillStyle = 'rgba(226,230,234,0.9)'
    deckText(c, 9, 400)
    c.fillText(v == null ? '—' : String(v), 2 + i * cw, ty + 11)
    deckText(c, 7)
  })
}

// 耗时轨迹：最近工具返回的耗时（对数纵轴）连成折线，失败点画成空心灰圈；新点从上一点滑出。
function drawDeckTrace() {
  const box = prepDeck(deck.trace)
  if (!box) return
  const { c, w, h } = box
  const ev = lastEvents(60, (e) => e.kind === 'tool.result' && Number(e.duration_ms) >= 0)
  if (dom.deckTraceMeta) dom.deckTraceMeta.textContent = ev.length ? `${fmtDuration(ev[ev.length - 1].duration_ms)}` : '—'
  deckText(c, 6.5)
  const x0 = 26
  const x1 = w - 4
  const y0 = 6
  const y1 = h - 12
  const yOf = (ms) => y1 - (Math.log10(1 + ms) / Math.log10(1 + 60000)) * (y1 - y0)
  for (const [ms, lab] of [[100, '100ms'], [1000, '1s'], [10000, '10s'], [60000, '60s']]) {
    const y = yOf(ms)
    c.fillStyle = 'rgba(190,198,204,0.07)'
    c.fillRect(x0, y, x1 - x0, 1)
    c.fillStyle = 'rgba(150,156,162,0.55)'
    c.textAlign = 'right'
    c.fillText(lab, x0 - 3, y)
  }
  if (ev.length < 2) {
    c.textAlign = 'left'
    c.fillStyle = 'rgba(172,176,180,0.34)'
    c.fillText('NO TOOL RESULTS', x0, (y0 + y1) / 2)
    return
  }
  const g = easeOut(arrive(ev[ev.length - 1].ts))
  const step = (x1 - x0) / (ev.length - 1)
  const pts = ev.map((e, i) => [x0 + i * step, yOf(Number(e.duration_ms) || 0)])
  const n = pts.length
  pts[n - 1] = [pts[n - 2][0] + (pts[n - 1][0] - pts[n - 2][0]) * g, pts[n - 2][1] + (pts[n - 1][1] - pts[n - 2][1]) * g]
  // 面积填充 + 1.5px 线：比单线更有质感
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.lineTo(pts[n - 1][0], y1)
  c.lineTo(pts[0][0], y1)
  c.closePath()
  const ag = c.createLinearGradient(0, y0, 0, y1)
  ag.addColorStop(0, `rgba(${WAVE_RGB.tool},0.28)`)
  ag.addColorStop(1, `rgba(${WAVE_RGB.tool},0)`)
  c.fillStyle = ag
  c.fill()
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.strokeStyle = 'rgba(220,224,228,0.7)'
  c.lineWidth = 1.5
  c.stroke()
  ev.forEach((e, i) => {
    const [x, y] = pts[i]
    if (isFailureEvent(e)) {
      c.beginPath()
      c.arc(x, y, 2.4, 0, TAU)
      c.strokeStyle = rgba(FAIL_RGB, 0.9)
      c.lineWidth = 1
      c.stroke()
    } else {
      c.fillStyle = i === n - 1 ? 'rgba(248,250,252,0.95)' : 'rgba(214,218,222,0.6)'
      c.fillRect(x - 1, y - 1, 2, 2)
    }
  })
}

// 工具状态表：每个工具一行：名称 / 调用次数 / 失败数 / 平均耗时 / 当前状态（运行中/OK/FAIL）。
function drawDeckStatus() {
  const box = prepDeck(deck.status)
  if (!box) return
  const { c, w, h } = box
  const { list } = deckWindow(400)
  const m = new Map()
  for (const e of list) {
    if (e.kind !== 'tool.call' && e.kind !== 'tool.result') continue
    const k = e.tool || 'unknown'
    if (!m.has(k)) m.set(k, { calls: 0, fails: 0, dur: 0, nres: 0, last: null, lastTs: 0 })
    const r = m.get(k)
    if (e.kind === 'tool.call') { r.calls += 1; r.last = 'run' } else {
      r.nres += 1
      r.dur += Number(e.duration_ms) || 0
      if (isFailureEvent(e)) { r.fails += 1; r.last = 'fail' } else r.last = 'ok'
    }
    r.lastTs = e.ts
  }
  if (dom.deckStatusMeta) dom.deckStatusMeta.textContent = `${m.size} TOOLS`
  deckText(c, 7)
  const rowH = 12
  const rows = [...m.entries()].sort((a, b) => b[1].lastTs - a[1].lastTs).slice(0, Math.max(2, Math.floor((h - 12) / rowH)))
  const cols = [0, w * 0.40, w * 0.55, w * 0.68, w - 2]
  c.fillStyle = 'rgba(150,156,162,0.55)'
  ;['TOOL', 'CALL', 'FAIL', 'AVG', 'STATE'].forEach((t, i) => {
    c.textAlign = i === 4 ? 'right' : 'left'
    c.fillText(t, cols[i], 5)
  })
  if (!rows.length) return
  rows.forEach(([name, r], i) => {
    const y = 17 + i * rowH
    const fl = 1 - arrive(r.lastTs)
    if (fl > 0.01) {
      c.fillStyle = `rgba(236,240,244,${0.10 * fl})`
      c.fillRect(0, y - rowH / 2, w, rowH)
    }
    c.textAlign = 'left'
    c.fillStyle = `rgba(214,218,222,${0.8 + 0.2 * fl})`
    c.fillText(truncate(name.replace(/^mcp__[^_]+__/, ''), 14), cols[0], y)
    c.fillStyle = 'rgba(190,198,204,0.75)'
    c.fillText(String(r.calls), cols[1], y)
    c.fillStyle = r.fails ? rgba(FAIL_RGB, 0.95) : 'rgba(150,156,162,0.5)'
    c.fillText(String(r.fails), cols[2], y)
    c.fillStyle = 'rgba(190,198,204,0.75)'
    c.fillText(r.nres ? fmtDuration(r.dur / r.nres) : '—', cols[3], y)
    c.textAlign = 'right'
    const running = r.last === 'run' && state.phase === 'tool' && state.tool === name
    const label = running ? 'RUN' : r.last === 'fail' ? 'FAIL' : r.last === 'ok' ? 'OK' : 'WAIT'
    // 状态牌：运行中是实心亮牌并有游标；OK 为描边；FAIL 为灰色斜纹。
    const tw = 26
    const tx = cols[4] - tw
    if (running) {
      c.fillStyle = 'rgba(232,236,240,0.85)'
      c.fillRect(tx, y - 4.5, tw, 9)
      const ph = (state.animNow / 700) % 1
      c.fillStyle = 'rgba(10,10,10,0.5)'
      c.fillRect(tx + ph * (tw - 3), y - 4.5, 3, 9)
      c.fillStyle = 'rgba(10,10,10,0.9)'
    } else {
      c.strokeStyle = label === 'FAIL' ? rgba(FAIL_RGB, 0.8) : 'rgba(190,198,204,0.4)'
      c.lineWidth = 1
      c.strokeRect(tx + 0.5, y - 4, tw - 1, 8)
      c.fillStyle = label === 'FAIL' ? rgba(FAIL_RGB, 0.95) : 'rgba(206,210,214,0.85)'
    }
    c.textAlign = 'center'
    c.fillText(label, tx + tw / 2, y + 0.5)
  })
}

const DECK_FNS = [() => drawDeckTools(), () => drawDeckTokens(), () => drawDeckRoutes(), () => drawDeckMatrix(),
  () => drawDeckFeed(), () => drawDeckCtx(), () => drawDeckTrace(), () => drawDeckStatus()]
let deckRR = 0
function drawDeckOne() {
  if (!state.events.length && !state.rehearsal.active) { drawDeck(); return }
  DECK_FNS[deckRR % DECK_FNS.length]()
  deckRR += 1
}
function drawDeck(now) {
  if (!state.events.length && !state.rehearsal.active) {
    drawDeckTools()
    drawDeckTokens()
    drawDeckRoutes()
    drawDeckMatrix()
    return
  }
  drawDeckTools()
  drawDeckTokens()
  drawDeckRoutes()
  drawDeckMatrix()
  drawDeckFeed()
  drawDeckCtx()
  drawDeckTrace()
  drawDeckStatus()
}

/* ── 总绘制 ─────────────────────────────────────────────────── */
function draw(now) {
  if (W < 20 || H < 20) return
  ctx.clearRect(0, 0, W, H)
  const view = layoutView()
  drawBackdropCached(view, now)
  drawInstrumentFrame(view, now)
  if (view.big) {
    // 巨环向下延伸到遥测台背后：裁掉，避免环从面板里“漏”出来。
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, view.top || 0, W, H - view.deckH - (view.top || 0))
    ctx.clip()
  } else drawTimeRuler(view)
  // 巨环模式：两侧仪表与环下频谱由底部八格面板接管。
  if (!view.big) {
    drawSideTelemetry(view, now)
    drawSpectrum(view, now)
  }
  drawTapeRays(view, now)
  drawOrb(view.orb, now)
  drawTape(view, now)
  drawRing(view, now)
  drawStall(view, now)
  if (!view.orb.web) drawCore(view.orb, now)
  else if (view.big) drawWebCore(view.orb, now)
  drawNetworks(view, now)
  drawPulses(view, now)
  drawMarkers(view, now)
  drawSatellites(view, now)
  drawCurrentGlyph(view, now)
  drawApproval(view, now)
  if (!view.big) drawStatus(view, now)
  drawRehearsalBanner(view, now)
  if (view.big) { ctx.restore(); drawKpiBar(view); drawCornerReadout(view) }
}

// 顶部指标栏（巨环模式，参考 haloflux 顶栏）：全部是到当前回放位置为止的真实累计。
const kpiCache = { ptr: -2, events: null, v: null }
function kpiValues() {
  if (kpiCache.ptr === state.pointer && kpiCache.events === state.events) return kpiCache.v
  let tools = 0
  let models = 0
  let out = 0
  let fails = 0
  const names = new Set()
  for (let i = 0; i <= state.pointer && i < state.events.length; i += 1) {
    const e = state.events[i]
    if (e.kind === 'tool.call') { tools += 1; names.add(e.tool || '') }
    else if (e.kind === 'model.end') { models += 1; out += Number(e.tokens && e.tokens.out) || 0 }
    if (isFailureEvent(e)) fails += 1
  }
  const v = { tools, models, out, fails, kinds: names.size }
  Object.assign(kpiCache, { ptr: state.pointer, events: state.events, v })
  return v
}
// 右下角读数（参考 haloflux 右下“6 / 11 METHODS · 5 PENDING”）：全部是当前真实状态。
//   大字：当前相位 + 工具名；第二行：本回合工具调用数 / 进行中 / 已用时；底部：最近 40 个事件的相位条
