# agent-halo 交接 · 给 Codex

> 2026-11-01 · 目录 `<project-root>` · 上一手：Claude（Cowork），中间 DeepSeek 做了 DSH 插件/布局下拉/背景音乐。
> **先读本文，再读 `docs/HANDOVER.md`（完整规格，第 0–19 节）。** 历史流水见 `docs/HANDOVER-history.md`；网络判定见 `docs/net-contract.md`。

## 1. 一分钟上手

```powershell
cd "<project-root>"
start-halo.cmd                               # 回放调试：重生成数据 → 起 5180 → 开浏览器（黑窗口别关）
node --test bridge/*.test.mjs                # 23 项，必须全绿
node tests/e2e.mjs                           # 前端冒烟 8 项（需服务开着 + playwright）
```

正式形态：DSH 启动时由 `dsh-plugin/` 自动拉起服务并推实时事件（安装：`node dsh-plugin\install.mjs` 先看 diff，用户同意后 `--yes`）。

## 2. 代码地图（2026-11-01 已拆分）

| 路径 | 内容 |
|---|---|
| `web/js/core.js` | 常量、颜色、工具函数、DOM、`state`/`fx`、`resizeCanvas`、`layoutView` |
| `web/js/playback.js` | 时间轴、`applyEvent`、`advanceTo`/`seekToEvent`/`seekToPt`、`replayRecentFx`、主循环 `frame` |
| `web/js/list-data.js` | 虚拟事件列表（ROW_H=19）、`loadFile`/`parseJsonlAsync`、实时、演练 |
| `web/js/draw-orb.js` | 背景缓存、神经网/织网（`drawWeb`、`webProject`、长弦缓存） |
| `web/js/draw-ring.js` | 两侧仪表、环、卡带（`bigLayout`、`renderStrip`）、光柱 `drawTapeRays`、差速环、呼吸 `idleSway` |
| `web/js/draw-fx.js` | 网络流线、环外波纹 `drawPulses`（`WAVE_RGB/WAVE_SPEC`）、审批、状态块 |
| `web/js/deck.js` | 底部八格、`boostCtx`、总绘制 `draw()` |
| `web/js/ui.js` | 中英 `I18N`/`STATIC_EN`/`applyLang`、右下状态卡、KPI 栏、`hitTest`、`bindUI`、`boot`、`window.__haloApi` |
| `web/ext/nav.js` | 悬停提示、时间轴标注、`[` `]` 跳回合、缩放标注 |
| `web/ext/tools.js` | 高能/平衡模式、PNG 截图 |
| `web/ext/compare.js` | 多会话对比浮层 |
| `bridge/*` | normalize（契约 v1）、net-classify、live、server、recent-replays |
| `dsh-plugin/` | DSH Host 插件 |

**加载规则**：`web/js/*.js` 是按顺序 `<script defer>` 的经典脚本，共享全局作用域；顶层立即执行的代码只能用前面文件里定义的东西。`web/ext/*.js` 是 module，**只通过 `window.__haloApi` 访问内部**，不改 js/。新功能优先做成 ext。

## 3. 绝对不能破的规矩（详见 HANDOVER.md 第 3 节）

1. 每个动效必须对应真实事件/状态，不做装饰。
2. 暂停即冻结（`animNow`/`curTs`）；例外只有：卡带呼吸摆动、光柱呼吸、织网自转（用 `performance.now()`）。
3. 纯黑底 + 白；颜色语义固定：模型金、工具青绿、返回浅青绿、用户琥珀、失败灰、**红只给审批**；网络线另一套。不要加任何全屏灰雾/颗粒/扫描线层。
4. 中英不混排，新文字两种都给（`I18N`）。
5. `hitTest` 与绘制同源（`tapeAngle`/`fxAngle`/`bigLayout`/`webProject`）。
6. 所有出现/消失/跳转都要平滑；跳转后用 `replayRecentFx` 补动效。
7. 帧内不读布局；改动后跑 e2e 看暂停冻结和命中。
8. 只改本项目；不碰其他项目、DSH 现有配置、Claude/Codex 配置、凭据；改 DSH 相关先给 diff 等用户同意。
9. `web/audio/cornfield-chase.m4a` 有版权，仅本机自用，分享前替换。

## 4. 当前状态与待办

- 已完成：回放自动同步（第 20 节）、巨环/小环两种布局 + 布局下拉、光柱/波纹/织网/差速环/呼吸、底部八格、中英切换、虚拟列表、时间轴缩放（滚轮缩放、双击复位）、悬停提示、回合跳转、PNG、对比、高能/平衡模式、DSH 插件、e2e 测试。
- 已试过不要再做：织网静态层缓存（自转导致每帧失效，反而更慢）。
- 可做：
  1. 事件流水最底一行被切半行。
  2. 经典（窄屏）模式少量旧中文在英文模式下仍混排（两侧仪表标题、左下状态块）。
  3. e2e 加中英各一张截图对比、对比浮层用例。
  4. 背景音乐换无版权素材。

## 5. 和用户合作

- 简体中文；回复开头写“我将用简体中文输出如下内容:”。
- 反馈多为圈红截图 + 短句（太细/太密/灰/不贴合/不流畅）。**先确认圈的是哪个元素**（曾把“波纹”误当“光柱”改），不确定就问。
- 审美参照 haloflux（ryder191.github.io/haloflux），只借审美不抄代码（PolyForm Noncommercial）。
- 改完要说清改了什么、验证到哪一步；没截图验证就直说。

## 6. GitHub 发布

- 仓库：<https://github.com/yushen100/agent-halo>
- 首个版本：`v1.0.0`，Release 页面：<https://github.com/yushen100/agent-halo/releases/tag/v1.0.0>
- 发布内容只包含代码、文档和测试；`data/`、本地商业音乐 `web/audio/*.m4a`、`*.bak` 和临时文件均被 `.gitignore` 排除。
