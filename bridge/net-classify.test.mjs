// 网络事件分类器回归测试（从原项目约定恢复的 22 条用例）
// 运行：node --test bridge/net-classify.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyNetwork } from './net-classify.mjs'

function pick(net) {
  if (!net) return null
  return {
    kind: net.kind, direction: net.direction, route: net.route,
    method: net.method, host: net.host, proxy: net.proxy, bytes: net.bytes,
  }
}

test('样例 1：curl -o 是下载 / 入 / unknown', () => {
  assert.deepEqual(pick(classifyNetwork('bash', { command: 'curl https://example.com/a.txt -o a.txt' })), {
    kind: 'download', direction: 'in', route: 'unknown', method: null, host: 'example.com:443', proxy: null, bytes: null,
  })
})
test('样例 2：curl -x 显式代理 + 下载', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl -x http://127.0.0.1:7897 https://example.com/a.txt -o a.txt' }))
  assert.equal(net.kind, 'download'); assert.equal(net.direction, 'in'); assert.equal(net.route, 'proxy')
  assert.equal(net.proxy, '127.0.0.1:7897'); assert.equal(net.host, 'example.com:443')
})
test('样例 3：curl -T 上传 + 显式代理', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl -T a.txt -x http://127.0.0.1:7897 https://example.com/upload' }))
  assert.equal(net.kind, 'upload'); assert.equal(net.direction, 'out'); assert.equal(net.route, 'proxy')
  assert.equal(net.proxy, '127.0.0.1:7897'); assert.equal(net.host, 'example.com:443')
})
test('样例 4：Invoke-WebRequest -OutFile 是下载', () => {
  const net = pick(classifyNetwork('pwsh', { command: 'Invoke-WebRequest -Uri https://example.com/a.zip -OutFile a.zip' }))
  assert.equal(net.kind, 'download'); assert.equal(net.direction, 'in'); assert.equal(net.route, 'unknown'); assert.equal(net.host, 'example.com:443')
})
test('样例 5：Invoke-RestMethod -Method Post 是上传且 method=POST', () => {
  const net = pick(classifyNetwork('pwsh', { command: 'Invoke-RestMethod -Uri https://api.example.com/v1 -Method Post -Body $b' }))
  assert.equal(net.kind, 'upload'); assert.equal(net.direction, 'out'); assert.equal(net.route, 'unknown'); assert.equal(net.method, 'POST'); assert.equal(net.host, 'api.example.com:443')
})
test('样例 6：scp 本地→远端是上传', () => {
  const net = pick(classifyNetwork('bash', { command: 'scp ./a.txt root@public-ip.example:/tmp/' }))
  assert.equal(net.kind, 'upload'); assert.equal(net.direction, 'out'); assert.equal(net.route, 'unknown'); assert.equal(net.host, 'public-ip.example:22')
})
test('样例 7：scp 远端→本地是下载', () => {
  const net = pick(classifyNetwork('bash', { command: 'scp root@public-ip.example:/tmp/a.txt ./' }))
  assert.equal(net.kind, 'download'); assert.equal(net.direction, 'in'); assert.equal(net.route, 'unknown'); assert.equal(net.host, 'public-ip.example:22')
})
test('样例 8：loopback 3425 是网关', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl http://127.0.0.1:3425/v1/models' }))
  assert.equal(net.kind, 'fetch'); assert.equal(net.direction, 'in'); assert.equal(net.route, 'gateway'); assert.equal(net.host, '127.0.0.1:3425')
})
test('样例 9：web_search', () => {
  assert.deepEqual(pick(classifyNetwork('web_search', { query: 'x' })), {
    kind: 'search', direction: 'in', route: 'unknown', method: null, host: null, proxy: null, bytes: null,
  })
})
test('样例 10：web_fetch 默认 GET', () => {
  assert.deepEqual(pick(classifyNetwork('web_fetch', { url: 'https://example.com' })), {
    kind: 'fetch', direction: 'in', route: 'unknown', method: 'GET', host: 'example.com:443', proxy: null, bytes: null,
  })
})
test('样例 11：同一条命令上下行都有 → transfer', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl -T a.txt -O https://example.com/file' }))
  assert.equal(net.kind, 'transfer'); assert.equal(net.direction, 'both'); assert.equal(net.host, 'example.com:443')
})
test('边界 1：没有 URL 或不是网络工具时不产生 net', () => {
  assert.equal(classifyNetwork('Read', { file_path: 'a' }), null)
})
test('边界 2：localhost 非网关端口仍然是 unknown，不能写成 direct', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl http://localhost:9999/a' }))
  assert.equal(net.route, 'unknown'); assert.equal(net.host, 'localhost:9999')
})
test('边界 3：双代理变量按 HTTPS_PROXY 优先', () => {
  const net = pick(classifyNetwork('bash', { command: 'HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7891 curl https://example.com/a' }))
  assert.equal(net.proxy, 'env:HTTPS_PROXY') // 原始契约：只记录证据来源，不回显代理地址
})
test('边界 4：host 与 proxy 都要剥掉凭据和路径', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl http://user:user@example.com/a -x http://user:user@127.0.0.1:7897' }))
  assert.equal(net.host, 'example.com:80'); assert.equal(net.proxy, '127.0.0.1:7897')
})
test('边界 5：网关优先级高于显式代理', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl -x http://127.0.0.1:7897 http://127.0.0.1:3425/v1/models' }))
  assert.equal(net.route, 'gateway'); assert.equal(net.host, '127.0.0.1:3425')
})
test('边界 6：wget 默认下载，--post-data 视为上传', () => {
  assert.equal(pick(classifyNetwork('bash', { command: 'wget https://example.com/a' })).kind, 'download')
  assert.equal(pick(classifyNetwork('bash', { command: 'wget --post-data=x https://example.com/a' })).kind, 'upload')
})
test('边界 7：其他网关端口 localhost:3081 也识别为 gateway', () => {
  const net = pick(classifyNetwork('bash', { command: 'curl http://localhost:3081/' }))
  assert.equal(net.route, 'gateway'); assert.equal(net.host, 'localhost:3081')
})
test('边界 8：web_fetch 指向 loopback 网关时 route=gateway', () => {
  const net = pick(classifyNetwork('web_fetch', { url: 'http://127.0.0.1:9431/json/list' }))
  assert.equal(net.route, 'gateway'); assert.equal(net.host, '127.0.0.1:9431')
})
test('边界 9：输入是 JSON 字符串也能分类', () => {
  const net = pick(classifyNetwork('pwsh', '{"command":"curl -O https://example.com/f.zip"}'))
  assert.equal(net.kind, 'download'); assert.equal(net.host, 'example.com:443')
})
test('边界 10：scp 双远端不产生方向，返回 null', () => {
  assert.equal(classifyNetwork('bash', { command: 'scp a@host:/x b@host2:/y' }), null)
})
test('Claude 源：WebFetch / WebSearch / PowerShell 名称同样分类', () => {
  assert.equal(classifyNetwork('WebFetch', { url: 'https://example.com' }).kind, 'fetch')
  assert.equal(classifyNetwork('WebSearch', { query: 'x' }).kind, 'search')
  assert.equal(classifyNetwork('PowerShell', { command: 'Invoke-WebRequest -Uri https://example.com' }).kind, 'fetch')
})
