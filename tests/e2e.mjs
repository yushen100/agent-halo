// agent-halo 前端冒烟测试（可选依赖 playwright；未安装则跳过）
// 用法：先启动服务，再 node tests/e2e.mjs [--url http://127.0.0.1:5180/]
const argv = process.argv.slice(2)
const ui = argv.indexOf('--url')
const URL_ = ui >= 0 && argv[ui + 1] ? argv[ui + 1] : 'http://127.0.0.1:5180/'

let chromium
try { ({ chromium } = await import('playwright')) } catch {
  console.log('未安装 playwright，跳过')
  process.exit(0)
}

const results = []
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`) }
const skip = (name, why) => { results.push({ name, pass: true, skip: true }); console.log(`SKIP  ${name}  — ${why}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 820 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL_)
  await page.waitForFunction(() => window.__haloApi && window.__haloApi.state.events.length > 0, null, { timeout: 20000 }).catch(() => {})
  await sleep(1500)

  const n = await page.evaluate(() => (window.__haloApi ? window.__haloApi.state.events.length : 0))
  ok('载入事件', n > 0, `events=${n}`)

  // 虚拟列表
  const vl = await page.evaluate(() => {
    const ol = document.querySelector('#eventList')
    return { rows: ol.querySelectorAll('li:not([hidden])').length, sh: ol.scrollHeight }
  })
  ok('虚拟列表可见行 < 120', vl.rows > 0 && vl.rows < 120, `rows=${vl.rows}`)
  ok('列表总高度 ≈ 事件数×19', Math.abs(vl.sh - n * 19) <= 40, `scrollHeight=${vl.sh} 期望≈${n * 19}`)

  // 点击第一条可见行
  const firstIdx = await page.evaluate(() => {
    const li = [...document.querySelectorAll('#eventList li:not([hidden])')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .find((l) => { const r = l.getBoundingClientRect(); const p = l.parentElement.getBoundingClientRect(); return r.top >= p.top && r.bottom <= p.bottom })
    if (!li) return null
    li.click()
    return +li.dataset.index
  })
  await sleep(300)
  const sel = await page.evaluate(() => window.__haloApi.state.selected)
  ok('点击列表行选中该事件', firstIdx != null && sel === firstIdx, `row=${firstIdx} selected=${sel}`)

  // ] 跳到下一轮
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur())
  await page.keyboard.press(']')
  await sleep(300)
  const turn = await page.evaluate(() => { const s = window.__haloApi.state; const e = s.events[s.selected]; return { i: s.selected, kind: e && e.kind } })
  ok('] 跳到下一轮用户输入', turn.kind === 'user.message', `selected=${turn.i} kind=${turn.kind}`)

  // 暂停冻结（比较底部八格 .deck，巨环呼吸是例外不比较）
  await page.evaluate(() => { const a = window.__haloApi; a.state.pt = a.state.total * 0.5; a.state.playing = true; a.syncPlayBtn() })
  await sleep(1500)
  await page.evaluate(() => { const a = window.__haloApi; a.state.playing = false; a.syncPlayBtn() })
  await sleep(1000)
  const deck = await page.$('.deck')
  if (!deck) skip('暂停冻结', '找不到 .deck')
  else {
    const a = await deck.screenshot()
    await sleep(1000)
    const b = await deck.screenshot()
    ok('暂停后底部面板像素不变', Buffer.compare(a, b) === 0, `bytes=${a.length}/${b.length}`)
  }

  // 点选与绘制同源
  const ht = await page.evaluate(() => {
    const a = window.__haloApi
    if (typeof a.bigLayout !== 'function' || typeof a.tapeGeom !== 'function') return { skip: 'api 未暴露 bigLayout/tapeGeom' }
    const v = a.layoutView()
    if (!v.big) return { skip: '当前不是巨环模式' }
    const g = a.tapeGeom(v)
    const it = a.bigLayout(g).list[2]
    if (!it) return { skip: '卡带为空' }
    return { want: it.i, got: a.hitTest(v.cx + Math.cos(it.a) * g.rMid, v.cy + Math.sin(it.a) * g.rMid) }
  })
  if (ht.skip) skip('hitTest 命中条带', ht.skip)
  else ok('hitTest 命中条带', ht.want === ht.got, `want=${ht.want} got=${ht.got}`)

  ok('页面无报错', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

const fail = results.filter((r) => !r.pass).length
const skipped = results.filter((r) => r.skip).length
console.log(`\n${fail ? 'FAIL' : 'PASS'}：${results.length - fail - skipped} 通过 / ${fail} 失败 / ${skipped} 跳过`)
process.exit(fail ? 1 : 0)
