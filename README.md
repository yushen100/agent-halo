# agent-halo

> 把 DSH / Claude Code 的 step·tool 事件流，映射成一条可回放、可观察的“光环”。

agent-halo 是一个零依赖的本地可视化控制台：它读取 Claude Code / DSH 的会话事件，把模型输出、工具调用、工具返回、审批、失败等行为映射到 Canvas 光环、织网、光柱和底部遥测台。画面里的每个动效都对应真实事件或真实状态，不做无来源的装饰。

## 特性

- **实时 + 回放并存**：DSH Host 插件启动时自动拉起本地服务并推送事件；历史会话可随时从下拉框回放。
- **两种视觉布局**：`自适应`、`小图模式`、`大图模式`。大图模式支持分屏强制生效，巨环区域优先占满可用宽度。
- **事件语义驱动**：失败缺口、审批红色、网络流线、停滞波纹、工具/模型相位都来自事件契约 v1，不靠随机动画。
- **面向真实会话的交互**：虚拟事件列表、时间轴缩放、倍速、空白压缩、回合跳转、悬停提示、事件详情、PNG 截图、多会话对比。
- **中英切换**：界面文案走统一 `I18N` / `STATIC_EN`，数据本身（路径、命令、工具名）不翻译。
- **本地优先**：Node 内置模块 + Canvas 2D，无运行时第三方依赖；只绑定 `127.0.0.1`。

## 快速开始

环境：Node.js 22+（已在 Node 24 验证），Windows 优先；服务本身可跨平台运行。

```powershell
git clone https://github.com/yushen100/agent-halo.git
cd agent-halo

# 启动回放控制台
node bridge/server.mjs --port 5180
# 打开 http://127.0.0.1:5180
```

首次使用时需要生成回放数据：

```powershell
# DSH 会话目录 → 合并回放
node bridge/normalize.mjs --source dsh --root "<dsh-home>\sessions" --out data\dsh-all.jsonl

# 最近 6 个 DSH 会话 → 独立回放文件（服务启动/刷新时也会自动生成）
node bridge/recent-replays.mjs --root "<dsh-home>\sessions" --out-dir data --limit 6

# Claude Code JSONL → 回放
node bridge/normalize.mjs --source claude --file "<transcript.jsonl>" --out data\claude-demo.jsonl
```

`data/` 是本地生成目录，不会被提交到仓库；会话文件可能包含路径、命令和对话内容，请勿公开上传。

### DSH 插件（可选）

插件会让 DSH 启动时自动拉起 5180 服务，并订阅当前会话事件：

```powershell
node dsh-plugin\install.mjs        # 只打印将要修改的 profile diff
node dsh-plugin\install.mjs --yes  # 确认后安装
```

安装器只修改指定 DSH profile 的 `package.json` / `dependencies` / `dsh.profile.bundles`，不改 DSH 源码、hooks 或凭据。安装后重启 DSH，访问 `http://127.0.0.1:5180/?live=1`。

## 项目结构

```text
bridge/
  normalize.mjs         原始日志 → 事件契约 v1（Claude / DSH 两套入口）
  net-classify.mjs      工具名/参数 → 网络行为分类
  live.mjs              插件不可用时只读轮询 DSH 会话
  server.mjs            静态服务 + /api/list /api/events /api/live /api/live/push
  recent-replays.mjs    最近 DSH 会话 → 独立回放文件
dsh-plugin/             DSH Host 插件
web/
  index.html            控制台骨架
  js/                   按顺序加载的 8 个渲染脚本（core / playback / list-data / draw-* / deck / ui）
  ext/                  扩展模块（悬停、缩放、截图、多会话对比）
  style.css             纯黑高对比样式
  audio/                本地背景音乐（可选，不随仓库分发）
docs/                   交接、事件契约、网络分类说明
tests/                  前端冒烟测试
start-halo.cmd          Windows 一键启动/回放入口
```

更细的代码地图见 [docs/HANDOVER-CODEX.md](docs/HANDOVER-CODEX.md)。

## 事件契约

渲染层只消费 `bridge/normalize.mjs` 输出的契约 v1 事件，不直接解析原始日志。核心字段包括：

```json
{
  "v": 1,
  "event_id": "dsh:<session>:<seq>",
  "ts": 1793159613092,
  "source": "dsh",
  "session_id": "…",
  "kind": "tool.call",
  "tool": "pwsh",
  "status": "ok",
  "duration_ms": 2041,
  "phase": "tool",
  "label": "读取文件 …",
  "net": { "kind": "fetch", "direction": "in", "route": "unknown" }
}
```

完整字段和网络判定规则见 [docs/net-contract.md](docs/net-contract.md) 与 [docs/net-classify-notes.md](docs/net-classify-notes.md)。

## 测试

```powershell
node --test bridge/*.test.mjs    # 后端单元测试；当前 23 项全绿
node tests/e2e.mjs              # 前端冒烟测试；需先启动服务并安装 playwright
```

前端 e2e 覆盖事件载入、虚拟列表、点击选中、回合跳转、暂停冻结、hitTest 命中等；未安装 Playwright 时会自动跳过。

## 背景音乐

控制条提供 `播放音乐 / 暂停音乐` 按钮和音量滑杆，音量记录在 `localStorage['halo-music-volume']`。

为避免版权问题，仓库不包含商业配乐文件。若需使用本地音乐，将文件放到：

```text
web/audio/cornfield-chase.m4a
```

音乐文件仅用于本机播放，请勿随项目公开分发或用于商业用途；也可以替换为你拥有版权/授权的素材。

## 隐私与边界

- `data/` 不进入版本控制；原始会话可能包含敏感路径、命令和对话内容。
- normalize 只输出截断后的 `label`，不输出完整原始 payload。
- 服务只监听 `127.0.0.1`，不对外网开放。
- 实时优先走 DSH 插件的 `/api/live/push`；插件未加载时回退到 `bridge/live.mjs` 文件轮询。

## 文档

- [交接文档（当前状态）](docs/HANDOVER.md)
- [Codex 交接指南](docs/HANDOVER-CODEX.md)
- [变更历史](docs/HANDOVER-history.md)
- [网络事件契约](docs/net-contract.md)
- [网络分类说明](docs/net-classify-notes.md)

## 致谢

视觉方向参考 [haloflux](https://github.com/Ryder191/haloflux)；本项目只借鉴审美方向，代码为独立实现。haloflux 使用 PolyForm Noncommercial 许可证，本项目不复制其代码。
