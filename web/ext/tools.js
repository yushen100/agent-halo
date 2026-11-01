// agent-halo 扩展：性能模式 + 截图导出（只通过 window.__haloApi 访问内部）
const TXT = {
  zh: { perf: '', perfTip: '高能模式：按屏幕原始分辨率绘制，画面最清晰；平衡模式：降低分辨率，换更高帧率、更省资源', png: '截图', pngTip: '把当前画面导出为 PNG' },
  en: { perf: '', perfTip: 'High mode: native resolution, sharpest; Balanced mode: lower resolution for higher frame rate and less load', png: 'PNG', pngTip: 'Export current frame as PNG' },
}

function pad(n) { return String(n).padStart(2, '0') }
function stamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function init() {
  const api = window.__haloApi
  const bar = document.querySelector('footer.controls')
  if (!api || !bar) { setTimeout(init, 100); return }
  if (document.getElementById('perfBtn')) return

  const mk = (id) => {
    const b = document.createElement('button')
    b.id = id
    b.type = 'button'
    b.className = 'ghost small'
    return b
  }
  const perfBtn = mk('perfBtn')
  const pngBtn = mk('pngBtn')
  const anchor = document.getElementById('langBtn')
  if (anchor) anchor.after(perfBtn, pngBtn)
  else bar.prepend(perfBtn, pngBtn)

  let perf = false
  try { perf = localStorage.getItem('halo-perf') === '1' } catch {}

  const sync = () => {
    const t = TXT[api.lang === 'en' ? 'en' : 'zh']
    // 状态写在文字里（原来只靠反白区分，鼠标悬停时 ghost 按钮也反白，看起来像“关不掉”）
    // 直接写出当前效果，避免“性能模式开/关”的歧义
    perfBtn.textContent = perf ? (api.lang === 'en' ? 'BALANCED MODE' : '平衡模式') : (api.lang === 'en' ? 'HIGH MODE' : '高能模式')
    perfBtn.title = t.perfTip
    pngBtn.textContent = t.png
    pngBtn.title = t.pngTip
    perfBtn.setAttribute('aria-pressed', String(perf))
    perfBtn.style.background = ''
    perfBtn.style.color = ''
    perfBtn.style.borderColor = perf ? '#60e2b0' : ''
    perfBtn.style.boxShadow = perf ? 'inset 0 -2px 0 #60e2b0' : ''
  }

  perfBtn.addEventListener('click', () => {
    perf = !perf
    try { localStorage.setItem('halo-perf', perf ? '1' : '0') } catch {}
    api.setPerf(perf)
    sync()
    perfBtn.blur()
  })

  pngBtn.addEventListener('click', () => {
    const cv = api.canvas
    if (!cv || !cv.toBlob) return
    cv.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-halo-${stamp()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }, 'image/png')
    pngBtn.blur()
  })

  // 语言切换后（halo.js 先处理点击）再刷新本模块文字
  if (anchor) anchor.addEventListener('click', () => setTimeout(sync, 0))

  if (perf) api.setPerf(true)
  sync()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
