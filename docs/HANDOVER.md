# agent-halo 交接文档（给接手的 DeepSeek / 任意编码模型）

> 更新：2026-11-01 · 目录 `<project-root>` · 逐轮改动明细见 `docs/HANDOVER-history.md`（第 1–71 节）
> 本文是**当前状态**的完整说明；历史文档里与本文冲突的，以本文为准。

## 0. 一句话

把 Claude Code / DSH 的真实事件流（模型输出、工具调用/返回、用户输入、审批、失败…）渲染成一个可回放的“光环”控制台。**画面里每一处动效都必须对应真实事件或真实状态**，不做无来源的装饰。

## 1. 运行

```powershell
# 双击即可：重新生成 Claude 回放数据 → 启动 5180 服务 → 打开浏览器（黑窗口别关，关了服务就停）
start-halo.cmd

# 手动
node bridge/server.mjs --port 5180            # http://127.0.0.1:5180
node bridge/normalize.mjs --source claude --file "<transcript.jsonl>" --out data\claude-demo.jsonl
node bridge/normalize.mjs --source dsh --root "<dsh-home\sessions>" --out data\dsh-all.jsonl

# DSH 插件安装：先看 diff，确认后加 --yes（见第 10 节）
node dsh-plugin\install.mjs
node dsh-plugin\install.mjs --yes
```

- 改 `web/*` 只需刷新页面；改 `bridge/*.mjs` 需重启服务（先关旧进程）。
- 验证：`for %f in (web\js\*.js web\ext\*.js) do node --check %f`；`node --test bridge/*.test.mjs`（**23 项，必须全绿**）；`node tests/e2e.mjs`（服务开着时，8 项）。
- 零依赖：Node 内置模块 + 纯 Canvas 2D，**不要引入任何第三方库**。

## 2. 文件

```text
bridge/normalize.mjs    原始日志 → 事件契约 v1（Claude 与 DSH 两个分支都会调用 classifyNetwork）
bridge/net-classify.mjs 工具名/参数 → 网络行为（search/fetch/download/upload/transfer/api × direct/proxy/gateway/unknown）
                        兼容 web_fetch/WebFetch、web_search/WebSearch、pwsh/powershell/bash…
bridge/live.mjs         只读轮询 DSH 会话（实时模式；插件不可用时的回退）
bridge/server.mjs       静态服务 + /api/list /api/events /api/live(SSE) + /api/live/push(插件直连)
bridge/recent-replays.mjs 最近 DSH 会话 → 独立 data/dsh-session-<id>.jsonl（按会话回放）
dsh-plugin/             DSH Host 插件：自动拉起服务、订阅会话事件并推送契约 v1
web/index.html          骨架（顶栏、画布、右侧栏、底部八格、控制条）
web/js/*.js             渲染逻辑，按顺序加载的 8 个经典脚本（共享全局作用域）：core / playback / list-data / draw-orb / draw-ring / draw-fx / deck / ui
web/ext/*.js            扩展模块（ES module，只通过 window.__haloApi 访问内部）
web/style.css           纯黑高对比样式
web/audio/              背景音乐（麦田追逐 / Cornfield Chase 预览，可替换）
docs/                   本文、历史、net-contract.md、net-classify-notes.md
start-halo.cmd          一键启动
```

数据流：`normalize` → 事件数组 → `applyEvent` 累积 `state`、生成瞬时特效 `fx.*` → 每帧 `draw()`；底部八格由 `drawDeckOne()` 轮流绘制。

## 3. 必须遵守的硬约束

1. **真实性**：新增动效先说清“对应哪个事件/字段”，说不清就不做。
2. **时间**：
   - `state.curTs` 会话时间（回放进度、环刻度、疤痕老化）；`state.animNow` 动画时钟（播放时推进、暂停即停）。
   - **暂停 = 冻结**。唯一例外（用户明确要求）：巨环“呼吸摆动”`idleSway()`、光柱呼吸、织网地球仪自转、暂停时仍以 ~30fps 绘制——这些用 `performance.now()`。
   - 不要用 `Date.now()`。
3. **颜色（用户反复确认过）**：
   - 主体**纯黑底 + 白**。不要灰蒙蒙：不要全屏颗粒/扫描线/暗角叠加层（已停用，勿恢复）。
   - 克制的点缀色，只有这几种语义：模型 = 金 `242,198,110`；工具调用 = 青绿 `96,226,176`；工具返回 = 浅青绿 `170,240,214`；用户/等人 = 琥珀；失败 = 灰；**红色只给审批**。
   - 网络流线：下载黄绿、上传橙、搜索粉、代理紫、网关浅金（只用于网络线）。
   - 唯一例外：`error` / `status:'error'` 事件会在右侧“当前状态”区显示**红色边框提示框**（只做提示，不改变画布里的失败灰/审批红）。
   - 光柱以白为主，只有约 1/6 的线带类型色；环外波纹保持类型色（用户说“不要改波”）。
4. **语言**：中英**不混排**。所有界面文字走 `I18N` / `STATIC_EN`（`applyLang()`），控制条左侧按钮切换，`localStorage['halo-lang']` 记忆。数据本身（路径、命令、工具名）不翻译。新加文字必须两种语言都给。
5. **点选与绘制同源**：`hitTest` 与绘制必须用同一套坐标/角度函数（`tapeAngle`、`fxAngle`、`bigLayout`、`webProject`）。改其一必改其二。
6. **过渡要顺**：任何出现/消失/变宽变窄都要缓动（线条从根部长出/缩回，不能凭空出现、整格跳变）。
7. **性能**：用户机器 DPR 1.25、120Hz 屏，对卡顿极敏感。
   - 绘制循环里**不读布局**（clientWidth 等只在 resize/ResizeObserver 时量）。
   - 大量线条按颜色/线宽分桶一次描边；不变的东西缓存到离屏画布（背景、织网长弦、条带卡片）。
   - 帧率自适应：单帧 <8ms 不限帧，<20ms ~60fps，否则 30fps；下拉框聚焦时降到 ~20fps。
8. **边界**：只改本项目。不要动其他项目、DSH/Claude/Codex 配置、hooks、凭据；不读不回显任何密钥；收尾清理临时文件和自己起的进程。

## 4. 两种布局（`layoutView()`）

- **布局下拉**（顶栏 `layoutSelect`）：`自适应`（默认）、`小图模式`、`大图模式`；记忆在 `localStorage['halo-layout']`。大图模式会强制生效，不再受画布宽 ≥760 的自动门槛限制；窗口很窄（<420px）时提示可能拥挤。
- 分屏强制大图（视口 <1100px 且画布宽 <760）：右侧栏在大图模式下完全隐藏（让出全宽），底部遥测台撑满宽度并抬高到 `clamp(320px, 46vh, 420px)`；这样巨环区域左右最大化、上下更小。环本身的半径和环带公式不变。
- 巨环的织网中心/网络汇聚点由 `drawWebCore()` 画白色十字 + 实心点 + 微光；`buildNetPath()` 的代理/直连/网关/未知流线都显式指向 `view.core`，避免汇聚点落在画面左外。
- **巨环模式**（画布宽 ≥ 760 且底部八格可见，即最大化常态）：`view.big = true`
  - 顶部 62px 独立指标栏 `drawKpiBar`（事件/工具调用/模型步数/输出 token/失败/上下文）。
  - 环半径 ≈ 可用高 × 1.22，圆心在画面左外，只露一段竖弧（弧最右在 W×0.40）。
  - 弧内：**织网**（神经网摊平，`drawWeb` + `webProject`），整片绕竖轴地球仪式自转（`webRot`，约 80s/圈，背面变暗）。不画球壳。
  - 环带：**径向条带卡片**（`bigLayout` 排版、`stripCanvas/renderStrip` 离屏缓存、裁进圆环）——每张 = 一个事件：标题、数值、明细、该工具最近 24 次耗时方格 / 模型最近 16 次输出折线、底部数值条。最新在弧上部，旧的往下流。
  - 环两侧：外圈匀速刻度（=时间流逝）、条码带（长度 = 事件数值）、内圈数据齿、连续调用亮线束、**多环差速** `drawDiffRings`（逆转环速度 ∝ token/s、虚线环工具运行时 ×3、点阵环等人时几乎停）。
  - 空闲呼吸：卡带没在推进时，整圈卡带 ±2.6° / 7.5s 来回摆（`idleSway`）。
  - 弧外：**光柱** `drawTapeRays`（见第 5 节）+ 环外多层波纹 `drawPulses`。
  - 右下角状态卡 `drawCornerReadout`：当前状态大字 + 工具名 + 本轮调用/未返回/已用时 + 停滞/审批标签 + 最近 50 事件色条。**相位名、停滞、审批文字都在这里，环上不写字。**
- **经典模式**（窄窗口）：居中小环 + 球体神经网 + 两侧仪表 + 频谱柱，保留旧逻辑；也有差速环、呼吸摆动、白色光柱。

## 5. 光柱（用户最在意的部分）

- 每束 = 卡带上一个事件，沿该条带的半径方向从环上射出，**扇形发散**（末端横向偏移 ×(1+2.2·行程比例)）。
- 长度：至少射出可用宽度 70%，数值（工具耗时 / 输出 token，对数）越大越长。
- 生长：出生后 1.1s（动画时钟）从根部长出，每根线错开 0–180ms；宽度变化时外侧线**缩回/长出**而不是增减线数（线数按最大宽度固定）。
- 衰减：同一工具/模型每来一次新事件，旧光柱暗一档（×0.6，保底 0.3），τ=300ms 平滑过渡。
- 律动：① 呼吸——7s 慢波沿弧从上往下传，长度 ±8%、亮度 ±25%；② 节拍——同类事件到来时整束“踢”一下（伸长 18%、变亮变粗，600ms 回落）。
- 粗细：亮线 7px（下垫 18px 淡光），暗线/点缀线 5px，线间距 12px。
- 光包：同类事件到来时沿光柱跑一段白线。

## 6. 其他动效语义速查

| 视觉 | 来源 |
|---|---|
| 织网节点/连线 | 每个事件一个节点；连线 = 调用→返回、模型→调用、返回→下一次模型等真实关系；最近 90s 亮 |
| 织网传导信号 | 新事件沿关系上游回溯 3 跳（每跳 260ms），按类型着色，到达节点打扩散环 |
| 环外多层波纹 | 模型输出（金 5 层）、工具调用（青绿 4 层）、工具返回（浅青绿 3 层）、同工具短时间重复（白 6 层回声）；巨环模式传到光柱约 40% 处 |
| 网络流线 | `e.net`：颜色=方向/路由，虚线=代理，箭头=方向 |
| 环自转 | `ringSpin()`：底速 + 每个事件给一次角冲量（τ 900ms）；巨环外圈刻度另用纯匀速 |
| 底部八格 | 事件流水（彩色动词 think/call/done/fail）、工具负载、Token 流、上下文折线、耗时轨迹（面积图）、工具状态表、网络路由矩阵、事件矩阵（热力格） |

底部八格的颜色经过 `boostCtx`：灰色自动提为白、透明度抬高——新面板直接用灰色写即可，不用单独调色。

网络流线是**瞬时特效**：只为 `tool.call`/`tool.result` 上的 `net` 事件生成，持续约 3–6 秒（`NET_DUR × 2.2`）后由 `pruneFx()` 清掉；没有新的网络工具调用就不会常驻。底部 `NET ROUTE` 面板保留的是历史统计，不是逐条流线。

## 7. 常用调试手法

- 无头浏览器（Playwright）直接用 `window.__haloApi`（state、fx、layoutView、hitTest、bigLayout、tapeGeom、selectAndSeek、zoomRange…）；`state.pt = state.total*0.5; state.playing=true; syncPlayBtn()` 跳到中段播放。
- 暂停冻结检查：暂停后隔 1s 截两张图，像素差应为 0（受“呼吸”例外影响的区域除外）。
- 点选检查：用同一布局函数算出某事件的屏幕坐标，`hitTest(x,y)` 应返回该事件序号。
- 性能：逐个把 `drawXxx` 函数体替换成 `return` 比较帧率，定位大头。注意无头浏览器无 GPU，帧率偏低，只看相对变化。
- 截图时坐标换算用 `rect.width / canvas.width`（DPR ≠ 1）。

## 8. 已知问题 / 可做

1. 事件流水最底一行可能被面板边缘切掉半行。
2. 拖动/跳转时会一次补发一批光包和波纹（已限 24 个波纹），1–2s 内消失。
3. 性能仍取决于用户 GPU；控制条已有“高能模式 / 平衡模式”（平衡 = DPR 1）。织网静态层缓存已试过、因自转反而更慢，勿重复。
4. 网络路由面板依赖 `net` 字段；旧回放数据需用新版 `normalize.mjs` 重生成才会有。
5. 经典（窄屏）模式的部分旧文字仍是中文（例如两侧仪表标题、状态块），英文模式下可能混排——如用户要求可补进 `I18N`。

## 9. 与用户协作的习惯

- 用户用简体中文，回复开头写“我将用简体中文输出如下内容:”。
- 反馈往往是一张圈红的截图 + 一句话（“太细”“太密”“灰”“不够艺术”“不贴合”）。先确认圈的是哪个元素再改；不确定就问，别猜错对象（曾把“波纹”误当“光柱”改）。
- 用户审美偏好：haloflux（github.com/Ryder191/haloflux，PolyForm Noncommercial，**只借审美不抄代码**）——纯黑、白色高反差、密而有序、有律动、粗光柱、贴合弧形。
- DSH 未运行时可用 `start-halo.cmd` 做回放/调试；DSH 启动后由插件自动拉起 5180，不需要手动启动。

## 10. 与 DSH 联动（已完成）

用户的最终形态：**DSH 启动 → agent-halo 自动启动并进入实时模式**，不需要单独双击启动器。`start-halo.cmd` 现在只是开发期的回放/调试入口。

### 10.1 插件位置与职责

- 插件：`dsh-plugin/`，包名 `agent-halo-dsh-plugin`，Host 入口 `dsh-plugin/index.js`。
- 启动：DSH 加载插件时检查 5180；空闲则后台 `spawn(node bridge/server.mjs --port 5180)`，
  `windowsHide: true` 不弹窗，日志写 `data/halo-server.log`。
- 复用：5180 已有 agent-halo 时读取 `data/.live-token` 复用，不重复启动；
  插件卸载时只清自己的实时推送，不杀用户用 `start-halo.cmd` 起的服务。
- 退出：插件 dispose 结束自己拉起的子进程；子进程同时带 `--parent-pid` 看门狗，
  DSH 被强杀、来不及走 dispose 时也会在约 1 秒内退出。
- 事件：订阅 `session/created` / `session/event` / `session/disposed`，用
  `bridge/normalize.mjs` 的 `createDshNormalizer()` 逐条归一化成事件契约 v1，
  POST 到 `bridge/server.mjs` 的 `/api/live/push`（只绑定 127.0.0.1、需本地 token）。
- 回退：拿不到插件事件、或 5180 被旧版服务占用时，`/api/live` 仍走原有
  `bridge/live.mjs` 只读轮询会话文件。
- 回放：服务继续托管 `data/*.jsonl`；顶栏下拉框仍可选任意回放文件，
  暂停、拖时间轴、倍速、空白压缩全部保留。

### 10.2 已应用的 DSH profile 变更

安装器 `dsh-plugin/install.mjs` 默认只打印 diff；确认后才改 profile。已对
`$DSH_HOME/profiles/web/package.json` 应用以下两项（未改 DSH 源码、hooks 或任何现有插件配置）：

```diff
 dependencies:
+  "agent-halo-dsh-plugin": "link:<project-root>/dsh-plugin"
 dsh.profile.bundles:
+  "agent-halo-dsh-plugin"
```

`pnpm` 同时更新了该 profile 的 `pnpm-lock.yaml` 和 `node_modules`（插件目录为 junction）。
其他 profile 不受影响。临时用 `--patch` 验证可运行：

```powershell
dsh --profile web --patch "<project-root>\dsh-plugin\agent-halo.patch.yml" --port 3099
```

### 10.3 验收结果

- `node --test bridge/*.test.mjs`：**23 项全绿**（normalize 重构后仍全绿）。
- 独立 DSH 实例（临时 DSH_HOME）加载插件后自动出现 `http://127.0.0.1:5180`；
  真实 web profile 的独立启动测试同样拉起 5180，并收到真实 `session.start`（`mode:"push"`）。
- 终止测试 DSH 后 5180 随之关闭；mock 生命周期测试也验证了 dispose 会杀子进程。
- 浏览器（headless Chrome）验证：`/?live=1` 首屏 `modeText = 实时 · 事件直连`，
  注入的 8 条契约 v1 测试事件全部渲染；随后在下拉框选 `dsh-all.jsonl` 切到回放，
  `modeText = 回放`、事件 2384 条、播放按钮可用。
- 2026-11-01 14:55 用户已重启真实 DSH；5180 由插件子进程拉起（父进程即 DSH），
  `mode:"push"`，实时事件与当前会话文件 `<session-id>` 对账一致。

### 10.4 回放按会话切换

- `bridge/recent-replays.mjs` 会把最近 6 个 DSH 会话转成
  `data/dsh-session-<session-id>.jsonl`；服务启动后、每 30 秒和 `/api/list` 时刷新（列表请求 5 秒节流）。
- 已经跑着的旧服务也可手动执行 `node bridge/recent-replays.mjs --limit 6` 立即刷新；
  下拉框按源会话 mtime 排序，选中即切到该会话回放。
- 如需卸载插件：从 `web/package.json` 移除 `agent-halo-dsh-plugin` 依赖和 bundle 项，
  再运行 `pnpm install`；或使用 DSH 插件管理器删除该 bundle。


## 11. 2026-11-01 Claude 核对记录
- `bridge/net-classify.mjs`：曾被重建为精简版，已用 Claude 保留的原始实现覆盖恢复（并补 `export default`）。重建版单测“边界 3”期望回显代理地址，与原始契约不符（环境变量代理只记 `env:变量名`），已改回；23 项全绿。
- `bridge/live.mjs`：与原始版本逐字节一致（md5 相同），无需处理。
- 重建并补回 `docs/net-contract.md`、`docs/net-classify-notes.md`、`docs/HANDOVER-history.md`（依据代码与会话记录）。
- `docs/.net-classify.rebuilt.bak` 是重建版备份，确认无用后可删。
- 背景音乐 `web/audio/cornfield-chase.m4a` 是商业影视配乐片段，仅限本机自用，**不要随项目分享/发布**；如需分享请换成无版权素材。

## 12. 统一滑块 + 过渡补全
- 音乐音量滑块与时间轴同款（1px 轨道、7×14 白方块拇指，已走部分白色，--pct 由 JS 同步）。
- CSS：按钮/列表行/面板/下拉/详情统一 0.22s 过渡，详情面板淡入，悬停拇指放大；尊重 prefers-reduced-motion。
- 画布：新增 smooth(key, target, τ)（真实时钟指数缓动）；顶部指标进度条、右下读数相位色平滑过渡，状态字切换淡入。

## 12. 统一滑块 + 过渡补全
- 音乐音量滑块与时间轴同款（1px 轨道、7×14 白方块拇指，已走部分白色，--pct 由 JS 同步）。
- CSS：按钮/列表行/面板/下拉/详情统一 0.22s 过渡，详情面板淡入，悬停拇指放大；尊重 prefers-reduced-motion。
- 画布：新增 smooth(key, target, τ)（真实时钟指数缓动）；顶部指标进度条、右下读数相位色平滑过渡，状态字切换淡入。

## 13. 首屏/刷新卡顿
- 事件列表：改为事件委托（原来每行 2 个监听器，4400 行 ≈ 8800 个）+ 分批建 DOM（每批 250 行，requestIdleCallback 续建），加载后先出画面再建列表。
- 加载完成画布 0.5s 淡入，替代硬切。
- 无头实测：首屏最长任务 178ms（解析 2MB 回放），其余为普通帧。

## 14. 优化批次（多 agent 并行）
- 扩展接口 `window.__haloApi`（halo.js 末尾）+ hooks.afterDraw/onLoad；扩展模块放 web/ext/，**不要直接改 halo.js**。
- 事件列表虚拟滚动（ROW_H=19，可视区 ±12 行复用；滚动条按总高度，可滚到任意位置）；手动滚动后 4 秒内不自动跟随。
- 回放文件分批解析 parseJsonlAsync（每 600 行让出）。
- 性能模式（state.perfMode → DPR 1），ext/tools.js 按钮，localStorage 'halo-perf'。
- ext/tools.js：截图导出 PNG。ext/nav.js：画布悬停提示；时间轴上方标注层（用户输入白刻度、异常琥珀点）；快捷键 [ / ] 上一轮/下一轮。
- 未做（后续）：画面分层缓存、时间轴缩放、多会话对比、拆分 halo.js、前端截图测试。

## 15. 第二批（多 agent 并行）
- 时间轴缩放：state.zoom={lo,hi}，滑块只映射该段；滚轮在时间轴上缩放（以光标处为中心）、双击复位；回放走出窗口时窗口自动平移。api.zoomRange()。
- ext/nav.js 标注层随缩放映射；缩放时显示窗口起止时刻、全程位置条、“双击复位 / DBL-CLICK TO RESET”。
- 修复：跳转/选中/播放暂停切换时底部八格整台重画（原来轮流绘制，暂停瞬间会残留旧数据，例如工具负载显示 NO TOOL CALLS）。
- 前端冒烟测试 tests/e2e.mjs（Playwright 可选依赖；见 tests/README.md）：8 项全部通过（载入、虚拟列表、点击选中、] 跳轮、暂停冻结、hitTest 命中、无报错）。api 新暴露 bigLayout、tapeGeom。
- 仍未做：画面分层缓存、多会话对比、拆分 halo.js（风险大、与其他改动冲突，建议单独一轮做）。

## 16. 拆分 halo.js
- 原 6300 行单文件按功能拆成 web/js/ 下 8 个文件（core 常量/工具/DOM/状态/画布 · playback 时间轴/事件应用/主循环 · list-data 虚拟列表/加载/演练 · draw-orb 背景/神经网 · draw-ring 仪表/环/卡带/光柱 · draw-fx 网络/波纹/审批/状态块 · deck 底部八格/总绘制 · ui 多语言/命中/绑定/启动/扩展接口）。
- 加载方式：index.html 里按上述顺序 `<script defer>`（经典脚本、'use strict'），顶层 const/let/function 跨文件共享；ext/*.js 仍是 module，排在最后。
- 规则：顶层立即执行的代码只能引用**前面文件**里已定义的东西；函数内部引用不受限制。新增代码放进对应文件。
- 原文件保留为 web/halo.js.pre-split.bak（index.html 不再引用，确认无误后可删）。
- 验证：e2e 8/8、单测 23/23、大小图 + 中英 + 性能模式切换均 0 报错。
- 文中旧的“halo.js 第 N 行 / 函数位置”说明请按函数名在 web/js/ 里搜索。

## 17. 修复：性能模式开关显示、跳转后动效消失
- 性能模式按钮文字带状态（高能模式 / 平衡模式 · HIGH MODE / BALANCED MODE（按钮显示当前模式，点击切换）），开启时青绿下边线；原来只靠反白区分，与 ghost 按钮悬停反白一样，看起来像关不掉（实测开关本身正常）。
- 跳转（[ ] 回合、点击事件、列表）后 clearTransient 清掉了所有瞬时动效，画面静止。新增 replayRecentFx(idx)（js/playback.js）：为目标及之前最多 6 个事件重新触发波纹、网络流线、光柱光包、织网传导；用户输入发 6 层白色波（WAVE_SPEC.user）。
- e2e 8/8。

## 18. 修复：回放中拖时间轴 / 暂停时跳转后动效消失
- 拖时间轴走 seekToPt、往回走 advanceTo 的回退分支，两处都只 clearTransient 不补发 → 已加 replayRecentFx（每 120ms 最多一次）。
- 暂停时动画时钟不走：补发的波纹/网络流/织网信号/光包把 start 拨到 40–50% 进度，冻结画面里可见；光柱在暂停时新出现直接视为已长成（原来 born=now 永远 0 长度）。
- 实测：暂停后点时间轴 55% 处，6 波纹 + 6 光包 + 17 织网信号可见，光柱完整；e2e 8/8。

## 19. 画面分层缓存 + 多会话对比
- 分层缓存：先做了逐函数耗时（1536×820@1.25，播放中）：织网 drawOrb ≈2.0ms、波纹 drawPulses ≈1.2ms、八格单格 ≈0.8ms，其余 <0.6ms。已有缓存层：背景、织网长弦、条带卡片、光柱贴图。
  - 尝试把织网连线+节点做成静态层（30fps/10fps 刷新）：因为织网持续自转，缓存几乎每帧失效，加上整块贴图，反而变慢（2.0→2.6~4.5ms），**已撤回**，不要再走这条路；若要再省，应降低自转刷新率或减少节点光晕。
  - 保留：taperArc 分段 18→9，波纹 1.22→0.83ms。
- 多会话对比：ext/compare.js（agent E）。控制条“对比/COMPARE”按钮 → 浮层：选另一份回放，9 项指标对照（差异 >30% 琥珀色）+ 两条 200 格事件密度条（当前条带播放进度线）；Esc 关闭；中英切换。实测加载对比文件后表格正常。
- e2e 8/8、单测 23/23。

## 20. 回放自动同步（会话接着做了也更新）
- 服务端 bridge/recent-replays.mjs 新增 refreshStaleReplays：扫描 data/ 下**所有**回放（不限最近 6 个、DSH 与 Claude 都算），读首条事件 ref.file 找到源会话；源文件比回放新就重新生成（回放 mtime 设为源 mtime，重启服务后也能判断）。合并文件 *-all.jsonl 跳过。normalize.mjs 导出 claudeEvents。
- server.mjs 每 5 秒检查一次（原 30 秒；只 stat，变了才重生成）。
- 前端 js/list-data.js checkReplayUpdate：每 5 秒对比当前回放的 mtime/size，变了就后台重载、按 event_id 保留当前位置与选中；原来已播到末尾就继续往下播新事件；提示“回放已同步：新增 N 个事件”。
- 实测：模拟 Claude 会话追加 3 条，约 10 秒内页面事件数 16→19，服务日志“已同步 1 个继续进行过的会话回放”。
