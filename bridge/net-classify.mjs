#!/usr/bin/env node
// DSH 网络事件离线分类器（纯函数，零 npm 依赖）。
//
// 契约：docs/net-contract.md（v1.0）
// 原则：
//   1. 只根据工具名和参数里的「可见证据」下结论；没有证据就是 unknown，
//      绝不把未知写成 direct。
//   2. host 只保留 host:port；proxy 只保留 host:port 或 env:变量名，
//      路径、查询串、用户名、密码一律丢弃。
//   3. web_search 的无代理证据、shell 的普通 URL 请求，route 都是 unknown。

const SHELL_TOOLS = new Set(['pwsh', 'powershell', 'bash', 'sh', 'zsh', 'terminal'])
const GATEWAY_PORTS = new Set(['3425', '3081', '8787', '8788', '9431'])
const PROXY_PORTS = new Set(['7890', '7897', '1080', '10809'])
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'HEAD'])
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|::1|\[::1\])$/i

// URL 字符集：遇到空白、引号、反引号、尖括号、括号、花括号、逗号、分号、
// 竖线、反斜杠就停止，避免把 shell 语法吃进 URL。
const URL_RE = /(?:https?|ftp):\/\/[^\s"'`<>()\[\]{},;|\\]+/gi
const GATEWAY_RE = /(?:127\.0\.0\.1|localhost|\[::1\]):(?:3425|3081|8787|8788|9431)\b/i
const ENV_PROXY_RE = /\b(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(["']?)([^\s"']+)\2/gi

// 环境变量同名冲突时的固定优先级：HTTPS 最具体，其次 HTTP，最后 ALL。
const ENV_PROXY_PRIORITY = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']

// ── 基础工具 ─────────────────────────────────────────────────────

function effectivePort(u) {
  if (u.port) return u.port
  if (u.protocol === 'https:') return '443'
  if (u.protocol === 'http:') return '80'
  if (u.protocol === 'ftp:') return '21'
  return ''
}

// URL 对象 → host:port（IPv6 保留方括号；自动补默认端口）
function hostOf(u) {
  const port = effectivePort(u)
  return port ? `${u.hostname}:${port}` : u.hostname
}

// 纯文本 URL → host:port；解析失败返回 null
function hostFromUrlText(text) {
  const raw = String(text ?? '').trim().replace(/[.,;]+$/, '')
  if (!raw) return null
  try {
    return hostOf(new URL(raw))
  } catch {
    return null
  }
}

// 代理地址归一化：只留 host:port，丢弃凭据和路径
function normalizeProxyAddress(value) {
  let v = String(value ?? '').trim().replace(/^["']|["']$/g, '').replace(/[.,;]+$/, '')
  if (!v) return null
  // $env:XXX / %XXX% 这类间接引用不是地址
  if (/^(?:\$env:|%[A-Za-z_][A-Za-z0-9_]*%$)/i.test(v)) return null
  let u
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'http://' + v)
  } catch {
    return null
  }
  if (!u.hostname) return null
  const port = u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '')
  return port ? `${u.hostname}:${port}` : u.hostname
}

function isGatewayHost(host) {
  const m = /^(\[[0-9a-fA-F:]+\]|[^:]+):(\d+)$/.exec(String(host ?? ''))
  if (!m) return false
  return LOOPBACK_HOST.test(m[1]) && GATEWAY_PORTS.has(m[2])
}

// 从命令里提取全部可解析的 URL（去重，保留顺序）
function extractUrls(cmd) {
  const out = []
  const seen = new Set()
  for (const m of cmd.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:!?]+$/, '')
    try {
      const u = new URL(raw)
      const host = hostOf(u)
      const key = `${u.protocol}//${host}`
      if (!host || seen.has(key)) continue
      seen.add(key)
      out.push({ href: raw, host, protocol: u.protocol })
    } catch {
      // 含模板变量等无法解析的 URL 不算证据
    }
  }
  return out
}

// ── 路由证据 ─────────────────────────────────────────────────────

// 网关：loopback 主机 + 契约端口（3425/3081/8787/8788/9431）
function detectGateway(cmd) {
  const m = GATEWAY_RE.exec(cmd)
  return m ? m[0].toLowerCase() : null
}

// 环境变量代理：命令里只要有赋值就算证据；多个变量按固定优先级取一个。
// 同时尽量解析出变量值里的地址，用于把「代理 URL」从目标 URL 里排除。
function detectProxyEnv(cmd) {
  const found = new Map()
  for (const m of cmd.matchAll(ENV_PROXY_RE)) {
    const name = m[1].toUpperCase()
    if (!found.has(name)) found.set(name, normalizeProxyAddress(m[3]))
  }
  for (const name of ENV_PROXY_PRIORITY) {
    if (found.has(name)) {
      // 所有能解析出地址的代理变量都用于排除目标 URL，避免把代理地址当成目标
      const addresses = [...found.values()].filter(Boolean)
      return { name, address: found.get(name), addresses }
    }
  }
  return null
}

// 显式代理参数 / 环境变量 / 常见代理端口
// 返回 { field, host }；field 是契约里的 proxy 字段，host 用于排除代理 URL 本身。
function detectProxy(cmd) {
  const flagPatterns = [
    // curl 长参数：--proxy http://... 或 --proxy=http://...
    /--proxy(?:[=\s]+)(["']?)([^\s"'-][^\s"']*)\1/i,
    // curl 短参数：-x http://...（大小写敏感，避免和 -X 方法参数混淆）
    /(?:^|\s)-x\s*(["']?)([^\s"'-][^\s"']*)\1/,
    // PowerShell 参数：-Proxy http://... / -Proxy:http://...
    /(?:^|\s)-Proxy(?:\s+|[:=])(["']?)([^\s"'-][^\s"']*)\1/i,
  ]
  for (const re of flagPatterns) {
    const m = cmd.match(re)
    if (!m) continue
    const value = m[2]
    const norm = normalizeProxyAddress(value)
    // 参数存在但地址无法解析时，仍然算「显式代理」证据，只是 proxy 字段为空
    return { field: norm, host: norm }
  }

  const env = detectProxyEnv(cmd)
  if (env) return { field: `env:${env.name}`, host: env.address, exclude: env.addresses }

  // 常见代理端口：只接受 host:port 形式，避免把裸端口号当成证据
  const portMatch = cmd.match(/((?:[A-Za-z0-9_.-]+|\[[0-9a-fA-F:]+\])):(7890|7897|1080|10809)\b/i)
  if (portMatch) {
    const addr = `${portMatch[1]}:${portMatch[2]}`
    return { field: addr, host: addr }
  }

  return null
}

// 只认显式 method，不根据 -T/-d 去猜
function detectMethod(cmd) {
  let m = cmd.match(/(?:^|\s)-X\s*["']?([A-Za-z]+)/) // curl 短参数，大小写敏感
  if (!m) m = cmd.match(/--request[=\s]+["']?([A-Za-z]+)/i)
  if (!m) m = cmd.match(/-Method(?:\s+|:)[=]?["']?([A-Za-z]+)/i)
  if (!m) m = cmd.match(/--method[=\s]+["']?([A-Za-z]+)/i)
  const value = m ? m[1].toUpperCase() : ''
  return METHODS.has(value) ? value : null
}

// ── scp / rsync 方向 ─────────────────────────────────────────────

function splitArgs(text) {
  const out = []
  let cur = ''
  let quote = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = '' }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

// [user@]host:path / host::module；排除 Windows 盘符和已带 scheme 的 URL
function parseRemoteSpec(token) {
  const t = String(token ?? '').replace(/^["']|["']$/g, '')
  if (!t) return null
  if (/^[A-Za-z]:[\\/]/.test(t)) return null
  if (/^(?:https?|ftp|ssh):\/\//i.test(t)) return null
  const m = /^(?:[^@/\\\s]+@)?(\[[0-9a-fA-F:]+\]|[A-Za-z0-9_.-]+):(?!\/\/)(.+)$/.exec(t)
  if (!m) return null
  const hostname = m[1]
  // 单字母主机名几乎一定是盘符残留
  if (/^[A-Za-z]$/.test(hostname)) return null
  // scp 未显式给端口时按 22 补全，保证 host 始终是 host:port
  return { host: `${hostname}:22`, hostname }
}

function detectScp(cmd) {
  const m = /(?:^|[\s;&|])(scp|rsync)(?:\.exe)?\s+([^\n\r]*)/i.exec(cmd)
  if (!m) return null
  const args = splitArgs(m[2])
  const valueFlags = new Set(['-P', '-p', '-i', '-o', '-l', '-S', '-F', '-e', '--port', '--rsh', '--exclude', '--include', '--rsync-path'])

  const positional = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a.startsWith('-')) {
      if (valueFlags.has(a)) i += 1
      continue
    }
    positional.push(a)
  }
  if (positional.length < 2) return null

  const dest = positional[positional.length - 1]
  const sources = positional.slice(0, -1)
  const destRemote = parseRemoteSpec(dest)
  const srcRemotes = sources.map(parseRemoteSpec).filter(Boolean)

  const up = Boolean(destRemote) && srcRemotes.length === 0
  const down = !destRemote && srcRemotes.length > 0
  if (!up && !down) return null
  return { up, down, host: destRemote?.host ?? srcRemotes[0]?.host ?? null }
}

// ── shell 方向证据 ───────────────────────────────────────────────

function detectTransferEvidence(cmd, urls) {
  const curl = /(?:^|[\s;&|])curl(?:\.exe)?\b/i.test(cmd)
  const wget = /(?:^|[\s;&|])wget(?:\.exe)?\b/i.test(cmd)
  const invoke = /(?:Invoke-WebRequest|Invoke-RestMethod)\b/i.test(cmd)
  const ftp = /(?:^|[\s;&|])(?:ftp|sftp)(?:\.exe)?\b/i.test(cmd) || urls.some((u) => u.protocol === 'ftp:')
  const method = detectMethod(cmd)

  let up = false
  let down = false

  if (curl) {
    // 上传证据
    if (/(?:^|\s)(?:-T|--upload-file)(?=[=\s]|$)/.test(cmd)) up = true
    if (/(?:^|\s)(?:-F|--form)(?=[=\s]|$)/.test(cmd)) up = true
    if (/(?:^|\s)(?:-d|--data|--data-binary)(?=[=\s]|$)/.test(cmd)) up = true
    if (['POST', 'PUT', 'PATCH'].includes(method)) up = true
    // 下载证据
    if (/(?:^|\s)(?:-O|--remote-name)(?=\s|$)/.test(cmd)) down = true
    if (/(?:^|\s)(?:-o|--output)(?=[=\s]|$)/.test(cmd)) down = true
  }

  if (wget) {
    const post = /(?:^|\s)--post-(?:data|file)(?=[=\s]|$)/.test(cmd)
    if (post) up = true
    else down = true // wget 默认就是下载
    // wget -O 同时出现时也记下载证据，与 --post-data 组合会得到 transfer
    if (/(?:^|\s)-O(?=[=\s]|$)/.test(cmd) || /(?:^|\s)--output-document(?=[=\s]|$)/.test(cmd)) down = true
  }

  if (invoke) {
    if (/-Method(?:\s+|:)[=]?["']?(?:POST|PUT|PATCH)\b/i.test(cmd)) up = true
    if (/-InFile\b(?=\s|:)/i.test(cmd)) up = true
    if (/-OutFile\b(?=\s|:)/i.test(cmd) || /-Destination\b(?=\s|:)/i.test(cmd)) down = true
  }

  if (ftp) {
    if (/(?:^|\s)(?:-u|put|mput)\b/i.test(cmd)) up = true
    if (/(?:^|\s)(?:get|mget)\b/i.test(cmd)) down = true
  }

  const scp = detectScp(cmd)
  if (scp) {
    up = up || scp.up
    down = down || scp.down
  }

  return { up, down, remoteHost: scp?.host ?? null }
}

// ── 各工具入口 ───────────────────────────────────────────────────

function baseNet(kind, direction, route, extra = {}) {
  return {
    kind,
    direction,
    route,
    method: extra.method ?? null,
    host: extra.host ?? null,
    proxy: extra.proxy ?? null,
    bytes: null,
  }
}

// 输入里显式写了 proxy 字段时，作为「有代理证据」处理
function inputProxyEvidence(input) {
  const raw = input?.proxy
  if (typeof raw !== 'string' || !raw.trim()) return null
  const text = raw.trim()
  if (/^env:/i.test(text)) {
    const name = text.slice(4).trim().toUpperCase()
    return ENV_PROXY_PRIORITY.includes(name) ? { field: `env:${name}` } : null
  }
  const norm = normalizeProxyAddress(text)
  return norm ? { field: norm } : null
}

function firstUrlText(input) {
  for (const key of ['url', 'uri', 'href']) {
    const value = input?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value)) {
      const first = value.find((x) => typeof x === 'string' && x.trim())
      if (first) return first.trim()
    }
  }
  return null
}

function classifyWebSearch(input) {
  const proxy = inputProxyEvidence(input)
  return baseNet('search', 'in', proxy ? 'proxy' : 'unknown', { proxy: proxy?.field ?? null })
}

function classifyWebFetch(input) {
  const urlText = firstUrlText(input)
  const host = urlText ? hostFromUrlText(urlText) : null
  const proxy = inputProxyEvidence(input)
  let route = 'unknown'
  if (proxy) route = 'proxy'
  else if (host && isGatewayHost(host)) route = 'gateway'
  return baseNet('fetch', 'in', route, { method: 'GET', host, proxy: proxy?.field ?? null })
}

function classifyShell(input) {
  const cmd = typeof input?.command === 'string' ? input.command : ''
  if (!cmd.trim()) return null

  const urls = extractUrls(cmd)
  const gateway = detectGateway(cmd)
  const proxy = detectProxy(cmd)
  const method = detectMethod(cmd)
  const { up, down, remoteHost } = detectTransferEvidence(cmd, urls)

  // 选目标 URL：代理地址本身不算目标；网关场景优先选网关 URL
  const proxyHosts = new Set([proxy?.host, ...(proxy?.exclude ?? [])].filter(Boolean))
  let target = null
  if (gateway) target = urls.find((u) => isGatewayHost(u.host)) ?? urls[0] ?? null
  else if (proxy) target = urls.find((u) => !proxyHosts.has(u.host)) ?? null
  else target = urls[0] ?? null

  // 没有 URL、也没有 scp 远端时，只有网关 host:port 本身能提供目标
  const host = target?.host ?? remoteHost ?? (gateway && urls.length === 0 ? gateway : null)
  if (!host) return null

  let route = 'unknown'
  if (gateway) route = 'gateway'
  else if (proxy) route = 'proxy'

  let kind = 'fetch'
  let direction = 'in'
  if (up && down) { kind = 'transfer'; direction = 'both' }
  else if (up) { kind = 'upload'; direction = 'out' }
  else if (down) { kind = 'download'; direction = 'in' }

  return baseNet(kind, direction, route, { method, host, proxy: proxy?.field ?? null })
}

/**
 * 把一次工具调用分类成契约里的 net 对象；不属于网络动作时返回 null。
 *
 * @param {string} toolName 工具名（DSH 原始名称）
 * @param {object|string} input 工具参数（对象，或 JSON 字符串）
 * @returns {{kind:string,direction:string,route:string,method:string|null,host:string|null,proxy:string|null,bytes:null}|null}
 */
export function classifyNetwork(toolName, input) {
  let args = input
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch { args = {} }
  }
  const name = String(toolName ?? '').toLowerCase()

  // DSH 用 web_search/web_fetch，Claude Code 用 WebSearch/WebFetch（小写后无下划线）。
  if (name === 'web_search' || name === 'websearch') return classifyWebSearch(args)
  if (name === 'web_fetch' || name === 'webfetch') return classifyWebFetch(args)
  if (SHELL_TOOLS.has(name)) return classifyShell(args)
  // send_message / read / grep / glob 等业务工具不产生 net
  return null
}

export default classifyNetwork
