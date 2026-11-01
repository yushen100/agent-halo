'use strict'
// agent-halo · core.js — 常量、小工具、DOM、状态、画布尺寸
// 由原 halo.js 第 1–566 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

// agent-halo · Canvas 渲染层（零依赖、离线可用）
//
// 设计约法：
//   1. 心跳节拍由真实时间驱动，数据只叠加脉冲/重音，绝不改变主 tempo。
//   2. 环上只有当前相位段是亮的；相位切换有扫光。
//   3. 失败 = 环上缺口 + 淡色疤痕，不用红色。
//   4. 红色只留给 approval.request（要人确认）。
//   5. 网络形态由 docs/net-contract.md 第 3 节决定；方向靠箭头+线型，颜色只辅助。
//   6. 所有事件文字只用 textContent 渲染，绝不把日志内容当 HTML 插入。
//   7. 视觉元素角度统一由 event_id 哈希决定，拖动时间轴不会让图形乱跳。

const TAU = Math.PI * 2
const FONT_UI = '"Bahnschrift", "Arial Narrow", "Segoe UI", "Microsoft YaHei", sans-serif'
const FONT_MONO = 'Consolas, "Cascadia Mono", "Courier New", monospace'
const HUD_CHARS = '0123456789ABCDEF·+×/'

/* ── 相位三段 ───────────────────────────────────────────────── */
// 三段正好铺满 360°：模型 -150°→-30°，工具 -30°→90°，等人 90°→210°。
const SEG = {
  model: { start: (-5 * Math.PI) / 6, end: -Math.PI / 6, name: '模型', en: 'MODEL', rgb: '198,206,214' },
  tool: { start: -Math.PI / 6, end: Math.PI / 2, name: '工具', en: 'TOOL', rgb: '195,200,204' },
  waiting_user: { start: Math.PI / 2, end: (7 * Math.PI) / 6, name: '等人', en: 'WAIT', rgb: '190,168,124' },
}
const SEG_KEYS = ['model', 'tool', 'waiting_user']
const IDLE_RGB = '96,102,108'

/* ── 网络视觉常量（契约 v1.0 第 3 节） ───────────────────────── */
const NET_DUR = { search: 2500, fetch: 1700, download: 2300, upload: 2300, transfer: 2700, api: 1100 }
const NET_KINDS = ['search', 'fetch', 'download', 'upload', 'transfer', 'api']
const ROUTES = ['direct', 'proxy', 'gateway', 'unknown']
// 网络线配色（用户要求换色，避开模型金/工具青绿/审批红）：
const IN_RGB = '170,240,90'       // 下载 / 取回：黄绿
const OUT_RGB = '255,150,60'      // 上传：橙
const SEARCH_RGB = '255,110,190'  // 搜索：粉
const PROXY_RGB = '185,140,255'   // 代理节点与代理线：紫
const GW_RGB = '255,235,160'      // 网关节点：浅金
const FAIL_RGB = '140,146,152'    // 失败：灰，不用红
const APPROVAL_RGB = '220,70,70'  // 唯一的红：要人确认
const SUB_RGB = '176,182,188'      // 子任务卫星：银灰

const ROUTE_CN = { direct: '直连', proxy: '代理', gateway: '网关', unknown: '未知' }
const DIR_CN = { in: '向内', out: '向外', both: '双向', none: '无方向' }
const NET_KIND_CN = {
  search: '搜索', fetch: '取回', download: '下载', upload: '上传', transfer: '双向传输', api: '接口调用',
}

const KIND_NAME = {
  'session.start': '会话开始', 'turn.start': '轮次开始', 'turn.end': '轮次结束',
  'step.start': '步开始', 'step.end': '步结束', 'model.end': '模型输出',
  'tool.call': '工具调用', 'tool.result': '工具结果', 'subagent.start': '子任务',
  'error': '错误', 'context.update': '上下文更新', 'approval.request': '要人确认',
  'user.message': '用户输入',
}
const KIND_SHORT = {
  'session.start': '会', 'turn.start': '轮', 'turn.end': '终', 'step.start': '步',
  'step.end': '毕', 'model.end': '模', 'tool.call': '工', 'tool.result': '果',
  'subagent.start': '子', 'error': '错', 'context.update': '上',
  'approval.request': '审', 'user.message': '用',
}

/* ── 小工具 ─────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id)

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
function lerp(a, b, t) { return a + (b - a) * t }
function rgba(rgb, a) { return `rgba(${rgb},${clamp(a, 0, 1)})` }
// 统一呼吸：只有 agent 真的在跑（模型/工具相位）时才呼吸，空闲即静止。
function breath(now) {
  if (state.phase !== 'model' && state.phase !== 'tool') return 0.5
  return 0.5 + 0.5 * Math.sin((now / 3200) * TAU - Math.PI / 2)
}

// 神经网的光强只由真实产出决定：输出速率越高、越在干活，光越亮。
// 空闲时压到很低，画面安静但不会死黑。
function orbBreathScale(now) {
  return 1 + (breath(now) - 0.5) * 0.12
}

// 环自转：整环共用一个角偏移，相位段、缺口、疤痕、标记的相对位置保持不变。
// 用会话时间而不是墙钟：暂停或拖动时间轴时，环同步冻结/对齐。
// 节拍驱动的变速自转：底速很慢，每个真实事件给环一次角冲量，按 τ 指数释放。
//   angle(t) = SPIN_BASE·t + Σ_{e.ts ≤ t} A_e · (1 − exp(−(t − e.ts)/τ))
// 只依赖会话时间 curTs 和事件列表：暂停即停、拖时间轴即对齐、点选坐标与绘制一致。
const SPIN_BASE = 0.000022
const SPIN_TAU = 900
const spinCache = { events: null, len: 0, ts: [], cum: [] }
function spinImpulse(e) {
  if (e.kind === 'model.end') return 0.05 + 0.10 * rayLevel(e)
  if (e.kind === 'tool.call') return 0.06
  if (e.kind === 'tool.result') return 0.03 + 0.07 * rayLevel(e)
  if (e.kind === 'user.message') return 0.12
  if (e.kind === 'subagent.start') return 0.08
  if (e.kind === 'step.start') return 0.04
  return 0
}
function buildSpinCache() {
  const ev = state.events
  if (spinCache.events === ev && spinCache.len === ev.length) return
  let c = 0
  const ts = []
  const cum = []
  for (const e of ev) { c += spinImpulse(e); ts.push(e.ts); cum.push(c) }
  Object.assign(spinCache, { events: ev, len: ev.length, ts, cum })
}
function lastIdxAtOrBefore(arr, t) {
  let lo = 0
  let hi = arr.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}
function ringSpinRaw(t) {
  if (!t) return 0
  buildSpinCache()
  const { ts, cum } = spinCache
  const hi = lastIdxAtOrBefore(ts, t)
  const cut = lastIdxAtOrBefore(ts, t - SPIN_TAU * 7)
  let a = SPIN_BASE * t + (cut >= 0 ? cum[cut] : 0)
  for (let k = cut + 1; k <= hi; k += 1) {
    const imp = cum[k] - (k > 0 ? cum[k - 1] : 0)
    if (imp) a += imp * (1 - Math.exp(-(t - ts[k]) / SPIN_TAU))
  }
  return a
}
// 每帧会被调用上百次：按 (curTs, 事件数) 记忆，避免重复求和。
let spinMemoT = NaN
let spinMemoLen = -1
let spinMemoV = 0
function ringSpin() {
  const t = state.curTs || 0
  if (t !== spinMemoT || state.events.length !== spinMemoLen || spinCache.events !== state.events) {
    spinMemoV = ringSpinRaw(t) % TAU
    spinMemoT = t
    spinMemoLen = state.events.length
  }
  return spinMemoV
}
// 当前角速度（rad/会话毫秒）：用于光线的运动拖影，同样完全由事件决定。
function ringSpinVel() {
  const t = state.curTs || 0
  if (!t) return 0
  buildSpinCache()
  const { ts, cum } = spinCache
  const hi = lastIdxAtOrBefore(ts, t)
  const cut = lastIdxAtOrBefore(ts, t - SPIN_TAU * 7)
  let v = SPIN_BASE
  for (let k = cut + 1; k <= hi; k += 1) {
    const imp = cum[k] - (k > 0 ? cum[k - 1] : 0)
    if (imp) v += (imp / SPIN_TAU) * Math.exp(-(t - ts[k]) / SPIN_TAU)
  }
  return v
}
// 环上元素的统一入口：新加的环上元素一律用 ringAngle(静态角)，不要手写 + spin。
function ringAngle(a) { return a + ringSpin() }

function neuralEnergy() {
  const rate = clamp((state.tokenRateShown || 0) / 80, 0, 1)
  const busy = state.phase === 'model' ? 1
    : state.phase === 'tool' ? 0.72
      : state.phase === 'waiting_user' ? 0.35 : 0.12
  return clamp(0.10 + rate * 0.90, 0, 1) * busy
}

// 相位切换的淡入：避免状态标题和亮弧硬切，像灯慢慢亮起来。
let fadePhase = null
let fadeAt = 0
function phaseFade(now) {
  if (state.phase !== fadePhase) {
    fadePhase = state.phase
    fadeAt = now
  }
  return clamp((now - fadeAt) / 420, 0, 1)
}
function truncate(s, n) {
  const str = String(s == null ? '' : s)
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

function hash32(str) {
  let h = 2166136261
  const s = String(str == null ? '' : str)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
// 用 event_id 哈希出稳定角度：同一事件在任意时刻都落在同一方位。
function hashAngle(id) { return (hash32(id) / 4294967296) * TAU }

function polar(cx, cy, r, a) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] }

function pad2(n) { return String(n).padStart(2, '0') }
function fmtClock(ts) {
  if (!Number.isFinite(ts)) return '--:--:--'
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
function fmtDateTime(ts) {
  if (!Number.isFinite(ts)) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${fmtClock(ts)}`
}
function fmtDuration(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${Math.round(n)} ms`
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`
  return `${Math.floor(n / 60000)} 分 ${Math.round((n % 60000) / 1000)} 秒`
}
function fmtBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / 1024 / 1024).toFixed(1)} MB`
}

function phaseKey(p) {
  if (p === 'waiting_user' || p === 'waiting') return 'waiting_user'
  if (p === 'model') return 'model'
  if (p === 'tool') return 'tool'
  return null
}
function phaseName(p) {
  const en = typeof LANG !== 'undefined' && LANG === 'en'
  if (!p || p === 'idle' || !SEG[p]) return en ? 'IDLE' : '空闲'
  return en ? SEG[p].en : SEG[p].name
}
function phaseRgb(p) {
  if (!p || p === 'idle' || !SEG[p]) return IDLE_RGB
  return SEG[p].rgb
}
function isFailureEvent(e) {
  return !!e && (e.kind === 'error' || e.status === 'error' || e.status === 'denied')
}
function isAgentActionEvent(e) {
  return !!e && (
    e.kind === 'tool.call' || e.kind === 'model.end' || e.kind === 'turn.start' ||
    e.kind === 'step.start' || e.kind === 'user.message' || e.kind === 'subagent.start'
  )
}
function isAnomaly(e) {
  return !!e && (e.kind === 'error' || e.kind === 'approval.request' || e.status === 'error' || e.status === 'denied')
}
function kindLabel(kind) { return (typeof LANG !== 'undefined' && LANG === 'en') ? String(kind || 'event') : (KIND_NAME[kind] || kind || '事件') }
const KIND_SHORT_EN = { 'tool.call': 'C', 'tool.result': 'R', 'model.end': 'M', 'user.message': 'U', 'approval.request': '!', 'error': 'E', 'subagent.start': 'S', 'step.start': 's', 'turn.start': 'T' }
function kindShort(kind) { return ((typeof LANG !== 'undefined' && LANG === 'en') ? KIND_SHORT_EN[kind] : KIND_SHORT[kind]) || '·' }

function netKind(kind) { return NET_KINDS.includes(kind) ? kind : 'fetch' }
function netRoute(route) { return ROUTES.includes(route) ? route : 'unknown' }

function refText(e) {
  const r = (e && e.ref) || null
  if (!r) return '—'
  let s = r.file || '—'
  if (r.line != null) s += `:${r.line}`
  else if (r.seq != null) s += ` #${r.seq}`
  return s
}
function netText(net) {
  if (!net || typeof net !== 'object') return '—'
  const parts = []
  parts.push(NET_KIND_CN[net.kind] || net.kind || '未知类型')
  if (net.direction) parts.push(DIR_CN[net.direction] || net.direction)
  if (net.route) parts.push(ROUTE_CN[net.route] || net.route)
  if (net.method) parts.push(String(net.method))
  if (net.host) parts.push(String(net.host))
  if (net.proxy) parts.push(`代理 ${net.proxy}`)
  if (net.bytes != null) parts.push(`${net.bytes} B`)
  return parts.join(' · ')
}

/* ── DOM ────────────────────────────────────────────────────── */
const dom = {
  canvas: $('halo'),
  sessionSelect: $('sessionSelect'),
  layoutSelect: $('layoutSelect'),
  reloadBtn: $('reloadBtn'),
  rehearsalBtn: $('rehearsalBtn'),
  rehearsalBadge: $('rehearsalBadge'),

  phaseText: $('phaseText'),
  toolText: $('toolText'),
  nowError: $('nowError'),
  nowErrorTag: $('nowErrorTag'),
  nowErrorText: $('nowErrorText'),
  tokenRate: $('tokenRate'),
  contextPct: $('contextPct'),
  stepText: $('stepText'),
  subagentText: $('subagentText'),

  eventList: $('eventList'),
  nextAnomaly: $('nextAnomaly'),

  detailEmpty: $('detailEmpty'),
  detailBody: $('detailBody'),
  dKind: $('dKind'),
  dLinks: $('dLinks'),
  dTime: $('dTime'),
  dTool: $('dTool'),
  dNetDt: $('dNetDt'),
  dNet: $('dNet'),
  dLabel: $('dLabel'),
  dDuration: $('dDuration'),
  dRef: $('dRef'),
  copyRef: $('copyRef'),

  playBtn: $('playBtn'),
  speedSelect: $('speedSelect'),
  bgMusic: $('bgMusic'),
  musicBtn: $('musicBtn'),
  musicVolume: $('musicVolume'),
  musicVolText: $('musicVolText'),
  compressGaps: $('compressGaps'),
  timeline: $('timeline'),
  clockText: $('clockText'),
  topClock: $('topClock'),
  modeText: $('modeText'),

  deckEl: document.querySelector('.deck'),
  deckFeed: $('deckFeed'),
  deckCtx: $('deckCtx'),
  deckTrace: $('deckTrace'),
  deckStatus: $('deckStatus'),
  deckFeedMeta: $('deckFeedMeta'),
  deckCtxMeta: $('deckCtxMeta'),
  deckTraceMeta: $('deckTraceMeta'),
  deckStatusMeta: $('deckStatusMeta'),
  deckTools: $('deckTools'),
  deckTokens: $('deckTokens'),
  deckRoutes: $('deckRoutes'),
  deckMatrix: $('deckMatrix'),
  deckToolsMeta: $('deckToolsMeta'),
  deckTokensMeta: $('deckTokensMeta'),
  deckRoutesMeta: $('deckRoutesMeta'),
  deckMatrixMeta: $('deckMatrixMeta'),

  toast: $('toast'),
}

let ctx = dom.canvas.getContext('2d')
const deck = {
  tools: { canvas: dom.deckTools, ctx: null, w: 0, h: 0 },
  tokens: { canvas: dom.deckTokens, ctx: null, w: 0, h: 0 },
  routes: { canvas: dom.deckRoutes, ctx: null, w: 0, h: 0 },
  matrix: { canvas: dom.deckMatrix, ctx: null, w: 0, h: 0 },
  feed: { canvas: dom.deckFeed, ctx: null, w: 0, h: 0 },
  ctxp: { canvas: dom.deckCtx, ctx: null, w: 0, h: 0 },
  trace: { canvas: dom.deckTrace, ctx: null, w: 0, h: 0 },
  status: { canvas: dom.deckStatus, ctx: null, w: 0, h: 0 },
}
// 遥测台高对比：拦截各面板画布的 fillStyle/strokeStyle，灰色一律提成白、透明度整体抬高；
// 带色彩的（琥珀、波纹色、红）保留色相只抬透明度。这样八个面板的旧代码不用逐行改。
function boostColor(v) {
  if (typeof v !== 'string') return v
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/)
  if (!m) return v
  let r = +m[1], g = +m[2], b = +m[3]
  const a = m[4] == null ? 1 : +m[4]
  if (r < 30 && g < 30 && b < 30) return v // 黑色（文字底/刻空）保持
  const grey = Math.max(r, g, b) - Math.min(r, g, b) < 30
  if (grey) { r = 255; g = 255; b = 255 }
  return `rgba(${r},${g},${b},${Math.min(1, a * 1.9 + 0.12)})`
}
function boostCtx(c) {
  const proto = CanvasRenderingContext2D.prototype
  const fd = Object.getOwnPropertyDescriptor(proto, 'fillStyle')
  const sd = Object.getOwnPropertyDescriptor(proto, 'strokeStyle')
  Object.defineProperty(c, 'fillStyle', { get() { return fd.get.call(this) }, set(v) { fd.set.call(this, boostColor(v)) } })
  Object.defineProperty(c, 'strokeStyle', { get() { return sd.get.call(this) }, set(v) { sd.set.call(this, boostColor(v)) } })
  return c
}
for (const d of Object.values(deck)) if (d.canvas) d.ctx = boostCtx(d.canvas.getContext('2d'))

/* ── 状态 ───────────────────────────────────────────────────── */
const state = {
  events: [],
  file: '',
  live: false,
  liveSource: null,
  pts: [],
  gaps: [],
  total: 1,
  compress: true,
  speed: 4,
  // 自适应 / 小图 / 大图；localStorage 记忆用户选择。
  layoutMode: (() => {
    try {
      const v = localStorage.getItem('halo-layout')
      return ['auto', 'small', 'big'].includes(v) ? v : 'auto'
    } catch { return 'auto' }
  })(),
  playing: false,
  pt: 0,
  pointer: -1,
  curTs: 0,
  phase: 'idle',
  phaseStartTs: 0,
  tool: '',
  turn: null,
  step: null,
  contextRatio: 0,
  toolStartedAt: null,
  lastToolCall: null,
  lastNetByTool: new Map(),
  latestApprovalTs: null,
  latestErrorTs: null,
  latestErrorLabel: '',
  errorStatusVisible: false,
  satellites: [],
  notches: [],
  scars: [],
  tokenRate: 0,
  tokenRateShown: 0,
  selected: -1,
  listIndex: -1,
  listEls: [],
  loading: false,
  error: '',
  scrubbing: false,
  scrubTimer: 0,
  toastTimer: 0,
  errorAlertTimer: 0,
  lastErrorToastAt: 0,
  lastScroll: 0,
  lastPanel: 0,
  lastDust: 0,
  lastNow: 0,
  animNow: 0,
  stallFlashUntil: 0,
  stallFlashSeconds: 0,
  rehearsal: { active: false, timers: [], caption: '' },
}

const fx = {
  pulses: [],
  echoes: [],
  sweeps: [],
  nets: [],
  markers: [],
  approvals: [],
  dust: [],
  brainSignals: [],
  rayPackets: [],
  brainFlashes: [],
  // 演练专用：与真实事件、时间轴完全隔离。
  demoNets: [],
  demoNotches: [],
  demoScars: [],
  demoApprovals: [],
  demoCaption: '',
}

let W = 800
let H = 600
let DPR = 1
let loadSeq = 0
let demoSeq = 0
// DSH 插件启动后打开的地址带 ?live=1：首屏直接进实时模式。
// 只影响第一次列表加载；之后在下拉框选回放仍按回放处理，刷新也不会抢回去。
const INITIAL_LIVE = (() => {
  try { return new URLSearchParams(location.search).get('live') === '1' } catch { return false }
})()
let liveDefaultApplied = false

/* ── 画布尺寸 ───────────────────────────────────────────────── */
function syncLayoutClass() {
  if (!document.body) return
  document.body.dataset.layout = state.layoutMode
  // 分屏窗口通常 <1100px；此时强制大图需要压缩右侧栏，让巨环区域在横向上更宽。
  document.body.dataset.narrowBig = state.layoutMode === 'big' && (window.innerWidth < 1100 || W < 760) ? '1' : '0'
}
function resizeCanvas() {
  // 先解除上次锁定的 CSS 尺寸，让布局重新给出真实可用大小
  dom.canvas.style.width = ''
  dom.canvas.style.height = ''
  const measure = () => {
    const r = dom.canvas.getBoundingClientRect()
    W = Math.max(320, Math.round(r.width || 800))
    H = Math.max(300, Math.round(r.height || 600))
  }
  measure()
  syncLayoutClass()
  // 分屏大图会改右侧栏宽度，重新量一次 canvas，避免继续用旧宽度绘制。
  measure()
  // 锐度优先：按屏幕真实像素比渲染（之前大画布限 1× 会被浏览器拉伸发虚，用户反馈锐度不够）。
  DPR = state.perfMode ? 1 : Math.min(window.devicePixelRatio || 1, 2)
  // 画布像素与屏幕物理像素 1:1 对齐：按 CSS 实际（小数）尺寸 × DPR 取整，并把画布 CSS 尺寸锁成该值，
  // 避免 0.x px 的差异让浏览器整幅重采样（整体发虚的常见原因）。
  dom.canvas.width = Math.round(W * DPR)
  dom.canvas.height = Math.round(H * DPR)
  dom.canvas.style.width = `${dom.canvas.width / DPR}px`
  dom.canvas.style.height = `${dom.canvas.height / DPR}px`
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
  state.forceDraw = true
  // 遥测台尺寸随布局变化：在这里量一次并缓存，绘制循环里绝不读布局（避免每帧强制重排）。
  deckHCache = dom.deckEl && dom.deckEl.clientHeight > 0 ? dom.deckEl.clientHeight : 0
  for (const d of Object.values(deck)) measureDeck(d)
}
let deckHCache = 0
function measureDeck(d) {
  if (!d || !d.canvas) return
  d.cw = Math.max(40, Math.round(d.canvas.clientWidth))
  d.chh = Math.max(24, Math.round(d.canvas.clientHeight))
}
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => resizeCanvas())
  // 只观察遥测台容器：观察画布本身会因改 width/height 属性触发回环。
  if (dom.deckEl) ro.observe(dom.deckEl)
}

function layoutView() {
  // 遥测台是否显示由 CSS 决定，用实际高度判断，不能只看画布宽度。
  const deckH = deckHCache
  const usableH = Math.max(220, H - deckH)
  const canBig = W >= 760 && deckH > 0
  // 用户选“大图模式”时强制生效，不再被 W>=760 的自动门槛挡住（左右分屏常把画布挤到 760 以下）。
  const wantBig = state.layoutMode === 'big' ? true : state.layoutMode === 'small' ? false : canBig
  // 巨环构图（参考 haloflux 电脑版）：环比画面还高，圆心在画面左外，只露一段竖弧；
  // 弧内（左）是织网，弧外（右）是光柱通道。窄屏仍用居中小环。
  if (wantBig) {
    // 顶部 62px 留给指标栏（独立一条，不与环/光柱重叠）。
    const TOP = 62
    const Hs = usableH - TOP
    const R = Hs * 1.22
    const ringX = W * 0.40
    const cy = TOP + Hs * 0.5
    const cx = ringX - R
    const g = tapeGeomBig(R, Hs)
    // 织网（神经网）放在弧内可见区域的中心，而不是画面外的真圆心。
    const innerRight = cx + g.rIn - 26
    const orbR = clamp(Math.min(innerRight * 0.46, usableH * 0.44), 60, 520)
    const orb = { cx: Math.max(orbR * 0.9, innerRight - orbR * 1.05), cy, R: orbR / 0.81 }
    orb.web = { x0: 24, x1: Math.max(200, innerRight - 30), y0: TOP + 24, y1: usableH - 24, ringCx: cx, ringCy: cy, clipR: g.rIn - 26 }
    // 所有网络流线（buildNetPath）都指向这个可视核心点，避免汇合点落在画面左外。
    const coreX = Math.max(18, Math.min(48, W * 0.035))
    orb.core = [coreX, cy]
    return { cx, cy, R, deckH, specH: 0, big: true, core: [coreX, cy], usableH: Hs, top: TOP, orb, rayMax: Math.max(80, W - (cx + R) - 24) }
  }
  const R0 = clamp(Math.min(W * 0.355, usableH * 0.395), 64, 348)
  // 频谱柱预留：环下方依次是 刻度带/停滞文字（到 R+58）→ 柱高 specH → 标注行（约 22）。
  // 环上方留 50。空间不够时先让 R 让出最多 14%，再不够就把柱子压到 20，最后才不画。
  const specOn = W >= 620
  const specH = specOn ? clamp(R0 * 0.16, 28, 56) : 0
  const fitR = (h) => (usableH - 50 - 58 - 22 - h) / 2
  let R = R0
  let specRoom = specH
  if (specOn && fitR(specH) < R0) {
    if (fitR(specH) >= R0 * 0.86) R = fitR(specH)
    else {
      R = Math.max(R0 * 0.86, fitR(20))
      R = Math.min(R, R0)
      specRoom = Math.max(0, usableH - 50 - 58 - 22 - 2 * R)
    }
  }
  R = clamp(R, 64, 348)
  const cy = clamp(usableH * 0.465, R + 50, usableH - R - 58 - 22 - specRoom)
  const v = { cx: W / 2, cy, R, deckH, specH: specRoom, big: false, usableH }
  v.orb = v
  v.rayMax = R * 0.54
  return v
}

