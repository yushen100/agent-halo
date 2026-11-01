# agent-halo DSH 插件

把 agent-halo 做成 DSH Host 插件：DSH 启动/加载插件时自动拉起
`node bridge/server.mjs --port 5180`，并订阅 DSH 的 `session/created`、
`session/event`、`session/disposed`，按 `bridge/normalize.mjs` 的事件契约 v1
直接推给光环。页面带 `?live=1` 时首屏进入实时模式；顶栏下拉框仍可选任意
`data/*.jsonl` 回放。

## 安装（需要用户确认）

默认只打印将修改的 profile 差异，不改文件：

```powershell
node dsh-plugin\install.mjs
```

确认后：

```powershell
node dsh-plugin\install.mjs --yes
```

安装器给 `$DSH_HOME/profiles/web/package.json` 增加一条本地
`link:<project-root>/dsh-plugin` 依赖，并在 `dsh.profile.bundles` 末尾追加
`agent-halo-dsh-plugin`。不修改 DSH 源码、hooks 或任何现有插件配置。

## 不安装时的临时验证

可以用 DSH 的 `--patch` 覆盖层直接挂载本插件（只对本次启动有效，不写 profile）：

```powershell
dsh --profile web --patch "<project-root>\dsh-plugin\agent-halo.patch.yml" --port 3099
```

`agent-halo.patch.yml` 用 `file:///` 绝对路径指向 `index.js`，仅用于开发验证。

## 运行行为

- 5180 空闲：后台启动 `bridge/server.mjs`，`windowsHide: true`，不弹窗；日志写
  `data/halo-server.log`。
- 5180 已有 agent-halo：复用，不重复启动；插件退出时只清空自己的实时推送，
  不杀用户用 `start-halo.cmd` 起的服务。
- DSH 退出/插件卸载：结束插件自己拉起的子进程；子进程还带 `--parent-pid` 看门狗，
  DSH 被强杀时也会自动退出。
- 回放：服务仍托管 `data/*.jsonl`，下拉框不受影响。
