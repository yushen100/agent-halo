# 前端冒烟测试

1. 先启动服务：双击 `start-halo.cmd`，或 `node bridge/server.mjs --port 5180`。
2. 安装 Playwright（任选其一）：`npm i -D playwright && npx playwright install chromium`，或全局已安装。
3. 运行：`node tests/e2e.mjs`（可加 `--url http://127.0.0.1:5180/`）。

未安装 playwright 时脚本打印“未安装 playwright，跳过”并以 0 退出。

覆盖：事件载入、虚拟列表（可见行 < 120、总高度 ≈ 事件数×19）、点击列表选中、`]` 跳到下一轮、暂停后底部面板像素不变（巨环呼吸是有意例外，不比较）、hitTest 与条带布局同源（需 `__haloApi` 暴露 `bigLayout`/`tapeGeom`，否则跳过）、页面无报错。
输出 PASS/FAIL/SKIP 汇总，有失败时退出码 1。
