'use strict'
// agent-halo · ui.js — 多语言、点击命中、事件绑定、启动、扩展接口
// 由原 halo.js 第 5868–6312 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

/* ── 语言：英文 / 简体中文 二选一，不混排 ─────────────────── */
const I18N = {
  en: {
    model: 'THINKING', tool: 'RUNNING', waiting_user: 'WAITING', idle: 'IDLE',
    calls: (n) => `${n} CALLS THIS TURN`, open: (n) => `${n} OPEN`,
    stall: (s) => `STALLED ${s}s`, approval: 'APPROVAL REQUIRED',
    kpi: ['EVENTS', 'TOOL CALLS', 'MODEL STEPS', 'TOKENS OUT', 'FAILS', 'CONTEXT'],
    deck: { deckFeed: 'EVENT FEED', deckTools: 'TOOL LOAD', deckTokens: 'TOKEN FLOW', deckCtx: 'CONTEXT', deckTrace: 'LATENCY TRACE', deckStatus: 'TOOL STATUS', deckRoutes: 'NET ROUTE', deckMatrix: 'EVENT MATRIX' },
    compress: 'Compress gaps', compressTip: 'Fast-forward idle gaps longer than 5 s to 0.5 s', btn: '中文',
    liveOption: 'DSH · LIVE (read-only)', liveConnecting: 'LIVE · CONNECTING',
    liveDisconnected: 'LIVE · DISCONNECTED, RETRYING', livePush: 'LIVE · EVENT STREAM',
    liveWaiting: 'LIVE · WAITING FOR DSH', liveEmpty: 'LIVE · NO EVENTS',
    liveMissing: 'LIVE · SESSION DIR NOT FOUND', liveError: 'LIVE · READ FAILED',
    livePartial: 'LIVE · PARTIAL SESSION', sessionReplay: 'DSH session',
    layoutAuto: 'Auto', layoutSmall: 'Compact', layoutBig: 'Expanded',
    layoutBigUnavailable: 'Big layout needs a wider window.', errorTag: 'ERROR',
    musicPlay: 'Play music', musicPause: 'Pause music', musicVolume: 'Music volume', musicUnavailable: 'Music file is missing.',
  },
  zh: {
    model: '思考中', tool: '运行中', waiting_user: '等待中', idle: '空闲',
    calls: (n) => `本轮调用 ${n} 次`, open: (n) => `未返回 ${n}`,
    stall: (s) => `停滞 ${s} 秒`, approval: '需要人工确认',
    kpi: ['事件', '工具调用', '模型步数', '输出 Token', '失败', '上下文'],
    deck: { deckFeed: '事件流水', deckTools: '工具负载', deckTokens: 'Token 流', deckCtx: '上下文', deckTrace: '耗时轨迹', deckStatus: '工具状态', deckRoutes: '网络路由', deckMatrix: '事件矩阵' },
    compress: '空白压缩', compressTip: '把超过 5 秒的空白快进到 0.5 秒', btn: 'EN',
    liveOption: 'DSH · 实时（只读）', liveConnecting: '实时 · 连接中',
    liveDisconnected: '实时 · 连接中断，重试中', livePush: '实时 · 事件直连',
    liveWaiting: '实时 · 等待 DSH 会话', liveEmpty: '实时 · 暂无事件',
    liveMissing: '实时 · 目录不存在', liveError: '实时 · 读取失败',
    livePartial: '实时 · 部分会话待读取', sessionReplay: 'DSH 会话',
    layoutAuto: '自适应', layoutSmall: '小图模式', layoutBig: '大图模式',
    layoutBigUnavailable: '大图模式需要更宽的窗口。', errorTag: '错误',
    musicPlay: '播放音乐', musicPause: '暂停音乐', musicVolume: '背景音乐音量', musicUnavailable: '音乐文件不存在。',
  },
}
let LANG = 'zh'
try { LANG = localStorage.getItem('halo-lang') === 'en' ? 'en' : 'zh' } catch {}
function L() { return I18N[LANG] }
// 页面静态文字：首次记录中文原文，切英文时按词典替换；词典里没有的保持原样。
const STATIC_EN = {
  'DSH / Claude Code 事件光环': 'DSH / Claude Code EVENT HALO', '回放': 'REPLAY', '演练 · 合成脉冲': 'REHEARSAL · SYNTHETIC',
  '刷新': 'RELOAD', '演练': 'REHEARSE', '当前状态': 'CURRENT STATE', '上下文': 'CONTEXT', '步': 'STEP', '并行': 'PARALLEL',
  'LEGEND / 图例': 'LEGEND', '模型': 'Model', '工具': 'Tool', '等人': 'Waiting', '要人确认': 'Approval', '失败缺口': 'Failure gap',
  '搜索 · 雷达': 'Search', '下载 · 向内': 'Download · in', '上传 · 向外': 'Upload · out', '直连': 'Direct', '代理 + PROXY': 'Proxy',
  '网关 GW': 'Gateway', '未知': 'Unknown', '失败断流': 'Broken flow', '最近事件': 'RECENT EVENTS', '下一个异常': 'NEXT ANOMALY',
  '事件详情': 'EVENT DETAIL', '点一条事件，或点光环上的脉冲。': 'Click an event, or a pulse on the halo.', '关联事件': 'Links',
  '类型': 'Kind', '时间': 'Time', '说明': 'Label', '耗时': 'Duration', '来源': 'Source', '网络': 'Network',
  '复制来源路径': 'COPY SOURCE PATH', '速度': 'SPEED', '暂停': 'PAUSE', '播放': 'PLAY',
}
const staticOrig = new Map()
function applyStaticLang() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const skip = (n) => n.parentElement && n.parentElement.closest('#eventList, dd, #phaseText, #modeText, select, canvas')
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (skip(n)) continue
    const raw = n.nodeValue.trim()
    if (!raw) continue
    if (!staticOrig.has(n)) staticOrig.set(n, raw)
    const zh = staticOrig.get(n)
    const want = LANG === 'en' ? (STATIC_EN[zh] || zh) : zh
    if (raw !== want) n.nodeValue = n.nodeValue.replace(raw, want)
  }
  document.title = LANG === 'en' ? 'agent-halo · Event Halo' : 'agent-halo · 事件光环'
}
function applyLang() {
  const t = L()
  applyStaticLang()
  syncPlayBtn()
  const liveOpt = dom.sessionSelect && dom.sessionSelect.querySelector('option[value="__dsh_live__"]')
  if (liveOpt) liveOpt.textContent = t.liveOption
  if (dom.layoutSelect) {
    const layoutLabels = { auto: t.layoutAuto, small: t.layoutSmall, big: t.layoutBig }
    for (const [value, label] of Object.entries(layoutLabels)) {
      const opt = dom.layoutSelect.querySelector(`option[value="${value}"]`)
      if (opt) opt.textContent = label
    }
  }
  if (dom.musicBtn) {
    dom.musicBtn.textContent = dom.bgMusic && !dom.bgMusic.paused ? t.musicPause : t.musicPlay
  }
  if (dom.modeText && !state.live) dom.modeText.textContent = LANG === 'en' ? 'REPLAY' : '回放'
  if (typeof renderEventList === 'function' && state.events.length) renderEventList()
  if (state.selected >= 0 && typeof selectEvent === 'function') selectEvent(state.selected)
  for (const [id, name] of Object.entries(t.deck)) {
    const cv = document.getElementById(id)
    const span = cv && cv.parentElement && cv.parentElement.querySelector('header span')
    if (span) span.textContent = name
  }
  const cl = document.getElementById('compressLabel')
  if (cl) { cl.textContent = t.compress; cl.parentElement.title = t.compressTip }
  const b = document.getElementById('langBtn')
  if (b) b.textContent = t.btn
  state.forceDraw = true
}
function toggleLang() {
  LANG = LANG === 'en' ? 'zh' : 'en'
  try { localStorage.setItem('halo-lang', LANG) } catch {}
  applyLang()
}

function now0() { return state.animNow }
// 数值平滑：所有读数、进度条都经它缓动（τ≈250ms 真实时间），不再一帧跳变。
const smoothMap = new Map()
let smoothLast = 0
function smooth(key, target, tau = 250) {
  const t = performance.now()
  const prev = smoothMap.get(key)
  if (prev == null || !Number.isFinite(prev.v) || Math.abs(target - prev.v) > Math.max(1e6, Math.abs(target) * 50)) {
    smoothMap.set(key, { v: target, t }); return target
  }
  const dt = Math.min(200, t - prev.t)
  prev.v += (target - prev.v) * (1 - Math.exp(-dt / tau))
  prev.t = t
  return prev.v
}
function drawCornerReadout(view) {
  const x1 = W - 24
  const y1 = H - view.deckH - 18
  const ph = state.phase || 'idle'
  let calls = 0
  let open = 0
  const lo = Math.max(0, state.pointer - 400)
  for (let i = state.pointer; i >= lo; i -= 1) {
    const e = state.events[i]
    if (!e) continue
    if (e.kind === 'user.message' || e.kind === 'turn.start') break
    if (e.kind === 'tool.call') { calls += 1; open += 1 } else if (e.kind === 'tool.result') open -= 1
  }
  open = Math.max(0, open)
  const secs = state.phaseStartTs ? Math.max(0, (state.curTs - state.phaseStartTs) / 1000) : 0
  const rgbT = ph === 'model' ? WAVE_RGB.model : ph === 'tool' ? WAVE_RGB.tool : ph === 'waiting_user' ? SEG.waiting_user.rgb : '255,255,255'
  // 相位色 RGB 分量各自缓动 → 切换相位时颜色平滑过渡
  const rgb = rgbT.split(',').map((c, k) => Math.round(smooth('crgb' + k, +c, 220))).join(',')
  const t = L()
  const en = LANG === 'en'
  // 状态字切换：新字从 0 淡入
  if (!smoothMap.has('cphase:' + ph)) smoothMap.set('cphase:' + ph, { v: 0, t: performance.now() })
  const fadeIn = smooth('cphase:' + ph, 1, 260)
  for (const k of smoothMap.keys()) if (k.startsWith('cphase:') && k !== 'cphase:' + ph) smoothMap.delete(k)
  const W0 = 300
  const x0 = x1 - W0
  const stall = Math.floor(Math.max(stallSeconds(), state.animNow < state.stallFlashUntil ? state.stallFlashSeconds : 0))
  const appr = approvalIntensity(state.animNow) > 0.001
  const err = errorIntensity() > 0.001
  const statusRgb = err ? APPROVAL_RGB : rgb
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.textBaseline = 'alphabetic'
  // 1) 小标题行 + 细分隔线
  ctx.font = `600 9px ${FONT_MONO}`
  ctx.letterSpacing = '2px'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText(en ? 'AGENT STATUS' : '当前状态', x0, y1 - 76)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(x0, y1 - 70, W0, 1)
  // 告警/停滞：右侧描边小标签
  const tags = []
  if (err) tags.push([t.errorTag, APPROVAL_RGB])
  if (appr) tags.push([t.approval, APPROVAL_RGB])
  if (stall > 8) tags.push([t.stall(stall), SEG.waiting_user.rgb])
  ctx.font = `600 9px ${FONT_UI}`
  let tx = x1
  for (const [txt, c2] of tags) {
    const tw = ctx.measureText(txt).width + 12
    tx -= tw
    ctx.strokeStyle = rgba(c2, 0.9)
    ctx.lineWidth = 1
    ctx.strokeRect(tx + 0.5, y1 - 86.5, tw, 14)
    ctx.fillStyle = rgba(c2, 1)
    ctx.textAlign = 'center'
    ctx.fillText(txt, tx + tw / 2, y1 - 76)
    tx -= 6
  }
  // 2) 状态大字（白）+ 左侧相位色条；错误/工具名单独一行
  ctx.fillStyle = rgba(statusRgb, 1)
  ctx.fillRect(x0, y1 - 60, 3, 40)
  ctx.textAlign = 'left'
  ctx.font = `600 26px ${FONT_UI}`
  ctx.fillStyle = err ? rgba(APPROVAL_RGB, 1) : '#fff'
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  const stateWord = err ? t.errorTag : (t[ph] || t.idle)
  ctx.globalAlpha = 0.15 + 0.85 * fadeIn
  ctx.strokeText(stateWord, x0 + 12, y1 - 34)
  ctx.fillText(stateWord, x0 + 12, y1 - 34)
  const subline = err ? state.latestErrorLabel : (ph === 'tool' && state.tool ? String(state.tool).replace(/^mcp__[^_]+__/, '') : '')
  if (subline) {
    ctx.font = `500 12px ${FONT_MONO}`
    ctx.fillStyle = err ? rgba(APPROVAL_RGB, 1) : rgba(rgb, 1)
    ctx.strokeText(truncate(subline, 28), x0 + 12, y1 - 18)
    ctx.fillText(truncate(subline, 28), x0 + 12, y1 - 18)
  }
  ctx.globalAlpha = 1
  // 3) 三列读数：标签小字 / 数值粗体
  const cols = [
    [en ? 'CALLS' : '本轮调用', String(calls)],
    [en ? 'OPEN' : '未返回', String(open)],
    [en ? 'ELAPSED' : '已用时', `${secs.toFixed(1)}${en ? 's' : ' 秒'}`],
  ]
  cols.forEach(([k2, v], ci) => {
    const cx2 = x0 + 160 + ci * 48 - (ci === 2 ? 0 : 0)
    const xx = ci === 2 ? x1 : cx2
    ctx.textAlign = ci === 2 ? 'right' : 'left'
    ctx.font = `500 8.5px ${FONT_UI}`
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(k2, xx, y1 - 50)
    ctx.font = `700 15px ${FONT_MONO}`
    ctx.fillStyle = '#fff'
    ctx.fillText(v, xx, y1 - 32)
  })
  // 4) 最近事件条：细、等宽，最新一格加高
  const n = 50
  const cw = W0 / n
  for (let k = 0; k < n; k += 1) {
    const e = state.events[state.pointer - (n - 1 - k)]
    if (!e) continue
    const c = e.kind === 'approval.request' ? APPROVAL_RGB : isFailureEvent(e) ? FAIL_RGB
      : e.kind === 'model.end' ? WAVE_RGB.model : e.kind === 'tool.call' ? WAVE_RGB.tool : e.kind === 'tool.result' ? WAVE_RGB.result
      : e.kind === 'user.message' ? SEG.waiting_user.rgb : '120,120,120'
    const last = k === n - 1
    ctx.fillStyle = rgba(c, last ? 1 : 0.75)
    ctx.fillRect(x0 + k * cw, y1 - (last ? 12 : 6), cw - 1.5, last ? 12 : 6)
  }
  ctx.restore()
}

function drawKpiBar(view) {
  const x0 = 24
  const x1 = W - 22
  if (x1 - x0 < 300) return
  const v = kpiValues()
  const total = Math.max(1, state.events.length)
  const ratio = clamp(Number(state.contextRatio) || 0, 0, 1)
  const items = [
    [L().kpi[0], `${Math.max(0, state.pointer + 1)}`, (state.pointer + 1) / total],
    [L().kpi[1], `${v.tools}`, v.tools / Math.max(1, v.tools + v.models)],
    [L().kpi[2], `${v.models}`, v.models / Math.max(1, v.tools + v.models)],
    [L().kpi[3], v.out >= 10000 ? `${(v.out / 1000).toFixed(1)}k` : `${v.out}`, clamp(Math.log10(1 + v.out) / 6, 0, 1)],
    [L().kpi[4], `${v.fails}`, v.fails / Math.max(1, v.tools)],
    [L().kpi[5], `${Math.round(ratio * 100)}%`, ratio],
  ]
  const cw = (x1 - x0) / items.length
  // 底衬：压住从下方穿过的光柱，指标始终可读。
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, view.top || 62)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(0, (view.top || 62) - 1, W, 1)
  items.forEach(([k, val, p], i) => {
    const x = x0 + i * cw
    const y = 10
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `500 7.5px ${FONT_MONO}`
    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.fillText(k, x, y)
    ctx.font = `700 17px ${FONT_MONO}`
    const warn = (i === 5 && ratio > 0.8) || (i === 4 && v.fails > 0)
    ctx.fillStyle = warn ? 'rgba(232,196,128,1)' : '#fff'
    ctx.fillText(val, x, y + 12)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(x, y + 36, cw - 18, 1.5)
    ctx.fillStyle = warn ? 'rgba(232,196,128,1)' : '#fff'
    ctx.fillRect(x, y + 36, (cw - 18) * clamp(smooth('kpi' + i, clamp(p, 0, 1)), 0, 1), 1.5)
  })
}

/* ── 点击命中 ───────────────────────────────────────────────── */
function hitTest(mx, my) {
  const view = layoutView()
  const now = state.animNow
  buildBrain()
  const ov = view.orb || view
  const rs = ov.R * 0.81
  const ay = state.curTs * 0.00004
  const ax = 0.36 + Math.sin(state.curTs * 0.000018) * 0.08
  const spin = ringSpin()
  let nodeHit = null
  let nodeDist = 12 * 12
  if (ov.web) { ov.web.range = webRange(); ov.web.rot = webRot() }
  for (const n of brain.nodes) {
    const cp = Math.cos(n.phi)
    // 节点坐标与绘制一致：固定 rs 投影，不乘球壳呼吸。
    const nx3 = Math.cos(n.theta) * cp * n.rad
    const ny3 = Math.sin(n.phi) * n.rad
    const nz3 = Math.sin(n.theta) * cp * n.rad
    const p = ov.web ? webProject(ov.web, nx3, ny3, nz3) : projectOrb(nx3, ny3, nz3, ov.cx, ov.cy, rs, ay, ax)
    const x = p[0]
    const y = p[1]
    const d = (x - mx) ** 2 + (y - my) ** 2
    if (d < nodeDist) { nodeDist = d; nodeHit = n.index }
  }
  if (nodeHit != null) return nodeHit
  const tapeIdx = tapeHit(view, mx, my)
  if (tapeIdx != null) return tapeIdx
  let best = -1
  let bestD = 16 * 16

  for (const m of fx.markers) {
    if (m.index < 0) continue
    const [x, y] = polar(view.cx, view.cy, view.R + 2, fxAngle(view, m.angle, m.index))
    const d = (x - mx) * (x - mx) + (y - my) * (y - my)
    if (d < bestD) { bestD = d; best = m.index }
  }
  for (const p of fx.pulses) {
    if (!(p.eventIndex >= 0)) continue
    const t = clamp((now - p.start) / p.dur, 0, 1)
    const ease = 1 - Math.pow(1 - t, 3)
    const rr = view.R + (p.type === 'step' ? 6 + ease * 46 : 8 + ease * 14)
    const [x, y] = polar(view.cx, view.cy, rr, fxAngle(view, p.angle, p.eventIndex))
    const d = (x - mx) * (x - mx) + (y - my) * (y - my)
    if (d < bestD) { bestD = d; best = p.eventIndex }
  }
  return best >= 0 ? best : null
}

function onCanvasClick(ev) {
  const rect = dom.canvas.getBoundingClientRect()
  const i = hitTest(ev.clientX - rect.left, ev.clientY - rect.top)
  // 点画面上的任意事件（卡片 / 节点 / 波纹）：时间轴跳到该事件并暂停，同时选中
  if (i != null) selectAndSeek(i)
}

function onCanvasMove(ev) {
  const rect = dom.canvas.getBoundingClientRect()
  const i = hitTest(ev.clientX - rect.left, ev.clientY - rect.top)
  dom.canvas.style.cursor = i != null ? 'pointer' : 'default'
}

/* ── 事件绑定 ───────────────────────────────────────────────── */
function bindUI() {
  dom.sessionSelect.addEventListener('change', () => {
    const name = dom.sessionSelect.value
    if (name === '__dsh_live__') startLive()
    else if (name) loadFile(name)
  })
  dom.layoutSelect.addEventListener('change', () => {
    const value = ['auto', 'small', 'big'].includes(dom.layoutSelect.value) ? dom.layoutSelect.value : 'auto'
    state.layoutMode = value
    try { localStorage.setItem('halo-layout', value) } catch {}
    if (value === 'big' && W < 420) showToast(L().layoutBigUnavailable)
    // 同步给 CSS：分屏强制大图时压缩底部遥测台，把巨环区域让高、让窄。
    resizeCanvas()
  })
  dom.reloadBtn.addEventListener('click', () => refreshList())

  dom.playBtn.addEventListener('click', togglePlay)
  dom.speedSelect.addEventListener('change', () => {
    const v = Number(dom.speedSelect.value)
    state.speed = Number.isFinite(v) && v > 0 ? v : 8
  })
  dom.compressGaps.addEventListener('change', () => {
    const idx = state.pointer
    state.compress = !!dom.compressGaps.checked
    buildTimeline()
    state.pt = idx >= 0 ? (state.pts[idx] || 0) : 0
    if (idx >= 0) state.curTs = state.events[idx].ts
    syncSlider()
    updatePanel()
  })
  dom.timeline.addEventListener('input', () => {
    state.scrubbing = true
    const v = Number(dom.timeline.value) / 1000
    const [lo, hi] = zoomRange()
    seekToPt((lo + v * (hi - lo)) * state.total)
    clearTimeout(state.scrubTimer)
    state.scrubTimer = setTimeout(() => { state.scrubbing = false }, 700)
  })
  dom.timeline.addEventListener('change', () => { state.scrubbing = false })
  dom.timeline.addEventListener('wheel', (ev) => {
    ev.preventDefault()
    const r = dom.timeline.getBoundingClientRect()
    const [lo, hi] = zoomRange()
    const at = lo + clamp((ev.clientX - r.left) / r.width, 0, 1) * (hi - lo)
    const w = clamp((hi - lo) * (ev.deltaY < 0 ? 0.8 : 1.25), 0.002, 1)
    if (w >= 0.999) state.zoom = null
    else { const nlo = clamp(at - (at - lo) * (w / (hi - lo)), 0, 1 - w); state.zoom = { lo: nlo, hi: nlo + w } }
    syncSlider()
  }, { passive: false })
  dom.timeline.addEventListener('dblclick', () => { state.zoom = null; syncSlider() })

  dom.nextAnomaly.addEventListener('click', goNextAnomaly)
  dom.copyRef.addEventListener('click', copyRefPath)
  dom.rehearsalBtn.addEventListener('click', () => {
    if (state.rehearsal.active) stopRehearsal(true)
    else startRehearsal()
  })

  dom.canvas.addEventListener('click', onCanvasClick)
  dom.canvas.addEventListener('mousemove', onCanvasMove)

  window.addEventListener('keydown', (ev) => {
    const target = ev.target
    const tag = target && target.tagName ? target.tagName : ''
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON|LI)$/.test(tag) || (target && target.isContentEditable)) return
    if (ev.code === 'Space') { ev.preventDefault(); togglePlay() }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); stepBy(1) }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepBy(-1) }
    else if (ev.key === 'n' || ev.key === 'N') { ev.preventDefault(); goNextAnomaly() }
  })

  window.addEventListener('resize', resizeCanvas)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => resizeCanvas())
    ro.observe(dom.canvas)
  }
  document.addEventListener('visibilitychange', () => {
    state.lastNow = performance.now()
  })
}

/* ── 启动 ───────────────────────────────────────────────────── */
function boot() {
  const lb = document.getElementById('langBtn')
  if (lb) lb.addEventListener('click', () => { toggleLang(); lb.blur() })
  applyLang()
  // 选完下拉项立即失焦，让画面恢复全速（下拉框聚焦期间会主动降帧）。
  document.addEventListener('change', (ev) => { if (ev.target && ev.target.tagName === 'SELECT') ev.target.blur() })
  if (dom.layoutSelect) dom.layoutSelect.value = state.layoutMode
  resizeCanvas()
  bindUI()
  setupMusic()
  syncPlayBtn()
  updatePanel()
  requestAnimationFrame((t) => {
    state.lastNow = t
    frame(t)
  })
  refreshList()
}

boot()

// ── 扩展接口：web/ext/*.js 通过它读状态、调用内部函数（扩展模块不得直接改 halo.js） ──
window.__haloApi = {
  state, fx, dom,
  layoutView, hitTest, selectAndSeek, seekToEvent, syncPlayBtn, kindLabel, isFailureEvent, isAnomaly, fmtClock, fmtDuration,
  get lang() { return LANG },
  get canvas() { return dom.canvas },
  setPerf(on) { state.perfMode = !!on; resizeCanvas() },
  zoomRange, bigLayout, tapeGeom,
  hooks: { afterDraw: [], onLoad: [] },
}

