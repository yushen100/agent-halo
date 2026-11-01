# net-classify 实现备注

> 2026-11-01 由 Claude 重建（原文件丢失）。配合 `net-contract.md` 阅读。

## 文件与接口

- `bridge/net-classify.mjs`：纯函数、零依赖。`export function classifyNetwork(toolName, input)`（另有 `export default`）。
  `input` 可为对象或 JSON 字符串；返回契约 v1 的 `net` 对象或 `null`。
- 调用方：`bridge/normalize.mjs` 的 **DSH 分支和 Claude 分支都会调用**（2026-10-31 修复：原先只有 DSH 分支接了，Claude 回放里网络路由恒为 0）。`tool.result` 继承同一调用的 `net`。
- 单测：`bridge/net-classify.test.mjs`。

## 关键实现点

- URL 提取用 `URL_RE`，遇到空白、引号、反引号、括号、花括号、逗号、分号、竖线、反斜杠即停，避免吞进 shell 语法；末尾的 `.,;` 会被去掉。
- `normalizeProxyAddress`：去引号、去凭据和路径，只留 `host:port`；`$env:XXX`、`%XXX%` 这类间接引用不算地址。
- 显式代理参数存在但地址解析失败时，仍算“显式代理”证据，只是 `proxy` 字段为 `null`。
- 环境变量代理：`proxy` 字段写 `env:变量名`（**不写地址**，避免回显用户代理配置）；能解析出的地址只用于把代理 URL 从目标候选中排除。
- 常见代理端口只接受 `host:port` 形式，裸端口号不算证据。
- curl 的 `-x`（代理）与 `-X`（方法）大小写敏感区分。
- `scp`：通过参数里的 `user@host:path` 判断远端与方向。
- 只有拿得到目标 host 的 shell 命令才算网络动作（单纯 `ping` 字样、不含 URL 的命令返回 null）。

## 曾经的坑

- Claude Code 的工具名是 `WebFetch` / `WebSearch`，小写后为 `webfetch` / `websearch`（无下划线），需要与 DSH 的 `web_fetch` / `web_search` 一起识别。
- 2026-11-01 文件曾被重建成精简版（约 5.8 KB），已由 Claude 用原始实现（约 14.8 KB）覆盖恢复；重建版单测里“双代理变量”一项期望回显地址，与原始契约（只记 `env:变量名`）不符，已改回契约行为。
