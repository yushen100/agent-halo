#!/usr/bin/env node
// agent-halo × DSH 插件安装器（默认只打印 diff，不改任何文件）
//
// 用法：
//   node dsh-plugin/install.mjs                 # 只显示将要修改的 profile 差异
//   node dsh-plugin/install.mjs --yes           # 确认后安装并选中 plugin bundle
//   node dsh-plugin/install.mjs --profile web --dsh-home "<dsh-home>" --yes
//
// 只做两件事：给 profile 加一条本地 link 依赖，并在 dsh.profile.bundles 末尾
// 追加 agent-halo-dsh-plugin。不修改 DSH 源码、hooks 或任何现有插件配置。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE)
const PACKAGE_NAME = 'agent-halo-dsh-plugin'

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const profile = arg('profile', 'web')
const dshHome = path.resolve(arg('dsh-home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh')))
const profileDir = path.join(dshHome, 'profiles', profile)
const manifestPath = path.join(profileDir, 'package.json')
const yes = process.argv.includes('--yes')

function fail(message) {
  console.error('✗ ' + message)
  process.exit(1)
}

if (!fs.existsSync(manifestPath)) fail(`找不到 profile：${manifestPath}`)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const dependencies = { ...(manifest.dependencies || {}) }
const bundles = [...(((manifest.dsh || {}).profile || {}).bundles || [])]
const spec = 'link:' + PLUGIN_DIR.replace(/\\/g, '/')
const alreadyDependency = dependencies[PACKAGE_NAME] === spec || dependencies[PACKAGE_NAME] === 'link:' + PLUGIN_DIR
const alreadyBundle = bundles.includes(PACKAGE_NAME)

console.log(`profile: ${profileDir}`)
console.log(`plugin : ${PLUGIN_DIR}`)
console.log('')
console.log('package.json 计划变更：')
console.log('  dependencies:')
if (alreadyDependency) {
  console.log(`  = ${PACKAGE_NAME}: ${dependencies[PACKAGE_NAME]}（已存在）`)
} else {
  console.log(`  - ${PACKAGE_NAME}: ${dependencies[PACKAGE_NAME] ?? '(未声明)'}`)
  console.log(`  + ${PACKAGE_NAME}: ${spec}`)
}
console.log('  dsh.profile.bundles:')
console.log(`  - ${JSON.stringify(bundles)}`)
console.log(`  + ${JSON.stringify([...bundles.filter((x) => x !== PACKAGE_NAME), PACKAGE_NAME])}`)
console.log('')

if (alreadyDependency && alreadyBundle) {
  console.log('已安装且已选中，无需改动。')
  process.exit(0)
}
if (!yes) {
  console.log('这是 dry-run，未改动任何文件。确认后运行：')
  console.log(`  node "${path.join(PLUGIN_DIR, 'install.mjs')}" --yes`)
  process.exit(0)
}

// 1) 用 DSH 自己的 plugin 命令安装本地 link 依赖（会写 package.json、lock、node_modules）。
const dshArgs = ['plugin', '--profile', profile, 'add', spec]
const add = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `dsh ${dshArgs.map((x) => `"${x}"`).join(' ')}`], {
      cwd: profileDir,
      stdio: 'inherit',
      env: { ...process.env, DSH_HOME: dshHome },
    })
  : spawnSync('dsh', dshArgs, {
      cwd: profileDir,
      stdio: 'inherit',
      env: { ...process.env, DSH_HOME: dshHome },
    })
if (add.status !== 0) fail(`dsh plugin add 失败（exit ${add.status}）`)

// 2) 选中 bundle。package.json 的 dsh.profile.bundles 才是加载顺序来源。
const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const nextDeps = { ...(after.dependencies || {}) }
nextDeps[PACKAGE_NAME] = spec
const profileMeta = { ...((after.dsh || {}).profile || {}) }
const nextBundles = [...(profileMeta.bundles || [])]
if (!nextBundles.includes(PACKAGE_NAME)) nextBundles.push(PACKAGE_NAME)
profileMeta.bundles = nextBundles
after.dependencies = nextDeps
after.dsh = { ...(after.dsh || {}), profile: profileMeta }
fs.writeFileSync(manifestPath, JSON.stringify(after, null, 2) + '\n', 'utf8')

console.log('')
console.log(`✓ 已安装 ${PACKAGE_NAME} 并加入 ${profile} profile。`)
console.log('  重启 DSH 后生效；插件会拉起 http://127.0.0.1:5180/?live=1')
