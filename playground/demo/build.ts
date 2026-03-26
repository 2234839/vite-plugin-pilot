/**
 * Demo 页面构建脚本
 * 1. 生成 pilot-client.js（从 src/client/ 提取 snapshot + log-collector）
 * 2. 编译 Vue playground（不含 pilot 插件）→ dist/vue-app/
 * 3. 编译 Demo 页面（App.vue + Terminal.vue）→ dist/
 *
 * 用法：npx tsx playground/demo/build.ts
 */
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logCollectorCode } from '../../src/client/log-collector'
import { snapshotCode } from '../../src/client/snapshot'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const demoDir = __dirname
const distDir = resolve(demoDir, 'dist')

/** ===== Step 1: 生成 pilot-client.js ===== */

const PLACEHOLDERS: Record<string, string> = {
  __MAX_BUFFER_SIZE__: '200',
  __FLUSH_INTERVAL__: '1000',
  __EXEC_TIMEOUT__: '15000',
  __MAX_RESULT_SIZE__: String(100 * 1024),
}

function replacePlaceholders(code: string): string {
  let result = code
  for (const [key, value] of Object.entries(PLACEHOLDERS)) {
    result = result.replace(new RegExp(key.replace(/_/g, '_'), 'g'), value)
  }
  return result
}

const pilotClient = `// [Pilot] Demo Client — standalone, no server needed
(function() {
  window.__pilot_instanceId = 'demo';
  window.__PILOT_VERSION__ = 'demo';
  window.__PILOT_HIGHLIGHT__ = true;

  /* === Log Collector === */
  ${replacePlaceholders(logCollectorCode).trim()}

  /* === Page Snapshot === */
  ${replacePlaceholders(snapshotCode).trim()}

  console.log('[Pilot] Demo client ready');
})();
`

mkdirSync(distDir, { recursive: true })
writeFileSync(resolve(distDir, 'pilot-client.js'), pilotClient)
console.log('1/3 pilot-client.js generated')

/** ===== Step 2: 编译 Vue playground → dist/vue-app/ ===== */
/** 用 CLI 调用避免 rolldown 对大 SFC 文件的 parse bug */
execSync(`npx vite build --config ${resolve(demoDir, 'build-vue-app.config.mts')} --logLevel warn`, {
  cwd: resolve(demoDir, '..'),
  stdio: 'inherit',
})
console.log('2/3 vue-app built')

/** ===== Step 3: 编译 Demo 页面 → dist/ ===== */
execSync(`npx vite build --config ${resolve(demoDir, 'build-demo.config.mts')} --logLevel warn`, {
  cwd: resolve(demoDir, '..'),
  stdio: 'inherit',
})
console.log('3/3 demo page built')

console.log('Done! Static files in playground/demo/dist/')
