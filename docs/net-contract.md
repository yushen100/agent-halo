# 网络效果契约 v1.0（net-contract）

> 2026-11-01 由 Claude 依据 `bridge/net-classify.mjs` 原始实现重建（原文件丢失）。条文以代码为准；若与代码冲突，改文档不改代码，除非用户确认。

## 1. 字段

事件契约 v1 的 `tool.call` / `tool.result` 可带 `net` 对象；不属于网络动作时**不带**该字段。

```json
{ "kind": "fetch", "direction": "in", "route": "proxy", "method": "GET",
  "host": "example.com:443", "proxy": "env:HTTPS_PROXY", "bytes": null }
```

| 字段 | 取值 | 说明 |
|---|---|---|
| kind | `search` `fetch` `download` `upload` `transfer` `api` | 动作类型 |
| direction | `in` `out` `both` `none` | 数据方向 |
| route | `direct` `proxy` `gateway` `unknown` | 走哪条路 |
| method | `GET` `POST` `PUT` `PATCH` `HEAD` 或 `null` | **只认显式写出的方法**，不从 -d/-T 猜 |
| host | `host:port` 或 `null` | 自动补默认端口（https 443 / http 80 / ftp 21）；IPv6 保留方括号 |
| proxy | `host:port`、`env:变量名` 或 `null` | 代理证据 |
| bytes | 恒为 `null` | 预留 |

## 2. 判定原则（硬规则）

1. **只看可见证据**：只根据工具名与参数文本下结论。没有证据 → `route: unknown`，**绝不把未知写成 direct**。
2. **脱敏**：host 只保留 `host:port`；proxy 只保留 `host:port` 或 `env:变量名`；路径、查询串、用户名、密码一律丢弃。环境变量代理只记**变量名**（`env:HTTPS_PROXY`），不回显变量值。
3. **优先级**：网关（gateway）> 显式代理（proxy）> unknown。
   - 网关：命令/URL 指向回环地址的 `3425 3081 8787 8788 9431` 端口。
   - 代理证据：`--proxy` / `-x`（curl）、`-Proxy`（PowerShell）、`HTTP(S)_PROXY / ALL_PROXY=` 赋值、或出现 `host:7890|7897|1080|10809`。
   - 多个代理环境变量同时出现时按 `HTTPS_PROXY > HTTP_PROXY > ALL_PROXY` 取一个。
   - 代理地址本身不算目标 URL（从目标候选里排除）。
4. **方向**：
   - 上传证据：curl `-T/--upload-file/-F/--form/-d/--data/--data-binary`、显式 POST/PUT/PATCH；wget `--post-data/--post-file`；Invoke-* `-Method POST|PUT|PATCH`、`-InFile`；ftp `put/mput/-u`；scp 本地→远端。
   - 下载证据：curl `-O/-o/--output`；wget 默认下载、`-O/--output-document`；Invoke-* `-OutFile/-Destination`；ftp `get/mget`；scp 远端→本地。
   - 同时有上传与下载 → `transfer / both`；只有上传 → `upload / out`；只有下载 → `download / in`；都没有 → `fetch / in`。

## 3. 各工具

| 工具名（不区分大小写） | 结果 |
|---|---|
| `web_search` / `WebSearch` | `search / in`；输入里有 `proxy` 字段才是 proxy，否则 unknown |
| `web_fetch` / `WebFetch` | `fetch / in / GET`；host 取 `url/uri/href`；有 proxy 字段 → proxy，指向网关 → gateway，否则 unknown |
| `pwsh` `powershell` `bash` `sh` `zsh` `terminal` | 按第 2 节从 `command` 文本推断；**找不到目标 host（无 URL、无 scp 远端、无网关）则不算网络动作** |
| 其他（read / grep / glob / send_message …） | 不产生 net |

## 4. 视觉映射（web/halo.js）

- 颜色：下载/取回 黄绿、上传 橙、搜索 粉、走代理 紫、网关 浅金；直连按方向色。
- 线型：实线 = 直连，虚线 = 代理，菱形节点 = 网关，点线 = 未知；失败 = 断流标记。
- 箭头指示方向；底部“网络路由”面板按 kind × route 计数。
