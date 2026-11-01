// agent-halo 扩展：悬停提示 / 时间轴标注 / [ ] 跳轮次。只读 window.__haloApi，不改 halo.js。
const api = window.__haloApi
if (api) init()

function init() {
  const { state } = api
  const canvas = document.getElementById('halo')
  const timeline = document.getElementById('timeline')
  const T = {
    zh: { time: '时间', dur: '耗时', label: '说明', event: '事件' },
    en: { time: 'Time', dur: 'Duration', label: 'Label', event: 'Event' },
  }
  const tr = () => T[api.lang === 'en' ? 'en' : 'zh']

  // ── 样式
  const st = document.createElement('style')
  st.textContent = `
.halo-tip{position:fixed;z-index:80;pointer-events:none;background:#000;color:#fff;border:1px solid rgba(255,255,255,.55);
  padding:6px 8px;font:10px/1.5 "Cascadia Mono",Consolas,monospace;max-width:320px;opacity:0;transition:opacity .15s ease;white-space:normal}
.halo-tip.on{opacity:1}
.halo-tip b{font-weight:700;font-size:11px}
.halo-tip .k{color:rgba(255,255,255,.6);margin-right:6px}
.halo-tl-marks{position:absolute;pointer-events:none;z-index:2}`
  document.head.appendChild(st)

  // ── 1. 悬停提示
  const tip = document.createElement('div')
  tip.className = 'halo-tip'
  document.body.appendChild(tip)
  let mx = 0, my = 0, pending = false, lastIdx = null
  const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  function update() {
    pending = false
    const r = canvas.getBoundingClientRect()
    let i = null
    try { i = api.hitTest(mx - r.left, my - r.top) } catch { i = null }
    if (i == null || !state.events[i]) { tip.classList.remove('on'); lastIdx = null; return }
    if (i !== lastIdx) {
      const e = state.events[i]
      const t = tr()
      const head = e.tool || api.kindLabel(e.kind) || t.event
      const rows = [[t.time, api.fmtClock(e.ts)]]
      if (e.duration_ms != null) rows.push([t.dur, api.fmtDuration(e.duration_ms)])
      if (e.label) rows.push([t.label, trunc(e.label, 60)])
      tip.innerHTML = `<b>${esc(trunc(head, 40))}</b>` + rows.map(([k, v]) => `<div><span class="k">${esc(k)}</span>${esc(v)}</div>`).join('')
      lastIdx = i
    }
    const w = tip.offsetWidth, h = tip.offsetHeight
    let x = mx + 14, y = my + 14
    if (x + w > innerWidth - 8) x = mx - w - 14
    if (y + h > innerHeight - 8) y = my - h - 14
    tip.style.left = `${x}px`
    tip.style.top = `${y}px`
    tip.classList.add('on')
  }
  canvas.addEventListener('mousemove', (ev) => {
    mx = ev.clientX; my = ev.clientY
    if (!pending) { pending = true; requestAnimationFrame(update) }
  })
  canvas.addEventListener('mouseleave', () => { tip.classList.remove('on'); lastIdx = null })

  // ── 2. 时间轴标注
  const marks = document.createElement('canvas')
  marks.className = 'halo-tl-marks'
  const host = timeline.parentElement
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  host.appendChild(marks)
  const zr = () => (typeof api.zoomRange === 'function' ? api.zoomRange() : [0, 1])
  function drawMarks() {
    if (!timeline.offsetWidth) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const [lo, hi] = zr()
    const zoomed = lo > 1e-4 || hi < 1 - 1e-4
    // 缩放时上方多出 4px 放窗口位置细条，两端放起止时刻（需要更高的层）
    const w = timeline.offsetWidth, h = zoomed ? 20 : 8
    marks.style.left = `${timeline.offsetLeft}px`
    marks.style.top = `${timeline.offsetTop - h + 3}px`
    marks.style.width = `${w}px`
    marks.style.height = `${h}px`
    marks.width = Math.round(w * dpr)
    marks.height = Math.round(h * dpr)
    const c = marks.getContext('2d')
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, w, h)
    const evs = state.events, pts = state.pts, total = state.total || 1
    if (!evs.length || !pts || !pts.length) return
    const pad = 3.5 // 与滑块拇指半宽对齐
    const span = Math.max(1e-6, hi - lo)
    const fOf = (i) => (pts[i] / total - lo) / span
    const xOf = (f) => pad + f * (w - pad * 2)
    const mh = 8 // 标记区高度（在层底部）
    const my = h - mh
    c.fillStyle = 'rgba(255,255,255,0.85)'
    for (let i = 0; i < evs.length; i += 1) {
      if (evs[i].kind !== 'user.message') continue
      const f = fOf(i)
      if (f < 0 || f > 1) continue
      c.fillRect(Math.round(xOf(f)), my, 1, mh)
    }
    c.fillStyle = 'rgba(232,196,128,1)'
    for (let i = 0; i < evs.length; i += 1) {
      if (!api.isAnomaly(evs[i])) continue
      const f = fOf(i)
      if (f < 0 || f > 1) continue
      c.beginPath(); c.arc(xOf(f), h - 2, 1.6, 0, Math.PI * 2); c.fill()
    }
    if (!zoomed) return
    // 窗口位置细条：全程背景 #333，窗口段白色
    c.fillStyle = '#333'
    c.fillRect(pad, 0, w - pad * 2, 2)
    c.fillStyle = '#fff'
    c.fillRect(pad + lo * (w - pad * 2), 0, Math.max(2, span * (w - pad * 2)), 2)
    // 起止时刻：取 pts/total 最接近该比例的事件
    const tsAt = (frac) => {
      const target = frac * total
      let a = 0, b = pts.length - 1
      while (a < b) { const m = (a + b) >> 1; if (pts[m] < target) a = m + 1; else b = m }
      if (a > 0 && Math.abs(pts[a - 1] - target) < Math.abs(pts[a] - target)) a -= 1
      return evs[a] ? evs[a].ts : null
    }
    c.font = `8px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`
    c.textBaseline = 'top'
    c.fillStyle = '#fff'
    const t0 = tsAt(lo), t1 = tsAt(hi)
    c.textAlign = 'left'
    if (t0 != null) c.fillText(api.fmtClock(t0), pad, 3)
    c.textAlign = 'right'
    if (t1 != null) c.fillText(api.fmtClock(t1), w - pad, 3)
    c.textAlign = 'center'
    c.fillStyle = 'rgba(255,255,255,0.55)'
    c.fillText(api.lang === 'en' ? 'DBL-CLICK TO RESET' : '双击复位', w / 2, 3)
  }
  let sig = ''
  api.hooks.onLoad.push(() => { sig = ''; requestAnimationFrame(drawMarks) })
  // 空白压缩切换会重建 pts、缩放会改窗口：按 (事件数, total, 宽度, 缩放窗口, 语言) 签名检测并重画
  api.hooks.afterDraw.push(() => {
    const [lo, hi] = zr()
    const s = `${state.events.length}|${state.total}|${timeline.offsetWidth}|${lo.toFixed(5)}|${hi.toFixed(5)}|${api.lang}`
    if (s !== sig) { sig = s; drawMarks() }
  })
  addEventListener('resize', () => { sig = '' })

  // ── 3. [ ] 跳轮次
  addEventListener('keydown', (ev) => {
    if (ev.key !== '[' && ev.key !== ']') return
    const tag = document.activeElement && document.activeElement.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const evs = state.events
    if (!evs.length) return
    const cur = Math.max(0, state.pointer)
    let i = -1
    if (ev.key === ']') { for (let k = cur + 1; k < evs.length; k += 1) if (evs[k].kind === 'user.message') { i = k; break } }
    else { for (let k = cur - 1; k >= 0; k -= 1) if (evs[k].kind === 'user.message') { i = k; break } }
    if (i >= 0) { ev.preventDefault(); api.selectAndSeek(i) }
  })
}
