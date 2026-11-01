@echo off
rem agent-halo 一键启动：先用最新转换脚本重生成 Claude 回放数据，再起服务并打开页面。关掉这个窗口服务就停。
chcp 65001 >nul
cd /d "%~dp0"
rem 5180 已被 DSH 插件占用时，直接打开实时页面，不重复启动。
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',5180);$c.Dispose();exit 0}catch{exit 1}"
if not errorlevel 1 (
  start "" http://127.0.0.1:5180/?live=1
  exit /b 0
)
if defined CLAUDE_TRANSCRIPT node bridge\normalize.mjs --source claude --file "%CLAUDE_TRANSCRIPT%" --out data\claude-demo.jsonl
start "" http://127.0.0.1:5180/
node bridge\server.mjs --port 5180
pause
