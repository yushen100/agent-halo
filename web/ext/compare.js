// agent-halo 扩展：多会话对比（只通过 window.__haloApi 与 /api/list、/api/events 访问）
const TXT = {
  zh: { btn: '对比', title: '会话对比', pick: '选择对比的回放…', cur: '当前', other: '对比', loading: '载入中…', none: '没有其他回放文件',
    rows: ['事件数', '工具调用', '模型步数', '输出 Token', '失败', '总时长', '工具平均耗时', '常用工具', '最大上下文'], density: '事件密度' },
  en: { btn: 'COMPARE', title: 'SESSION COMPARE', pick: 'Pick a replay to compare…', cur: 'CURRENT', other: 'OTHER', loading: 'Loading…', none: 'No other replay files',
    rows: ['EVENTS', 'TOOL CALLS', 'MODEL STEPS', 'TOKENS OUT', 'FAILS', 'DURATION', 'AVG TOOL TIME', 'TOP TOOLS', 'MAX CONTEXT'], density: 'EVENT DENSITY' },
}
const MONO = 'Consolas, "Cascadia Mono", monospace'
const C = { model: '242,198,110', tool: '96,226,176', fail: '140,146,152', user: '255,255,255' }

function parse(text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try { const e = JSON.parse(t); if (e && Number.isFinite(Number(e.ts))) out.push(e) } catch {}
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}
function isFail(api, e) { try { return api.isFailureEvent(e) } catch { return e.status === 'error' || e.kind === 'error' } }
function stats(api, evs) {
  let tools = 0, models = 0, out = 0, fails = 0, durSum = 0, durN = 0, maxCtx = 0
  const byTool = new Map()
  for (const e of evs) {
    if (e.kind === 'tool.call') { tools += 1; const k = e.tool || '?'; byTool.set(k, (byTool.get(k) || 0) + 1) }
    else if (e.kind === 'model.end') { models += 1; out += Number(e.tokens && e.tokens.out) || 0 }
    else if (e.kind === 'tool.result' && Number(e.duration_ms) >= 0) { durSum += Number(e.duration_ms); durN += 1 }
    if (e.context && Number(e.context.ratio) > maxCtx) maxCtx = Number(e.context.ratio)
    if (isFail(api, e)) fails += 1
  }
  const top = [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const dur = evs.length ? evs[evs.length - 1].ts - evs[0].ts : 0
  return { n: evs.length, tools, models, out, fails, dur, avg: durN ? durSum / durN : 0, top, ctx: maxCtx }
}
function fmtDur(api, ms) { try { return api.fmtDuration(ms) } catch { return `${Math.round(ms / 1000)}s` } }
function colorOf(api, e) {
  if (isFail(api, e)) return C.fail
  if (e.kind === 'model.end') return C.model
  if (e.kind === 'tool.call' || e.kind === 'tool.result') return C.tool
  if (e.kind === 'user.message') return C.user
  return null
}

function init() {
  const api = window.__haloApi
  const bar = document.querySelector('footer.controls')
  const anchor = document.getElementById('pngBtn')
  if (!api || !bar || !anchor) { setTimeout(init, 120); return }
  if (document.getElementById('cmpBtn')) return
  const T = () => TXT[api.lang === 'en' ? 'en' : 'zh']

  const btn = document.createElement('button')
  btn.id = 'cmpBtn'; btn.type = 'button'; btn.className = 'ghost small'
  anchor.after(btn)

  const panel = document.createElement('div')
  panel.style.cssText = 'position:fixed;z-index:80;display:none;width:520px;max-width:calc(100vw - 32px);background:#000;border:1px solid #333;color:#fff;padding:10px 12px;font:11px/1.5 ' + MONO + ';box-shadow:0 8px 30px rgba(0,0,0,.6)'
  panel.innerHTML = `
    <div class="cmp-head" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
      <span class="cmp-title" style="font-size:9px;font-weight:700;letter-spacing:.16em"></span>
      <select class="cmp-pick" style="flex:1;max-width:300px;background:#000;color:#fff;border:1px solid #333;font:inherit;padding:2px 4px"></select>
    </div>
    <div class="cmp-msg" style="color:#c8c8c8;font-size:10px"></div>
    <table class="cmp-table" style="width:100%;border-collapse:collapse;font-size:11px"></table>
    <div class="cmp-dtitle" style="font-size:9px;font-weight:700;letter-spacing:.16em;margin:10px 0 4px"></div>
    <canvas class="cmp-den" style="display:block;width:100%;height:46px"></canvas>`
  document.body.appendChild(panel)
  const $ = (s) => panel.querySelector(s)
  const pick = $('.cmp-pick'), table = $('.cmp-table'), msg = $('.cmp-msg'), den = $('.cmp-den')

  let open = false, other = null, otherName = '', curStats = null, curKey = '', raf = 0

  function place() {
    const cv = api.canvas
    const r = cv ? cv.getBoundingClientRect() : { right: innerWidth, top: 0 }
    const w = Math.min(520, innerWidth - 32)
    panel.style.left = `${Math.max(16, r.right - w - 16)}px`
    panel.style.top = `${r.top + 74}px`
  }
  function curStatsFresh() {
    const key = `${api.state.file}|${api.state.events.length}`
    if (key !== curKey) { curKey = key; curStats = stats(api, api.state.events) }
    return curStats
  }
  async function loadList() {
    const t = T()
    pick.innerHTML = ''
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = t.pick; pick.appendChild(o0)
    try {
      const list = await (await fetch('/api/list', { cache: 'no-store' })).json()
      const names = (Array.isArray(list) ? list : []).map((x) => x.name).filter((n) => n && n !== api.state.file)
      if (!names.length) msg.textContent = t.none
      for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; pick.appendChild(o) }
      if (otherName && names.includes(otherName)) pick.value = otherName
    } catch { msg.textContent = t.none }
  }
  async function loadOther(name) {
    otherName = name; other = null
    if (!name) { renderTable(); return }
    msg.textContent = T().loading
    try {
      const text = await (await fetch(`/api/events?file=${encodeURIComponent(name)}`, { cache: 'no-store' })).text()
      if (otherName !== name) return
      const evs = parse(text)
      other = { evs, st: stats(api, evs) }
      msg.textContent = ''
    } catch (e) { msg.textContent = String(e && e.message || e) }
    renderTable()
  }
  function renderTable() {
    const t = T()
    $('.cmp-title').textContent = t.title
    $('.cmp-dtitle').textContent = t.density
    btn.textContent = t.btn
    const a = curStatsFresh(), b = other && other.st
    const num = (v) => (v == null ? '—' : String(v))
    const rows = [
      [a.n, b && b.n, num], [a.tools, b && b.tools, num], [a.models, b && b.models, num],
      [a.out, b && b.out, (v) => (v == null ? '—' : v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v))],
      [a.fails, b && b.fails, num], [a.dur, b && b.dur, (v) => (v == null ? '—' : fmtDur(api, v))],
      [a.avg, b && b.avg, (v) => (v == null ? '—' : fmtDur(api, v))],
      [a.top, b && b.top, (v) => (!v ? '—' : v.map(([k, n]) => `${String(k).replace(/^mcp__[^_]+__/, '')}×${n}`).join(' '))],
      [a.ctx, b && b.ctx, (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)],
    ]
    const th = 'text-align:left;font-size:9px;font-weight:700;letter-spacing:.12em;color:#c8c8c8;padding:3px 4px;border-bottom:1px solid #333'
    let html = `<tr><th style="${th}"></th><th style="${th}">${t.cur}</th><th style="${th}">${t.other}${otherName ? ' · ' + otherName.replace(/[<>&]/g, '') : ''}</th></tr>`
    rows.forEach(([x, y, f], i) => {
      let warn = false
      if (typeof x === 'number' && typeof y === 'number') {
        const m = Math.max(Math.abs(x), Math.abs(y))
        warn = m > 0 && Math.abs(x - y) / m > 0.3
      }
      const td = 'padding:3px 4px;border-bottom:1px solid #1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px'
      html += `<tr><td style="${td};color:#c8c8c8;font-size:10px">${t.rows[i]}</td><td style="${td};font-weight:700">${f(x)}</td><td style="${td};font-weight:700;color:${warn ? 'rgb(232,196,128)' : '#fff'}">${b ? f(y) : '—'}</td></tr>`
    })
    table.innerHTML = html
  }
  function drawDensity() {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const w = den.clientWidth || 496, h = den.clientHeight || 46
    if (den.width !== Math.round(w * dpr) || den.height !== Math.round(h * dpr)) { den.width = Math.round(w * dpr); den.height = Math.round(h * dpr) }
    const c = den.getContext('2d')
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, w, h)
    const N = 200, cw = w / N, bh = 16
    const strip = (evs, y) => {
      c.fillStyle = 'rgba(255,255,255,0.06)'
      c.fillRect(0, y, w, bh)
      if (!evs || evs.length < 2) return
      const t0 = evs[0].ts, span = Math.max(1, evs[evs.length - 1].ts - t0)
      const cells = new Array(N)
      for (const e of evs) {
        const col = colorOf(api, e); if (!col) continue
        const k = Math.min(N - 1, Math.floor(((e.ts - t0) / span) * N))
        const cur = cells[k]
        // 优先级：失败 > 用户 > 模型 > 工具
        const pr = (x) => (x === C.fail ? 4 : x === C.user ? 3 : x === C.model ? 2 : 1)
        if (!cur || pr(col) > pr(cur.c)) cells[k] = { c: col, n: (cur ? cur.n : 0) + 1 }
        else cur.n += 1
      }
      for (let k = 0; k < N; k += 1) {
        const v = cells[k]; if (!v) continue
        c.fillStyle = `rgba(${v.c},${Math.min(1, 0.35 + 0.15 * v.n)})`
        c.fillRect(k * cw + 0.5, y + 1, Math.max(1, cw - 1), bh - 2)
      }
      return { t0, span }
    }
    const cur = strip(api.state.events, 4)
    strip(other && other.evs, 4 + bh + 6)
    if (cur) {
      const x = ((api.state.curTs - cur.t0) / cur.span) * w
      c.fillStyle = '#fff'
      c.fillRect(Math.max(0, Math.min(w - 1.5, x)), 1, 1.5, bh + 6)
    }
  }
  function loop() {
    if (!open) { raf = 0; return }
    drawDensity()
    raf = requestAnimationFrame(loop)
  }
  function setOpen(v) {
    open = v
    panel.style.display = v ? 'block' : 'none'
    btn.setAttribute('aria-pressed', String(v))
    btn.style.boxShadow = v ? 'inset 0 -2px 0 #fff' : ''
    if (v) { place(); loadList(); renderTable(); if (!raf) raf = requestAnimationFrame(loop) }
  }

  btn.addEventListener('click', () => { setOpen(!open); btn.blur() })
  pick.addEventListener('change', () => { loadOther(pick.value); pick.blur() })
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && open) setOpen(false) })
  addEventListener('resize', () => { if (open) place() })
  const lb = document.getElementById('langBtn')
  if (lb) lb.addEventListener('click', () => setTimeout(() => { btn.textContent = T().btn; if (open) { renderTable(); loadList() } }, 0))
  btn.textContent = T().btn
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
