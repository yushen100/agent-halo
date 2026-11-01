'use strict'
// agent-halo · list-data.js — 虚拟事件列表、数据加载、演练
// 由原 halo.js 第 1160–1727 行拆出。所有 js/*.js 为按顺序加载的经典脚本，共享全局作用域；
// 新增代码放进对应文件，不要再建一个新的大文件。

/* ── 事件列表：虚拟滚动 ─────────────────────────────────────────
   滚动条按全部事件的总高度计算（可滚到最前/最后），但只为可视区 ±12 行创建 DOM，
   滚动时复用这些行。点击/回车用事件委托；高亮与自动跟随照旧。 */
const ROW_H = 19
const vlist = { spacer: null, rows: [], first: -1, last: -1, raf: 0 }
function requestIdleCallbackSafe(fn) { (window.requestIdleCallback || ((f) => setTimeout(f, 16)))(fn, { timeout: 120 }) }
function bindListDelegation() {
  if (!dom.eventList || dom.eventList.dataset.deleg) return
  dom.eventList.dataset.deleg = '1'
  dom.eventList.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-index]')
    if (li) selectAndSeek(+li.dataset.index)
  })
  dom.eventList.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    const li = ev.target.closest('li[data-index]')
    if (li) { ev.preventDefault(); selectAndSeek(+li.dataset.index) }
  })
  // 用户手动滚动（滚轮/拖滚动条/触摸）后 4 秒内不自动跟随，方便往前翻看
  for (const ev of ['wheel', 'pointerdown', 'touchstart']) dom.eventList.addEventListener(ev, () => { vlist.userUntil = performance.now() + 4000 }, { passive: true })
  dom.eventList.addEventListener('scroll', () => {
    if (vlist.raf) return
    vlist.raf = requestAnimationFrame(() => { vlist.raf = 0; drawVisibleRows() })
  }, { passive: true })
}
function renderEventList() {
  const ol = dom.eventList
  ol.textContent = ''
  bindListDelegation()
  vlist.spacer = document.createElement('div')
  vlist.spacer.className = 'vlist-spacer'
  vlist.spacer.style.height = `${state.events.length * ROW_H}px`
  ol.appendChild(vlist.spacer)
  vlist.rows = []
  vlist.first = -1
  vlist.last = -1
  state.listEls = []
  state.listIndex = -1
  drawVisibleRows()
}
function fillRow(li, i) {
  const e = state.events[i]
  li.dataset.index = String(i)
  li.style.transform = `translateY(${i * ROW_H}px)`
  li.className = ''
  if (isAnomaly(e)) li.classList.add('anomaly')
  if (e.kind === 'approval.request') li.classList.add('approval')
  if (i === state.pointer) li.classList.add('current')
  if (i === state.selected) li.classList.add('selected')
  const [t, k, tool, label] = li.children
  t.textContent = fmtClock(e.ts)
  k.textContent = kindShort(e.kind)
  tool.textContent = e.tool || ''
  label.textContent = e.label || kindLabel(e.kind)
}
function drawVisibleRows() {
  const ol = dom.eventList
  if (!ol || !vlist.spacer) return
  const n = state.events.length
  const top = ol.scrollTop
  const hgt = ol.clientHeight || 400
  const first = Math.max(0, Math.floor(top / ROW_H) - 12)
  const last = Math.min(n - 1, Math.ceil((top + hgt) / ROW_H) + 12)
  const need = Math.max(0, last - first + 1)
  while (vlist.rows.length < need) {
    const li = document.createElement('li')
    li.tabIndex = 0
    for (const c of ['ev-time', 'ev-kind', 'ev-tool', 'ev-label']) {
      const sp = document.createElement('span')
      sp.className = c
      li.appendChild(sp)
    }
    ol.appendChild(li)
    vlist.rows.push(li)
  }
  vlist.rows.forEach((li, r) => {
    if (r < need) { li.hidden = false; fillRow(li, first + r) } else li.hidden = true
  })
  vlist.first = first
  vlist.last = last
}
function scrollListTo(i) {
  const ol = dom.eventList
  if (!ol) return
  const y = i * ROW_H
  const h = ol.clientHeight || 400
  if (y < ol.scrollTop) ol.scrollTop = y
  else if (y + ROW_H > ol.scrollTop + h) ol.scrollTop = y + ROW_H - h
  drawVisibleRows()
}

function syncListHighlight() {
  state.listIndex = state.pointer
  const now = performance.now()
  if (now - state.lastScroll > 220 && now > (vlist.userUntil || 0)) {
    scrollListTo(state.pointer)
    state.lastScroll = now
  } else drawVisibleRows()
}

function syncSelectedClass() { drawVisibleRows() }

function selectEvent(i) {
  state.forceDraw = true
  const e = state.events[i]
  if (!e) return
  state.selected = i
  dom.detailEmpty.hidden = true
  dom.detailBody.hidden = false
  buildBrain()
  const key = 'n' + i
  const links = brain.edges.filter((edge) => edge.a === key || edge.b === key)
  dom.dLinks.textContent = links.length ? links.map((edge) => {
    const other = brain.byKey.get(edge.a === key ? edge.b : edge.a)
    return `${edge.a === key ? '→' : '←'} ${kindLabel(other?.kind)}${other?.e.tool ? ' · ' + other.e.tool : ''}（${BRAIN_RELATION[edge.type] || edge.type}）`
  }).join('；') : '当前窗口无关联事件'
  dom.dKind.textContent = `${kindLabel(e.kind)}（${e.kind || '未知'}）`
  dom.dTime.textContent = `${fmtDateTime(e.ts)} · ${e.ts}`
  dom.dTool.textContent = e.tool || '—'
  dom.dLabel.textContent = e.label || '—'
  dom.dDuration.textContent = e.duration_ms != null ? fmtDuration(e.duration_ms) : '—'
  dom.dRef.textContent = refText(e)
  dom.dRef.title = refText(e)
  const hasNet = !!(e.net && typeof e.net === 'object')
  dom.dNetDt.hidden = !hasNet
  dom.dNet.hidden = !hasNet
  dom.dNet.textContent = hasNet ? netText(e.net) : ''
  dom.copyRef.hidden = !e.ref
  syncSelectedClass()
}

function clearDetails() {
  dom.detailEmpty.hidden = false
  dom.detailBody.hidden = true
  dom.copyRef.hidden = true
  dom.dNetDt.hidden = true
  dom.dNet.hidden = true
  dom.dKind.textContent = ''
  dom.dTime.textContent = ''
  dom.dTool.textContent = ''
  dom.dLabel.textContent = ''
  dom.dDuration.textContent = ''
  dom.dRef.textContent = ''
  dom.dRef.title = ''
  dom.dNet.textContent = ''
}

function selectAndSeek(i) {
  if (!state.events.length) return
  state.playing = false
  syncPlayBtn()
  seekToEvent(i)
  selectEvent(i)
  scrollListTo(i)
}

async function copyRefPath() {
  const e = state.events[state.selected]
  if (!e) return
  const text = refText(e)
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制来源路径')
  } catch {
    // 非安全上下文时退回 textarea 方案。
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      showToast('已复制来源路径')
    } catch {
      showToast('复制失败，请手动选择来源路径')
    }
    ta.remove()
  }
}

function showToast(msg, kind = 'info') {
  dom.toast.textContent = msg
  dom.toast.hidden = false
  dom.toast.classList.toggle('error', kind === 'error')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => {
    dom.toast.hidden = true
    dom.toast.classList.remove('error')
  }, kind === 'error' ? 4200 : 2600)
}

function showErrorAlert(msg) {
  if (!dom.nowError || !dom.nowErrorText) return
  state.errorStatusVisible = true
  dom.nowErrorTag.textContent = L().errorTag
  dom.nowErrorText.textContent = msg
  dom.nowError.hidden = false
}

function hideErrorAlert() {
  state.errorStatusVisible = false
  clearTimeout(state.errorAlertTimer)
  if (dom.nowError) dom.nowError.hidden = true
}

function setupMusic() {
  const audio = dom.bgMusic
  if (!audio) return
  const key = 'halo-music-volume'
  let vol = 0.3
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const saved = Number(raw)
      if (Number.isFinite(saved)) vol = clamp(saved, 0, 1)
    }
  } catch {}
  audio.volume = vol
  if (dom.musicVolume) dom.musicVolume.value = String(Math.round(vol * 100))
  const sync = () => {
    if (dom.musicBtn) {
      dom.musicBtn.textContent = audio.paused ? L().musicPlay : L().musicPause
      dom.musicBtn.setAttribute('aria-pressed', String(!audio.paused))
    }
  }
  const syncVolume = () => {
    const v = Math.round(audio.volume * 100)
    if (dom.musicVolume || document.getElementById('musicVolume')) (dom.musicVolume || document.getElementById('musicVolume')).style.setProperty('--pct', v + '%')
    if (dom.musicVolText) dom.musicVolText.textContent = `${v}%`
    if (dom.musicVolume) dom.musicVolume.value = String(v)
  }
  sync()
  syncVolume()
  audio.addEventListener('play', sync)
  audio.addEventListener('pause', sync)
  audio.addEventListener('volumechange', syncVolume)
  audio.addEventListener('error', () => showToast(L().musicUnavailable))
  if (dom.musicBtn) {
    dom.musicBtn.addEventListener('click', async () => {
      if (audio.paused) {
        try { await audio.play() } catch { showToast(L().musicUnavailable) }
      } else {
        audio.pause()
      }
    })
  }
  if (dom.musicVolume) {
    dom.musicVolume.addEventListener('input', () => {
      const v = clamp(Number(dom.musicVolume.value) / 100, 0, 1)
      audio.volume = v
      try { localStorage.setItem(key, String(v)) } catch {}
    })
  }
  setTimeout(() => { if (audio.paused) audio.play().catch(() => {}) }, 600)
}

/* ── 数据加载 ───────────────────────────────────────────────── */
async function refreshList() {
  try {
    const res = await fetch('/api/list', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const list = await res.json()
    dom.sessionSelect.textContent = ''
    const liveOption = document.createElement('option')
    liveOption.value = '__dsh_live__'
    liveOption.textContent = L().liveOption
    dom.sessionSelect.appendChild(liveOption)
    if (!Array.isArray(list) || !list.length) {
      const opt = document.createElement('option')
      opt.textContent = '（data 目录没有 .jsonl）'
      opt.disabled = true
      dom.sessionSelect.appendChild(opt)
      dom.sessionSelect.value = '__dsh_live__'
      liveDefaultApplied = true
      startLive()
      return
    }
    const prev = state.file
    for (const item of list) {
      const opt = document.createElement('option')
      opt.value = item.name
      const sid = item.session_id || (/^dsh-session-(.+)\.jsonl$/.exec(item.name) || [])[1] || ''
      const sidLabel = sid ? sid.replace(/^session-/, '').slice(0, 8) : ''
      opt.textContent = sidLabel
        ? `${L().sessionReplay} ${sidLabel} · ${fmtBytes(item.size)} · ${fmtClock(item.mtime)}`
        : `${item.name} · ${fmtBytes(item.size)} · ${fmtClock(item.mtime)}`
      opt.title = item.name
      dom.sessionSelect.appendChild(opt)
    }
    const wantInitialLive = INITIAL_LIVE && !liveDefaultApplied && !prev
    const wantLive = prev === '__dsh_live__' || wantInitialLive
    liveDefaultApplied = true
    const pick = wantLive ? '__dsh_live__' : (list.some((x) => x.name === prev) ? prev : list[0].name)
    dom.sessionSelect.value = pick
    if (pick === '__dsh_live__') startLive()
    else await loadFile(pick)
  } catch (err) {
    showToast(`读取回放列表失败：${err && err.message ? err.message : err}`)
  }
}

function stopLive() {
  if (state.liveSource) state.liveSource.close()
  state.liveSource = null
  state.live = false
  dom.speedSelect.disabled = false
  dom.modeText.textContent = LANG === 'en' ? 'REPLAY' : '回放'
}

function liveStatusText(data, events) {
  const t = L()
  if (data.mode === 'push') return events.length ? t.livePush : t.liveWaiting
  if (data.status === 'missing') return t.liveMissing
  if (data.status === 'error') return t.liveError
  if (data.status === 'partial') return t.livePartial
  return events.length ? t.liveWaiting : t.liveEmpty
}

function startLive() {
  ++loadSeq
  stopLive()
  stopRehearsal(true)
  state.live = true
  state.file = '__dsh_live__'
  state.events = []
  state.pointer = -1
  state.selected = -1
  state.playing = true
  state.error = ''
  state.curTs = 0
  state.pt = 0
  state.tokenRate = 0
  state.tokenRateShown = 0
  buildTimeline()
  resetAmbient()
  clearTransient()
  renderEventList()
  clearDetails()
  dom.modeText.textContent = L().liveConnecting
  dom.speedSelect.disabled = true
  dom.playBtn.disabled = false
  syncPlayBtn()
  const source = new EventSource('/api/live')
  state.liveSource = source
  source.addEventListener('snapshot', (event) => {
    if (source !== state.liveSource) return
    let data
    try { data = JSON.parse(event.data) } catch { return }
    const events = Array.isArray(data.events) ? data.events : []
    const previous = state.events
    const samePrefix = previous.length <= events.length && previous.every((e, i) => JSON.stringify(e) === JSON.stringify(events[i]))
    if (!samePrefix) {
      state.events = events
      buildTimeline()
      renderEventList()
      if (events.length) seekToEvent(events.length - 1)
      else { state.pointer = -1; state.curTs = 0; resetAmbient(); updatePanel(); syncSlider() }
      state.selected = -1
      clearDetails()
    } else if (events.length > previous.length) {
      state.events = events
      buildTimeline()
      renderEventList()
      if (state.playing) {
        state.pt = state.total
        advanceTo(state.animNow)
        updatePanel()
        syncSlider()
      }
    }
    dom.modeText.textContent = liveStatusText(data, events)
  })
  source.onerror = () => { if (source === state.liveSource) dom.modeText.textContent = L().liveDisconnected }
}

async function loadFile(name) {
  stopLive()
  const token = (loadSeq += 1)
  stopRehearsal(true)
  state.loading = true
  state.error = ''
  dom.playBtn.disabled = true
  try {
    const res = await fetch(`/api/events?file=${encodeURIComponent(name)}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (token !== loadSeq) return
    const evs = await parseJsonlAsync(text)
    if (token !== loadSeq) return
    if (!evs.length) throw new Error('这个文件里没有有效事件')

    state.file = name
    replaySync.mtime = 0
    state.events = evs
    state.playing = false
    state.selected = -1
    state.pt = 0
    state.pointer = -1
    state.curTs = evs[0].ts
    state.tokenRate = 0
    state.tokenRateShown = 0
    buildTimeline()
    resetAmbient()
    state.phase = 'idle'
    state.phaseStartTs = evs[0].ts
    clearTransient()
    fx.echoes = []
    fx.sweeps = []
    fx.approvals = []
    // 首帧前让浏览器先画出界面，再建列表（避免刷新时白屏卡顿）
    requestIdleCallbackSafe(() => { if (token === loadSeq) renderEventList() })
    clearDetails()
    seekToEvent(0)
    if (window.__haloApi) for (const f of window.__haloApi.hooks.onLoad) { try { f() } catch {} }
    dom.canvas.style.opacity = '0'
    requestAnimationFrame(() => { dom.canvas.style.transition = 'opacity .5s ease'; dom.canvas.style.opacity = '1' })
    state.playing = true
    syncPlayBtn()
    dom.playBtn.disabled = false
    updatePanel()
    syncSlider()
  } catch (err) {
    if (token !== loadSeq) return
    state.error = err && err.message ? err.message : String(err)
    state.events = []
    state.pts = []
    state.gaps = []
    state.total = 1
    state.pointer = -1
    state.playing = false
    resetAmbient()
    renderEventList()
    clearDetails()
    syncPlayBtn()
    updatePanel()
    syncSlider()
    dom.playBtn.disabled = true
    showToast(`载入失败：${state.error}`)
  } finally {
    if (token === loadSeq) {
      state.loading = false
      dom.sessionSelect.disabled = false
    }
  }
}

/* ── 演练：合成脉冲，不写入时间轴/真实数据 ──────────────────── */
const REHEARSAL_STEPS = [
  {
    angle: -2.25, caption: '搜索 · 雷达弧（unknown，点线淡显）',
    net: { kind: 'search', direction: 'in', route: 'unknown', host: 'search.example', method: null, bytes: null },
  },
  {
    angle: -1.25, caption: '下载 · 直连 · 向内粒子（青蓝，实线）',
    net: { kind: 'download', direction: 'in', route: 'direct', host: 'cdn.example.com:443', method: 'GET', bytes: null },
  },
  {
    angle: -0.45, caption: '下载 · 代理 · 虚线折线，节点标 PROXY',
    net: { kind: 'download', direction: 'in', route: 'proxy', host: 'api.example.com:443', proxy: '127.0.0.1:7897', method: 'GET', bytes: null },
  },
  {
    angle: 0.35, caption: '上传 · 代理 · 向外粒子（琥珀）',
    net: { kind: 'upload', direction: 'out', route: 'proxy', host: 'upload.example.com:443', proxy: '127.0.0.1:7897', method: 'PUT', bytes: null },
  },
  {
    angle: 1.1, caption: '取回 · 网关 · 终止于菱形节点，标 GW',
    net: { kind: 'fetch', direction: 'in', route: 'gateway', host: '127.0.0.1:3425', method: 'GET', bytes: null },
  },
  {
    angle: 1.9, caption: '双向传输 · 直连 · 两条流错开半拍',
    net: { kind: 'transfer', direction: 'both', route: 'direct', host: 'sync.example.com:443', method: null, bytes: null },
  },
  {
    angle: 2.55, caption: '未知路由 · 点线淡显，不标直连/代理',
    net: { kind: 'fetch', direction: 'in', route: 'unknown', host: 'unknown.example', method: 'GET', bytes: null },
  },
  {
    angle: 3.05, caption: '要人确认 · 红色只在这里出现',
    approval: true,
  },
  {
    angle: 2.95, caption: '失败 · 流中断 + 环上缺口（不用红色）', failed: true,
    net: { kind: 'download', direction: 'in', route: 'direct', host: 'broken.example.com', method: 'GET', bytes: null },
  },
]

function startRehearsal() {
  stopRehearsal(true)
  state.rehearsal.active = true
  state.rehearsal.caption = '准备…'
  fx.demoCaption = '准备…'
  dom.rehearsalBadge.hidden = false
  dom.rehearsalBtn.textContent = '停止演练'
  dom.rehearsalBtn.classList.add('active')
  showToast('演练中：合成脉冲，不写入时间轴和真实数据')

  const t0 = performance.now()
  const baseDelay = 260
  const gap = 1500
  REHEARSAL_STEPS.forEach((step, i) => {
    const id = setTimeout(() => runDemoStep(step, t0), baseDelay + i * gap)
    state.rehearsal.timers.push(id)
  })
  const endId = setTimeout(() => stopRehearsal(true), baseDelay + REHEARSAL_STEPS.length * gap + 2200)
  state.rehearsal.timers.push(endId)
}

function runDemoStep(step, t0) {
  if (!state.rehearsal.active) return
  const now = performance.now()
  demoSeq += 1
  fx.demoCaption = step.caption
  state.rehearsal.caption = step.caption

  if (step.approval) {
    fx.demoApprovals.push({ start: now, dur: 7600 })
    fx.pulses.push({
      type: 'tool', angle: (SEG.waiting_user.start + SEG.waiting_user.end) / 2,
      start: now, dur: 1100, rgb: APPROVAL_RGB, glyph: 'subtask',
      eventIndex: -1, demo: true,
    })
    return
  }

  const net = step.net
  const kind = netKind(net.kind)
  const angle = step.angle
  pushNet({
    id: `演练-${demoSeq}`,
    eventIndex: -1,
    angle,
    kind,
    net,
    start: now,
    dur: NET_DUR[kind] || 1800,
    failed: !!step.failed,
    demo: true,
  })
  let rgb = IN_RGB
  if (kind === 'upload') rgb = OUT_RGB
  else if (kind === 'search') rgb = SEARCH_RGB
  fx.pulses.push({
    type: 'tool', angle, start: now, dur: 950, rgb,
    glyph: kind === 'search' ? 'search' : 'network', eventIndex: -1, demo: true,
  })
  if (step.failed) {
    fx.demoNotches.push({ angle, start: now, dur: 9000, width: 0.09 })
    fx.demoScars.push({ angle, start: now, dur: 14000 })
  }
}

function stopRehearsal(clear) {
  for (const id of state.rehearsal.timers) clearTimeout(id)
  state.rehearsal.timers = []
  state.rehearsal.active = false
  if (clear) {
    fx.demoNets = []
    fx.demoNotches = []
    fx.demoScars = []
    fx.demoApprovals = []
    fx.demoCaption = ''
    fx.pulses = fx.pulses.filter((p) => !p.demo)
  }
  dom.rehearsalBadge.hidden = true
  dom.rehearsalBtn.textContent = '演练'
  dom.rehearsalBtn.classList.remove('active')
}


/* ── 回放自动同步：当前打开的回放文件被服务端更新（源会话又接着做了）时，后台重新载入，
   保留当前位置；如果原来已经播到末尾，就继续往下播新事件。每 5 秒查一次 /api/list。 ── */
const replaySync = { mtime: 0, size: 0, busy: false }
async function checkReplayUpdate() {
  if (replaySync.busy || state.live || !state.file || !state.events.length) return
  try {
    const list = await (await fetch('/api/list', { cache: 'no-store' })).json()
    const item = Array.isArray(list) && list.find((x) => x.name === state.file)
    if (!item) return
    if (!replaySync.mtime) { replaySync.mtime = item.mtime; replaySync.size = item.size; return }
    if (item.mtime === replaySync.mtime && item.size === replaySync.size) return
    replaySync.busy = true
    const file = state.file
    const text = await (await fetch(`/api/events?file=${encodeURIComponent(file)}`, { cache: 'no-store' })).text()
    const evs = await parseJsonlAsync(text)
    if (file !== state.file || evs.length < 1) return
    const atEnd = state.pt >= state.total - 0.01
    const wasPlaying = state.playing
    const curId = state.events[state.pointer] && state.events[state.pointer].event_id
    const selId = state.events[state.selected] && state.events[state.selected].event_id
    const added = evs.length - state.events.length
    state.events = evs
    buildTimeline()
    let idx = curId ? evs.findIndex((e) => e.event_id === curId) : -1
    if (idx < 0) idx = Math.min(state.pointer, evs.length - 1)
    state.selected = selId ? evs.findIndex((e) => e.event_id === selId) : -1
    seekToEvent(idx)
    renderEventList()
    if (atEnd && added > 0) { state.playing = true; syncPlayBtn() } else { state.playing = wasPlaying; syncPlayBtn() }
    replaySync.mtime = item.mtime
    replaySync.size = item.size
    if (added > 0) showToast(LANG === 'en' ? `Replay updated: +${added} events` : `回放已同步：新增 ${added} 个事件`)
  } catch { /* 网络抖动忽略，下次再查 */ } finally { replaySync.busy = false }
}
setInterval(checkReplayUpdate, 5000)
