/**
 * vite-plugin-pilot 自动化测试
 * 用法: npx tsx scripts/test.ts
 * 前置条件: playground 页面已打开（pnpm dev + 浏览器打开至少一个 playground 页面）
 * 自动检测已连接的实例（Vue/React/HTML），对每个实例运行基础测试
 * Vue playground 运行完整测试（功能最全）
 */

import { execSync } from 'child_process'

/** 超时时间（ms） */
const TIMEOUT = 30_000
const PASS: string[] = []
const FAIL: string[] = []

/** 当前测试的实例前缀（用于 pilot 命令的 instance: 参数） */
let instancePrefix = ''

/**
 * 实例信息
 */
interface Instance {
  id: string
  type: string
  url: string
  title: string
  framework: string
}

/**
 * 执行 pilot 命令，返回 stdout
 * 请求间加 200ms 间隔避免 HTTP 连接复用导致的响应乱序
 */
let lastPilotTime = 0
function pilot(cmd: string): string {
  const elapsed = Date.now() - lastPilotTime
  if (elapsed < 800) {
    execSync('sleep 0.8', { timeout: 2000 })
  }
  lastPilotTime = Date.now()
  const prefix = instancePrefix ? `instance:${instancePrefix} ` : ''
  const full = `npx pilot ${prefix}${cmd}`
  try {
    return execSync(full, { timeout: TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string }
    return err.stdout || err.stderr || ''
  }
}

/**
 * 匹配测试：输出应包含 pattern
 */
function matches(name: string, cmd: string, pattern: RegExp) {
  const output = pilot(cmd)
  if (pattern.test(output)) {
    PASS.push(name)
    console.log(`  PASS  ${name}`)
  } else {
    FAIL.push(name)
    console.log(`  FAIL  ${name}`)
    console.log(`        expect: ${pattern}`)
    console.log(`        got: ${output.split('\n').slice(0, 3).join('\n        ')}`)
  }
}

/**
 * 反向匹配测试：输出不应包含 pattern
 */
function notMatches(name: string, cmd: string, pattern: RegExp) {
  const output = pilot(cmd)
  if (!pattern.test(output)) {
    PASS.push(name)
    console.log(`  PASS  ${name}`)
  } else {
    FAIL.push(name)
    console.log(`  FAIL  ${name}`)
    console.log(`        should NOT contain: ${pattern}`)
    console.log(`        got: ${output.split('\n').slice(0, 3).join('\n        ')}`)
  }
}

/**
 * 从 URL 识别框架类型
 */
function detectFramework(url: string): string {
  if (url.includes('/vue')) return 'vue'
  if (url.includes('/react')) return 'react'
  if (url.includes('/html')) return 'html'
  return 'unknown'
}

/**
 * 获取所有已连接的实例
 */
function getInstances(): Instance[] {
  try {
    const output = execSync('npx pilot status', { timeout: TIMEOUT, encoding: 'utf-8' })
    const data = JSON.parse(output)
    const raw = data.instances || []
    if (!Array.isArray(raw)) return []
    return raw.map((info: Record<string, string>) => ({
      id: info.id || '',
      type: info.type || 'vite',
      url: info.url || '',
      title: info.title || '',
      framework: detectFramework(info.url || ''),
    }))
  } catch {
    return []
  }
}

/**
 * 基础测试（所有框架通用）
 */
function runBasicTests(framework: string) {
  const label = framework.toUpperCase()

  // ===== 1. CLI 基础命令 =====
  console.log(`\n=== 1. CLI 基础命令 [${label}] ===`)
  matches('1.1 page', 'page', /# url:/)
  matches('1.2 page cached', 'page cached', /# url:/)

  // ===== 2. 纯代码执行 =====
  console.log(`\n=== 2. 纯代码执行 [${label}] ===`)
  matches('2.1 1+1', "run '1+1' nopage", /^--- runcode.*\n2$/m)
  matches('2.2 title', "run 'document.title' nopage", /Pilot Playground/)
  matches('2.3 async', "run 'await __pilot_wait(50); \"done\"' nopage", /done/)
  matches('2.4 error', "run 'throw new Error(\"test\")' nopage", /ERROR:/)
  notMatches('2.5 no undef', "run 'void 0' nopage", /^undefined$/m)

  // ===== 3. 文本匹配操作（通用） =====
  console.log(`\n=== 3. 文本匹配操作 [${label}] ===`)
  /** 搜索文本根据框架选择（React playground 没有 "添加" 按钮） */
  const searchText = framework === 'react' ? '任务 A' : '添加'
  matches('3.1 findByText ok', `run '__pilot_findByText("${searchText}")' nologs`, /idx[\s\S]*tag[\s\S]*text/)
  matches('3.2 findByText fail', "run '__pilot_findByText(\"不存在xyzabc\")' nologs", /No element found/)

  if (framework === 'html') {
    /** HTML playground 特有元素 */
    matches('3.3 clickByText(添加)', "run '__pilot_clickByText(\"添加\")' nologs", /Clicked BUTTON#\d+ "添加"/)
    matches('3.4 typeByPlaceholder', "run 'await __pilot_typeByPlaceholder(\"输入新任务\", \"HTML测试\")' nologs", /Set INPUT#\d+/)
    matches('3.5 clickByText(面板)', "run '__pilot_clickByText(\"面板 B\")' nologs", /Clicked BUTTON#\d+ "面板 B"/)
    matches('3.6 selectValueByText', "run '__pilot_selectValueByText(\"设计师\")' nologs", /Selected "设计师"/)
    matches('3.7 checkByText', "run '__pilot_checkByText(\"同意条款\")' nologs", /Checked INPUT#\d+/)
    matches('3.8 dblclickByText', "run '__pilot_dblclickByText(\"学习 JavaScript\")' nologs", /DblClicked/)
    /** HTML 响应式验证（原生 JS 无 v-model，但 input 事件监听器应能正确触发） */
    matches('3.9 input 值更新', "run '__pilot_setValueByPlaceholder(\"输入新任务\", \"HTML响应式\"); await __pilot_wait(100)' nologs", /input.*val=HTML响应式/)
  } else if (framework === 'react') {
    /** React playground 特有元素 */
    matches('3.3 clickByText(console.log)', "run '__pilot_clickByText(\"console.log\")' nologs", /Clicked BUTTON#\d+ "console.log"/)
    matches('3.4 dblclickByText', "run '__pilot_dblclickByText(\"任务 A\")' nologs", /DblClicked/)
    /** React 响应式验证（useState 绑定的 input 值通过 input 事件正确更新） */
    matches('3.5 input 响应式', "run '__pilot_setValueByPlaceholder(\"请输入姓名\", \"React测试\"); await __pilot_wait(100)' nologs", /input.*val=React测试/)
    matches('3.6 select 响应式', "run '__pilot_selectValueByText(\"设计师\"); await __pilot_wait(100)' nologs", /select.*check=设计师/)
    matches('3.7 checkbox 响应式', "run '__pilot_checkByText(\"同意条款\"); await __pilot_wait(100)' nologs", /input.*type:checkbox.*check/)
  }

  // ===== 4. 上下文聚焦 =====
  console.log(`\n=== 4. 上下文聚焦 [${label}] ===`)
  notMatches('4.1 无操作无→', "run 'document.title' nologs", /^→ /m)
  notMatches('4.2 无操作无·', "run 'document.title' nologs", /  ·/)

  const clickTarget = framework === 'react' ? 'console.log' : framework === 'html' ? '添加' : '添加'
  matches('4.3 → 标记', `run '__pilot_clickByText("${clickTarget}")' nologs`, /^→ button/m)
  /** · 折叠只在元素足够多时出现（Vue playground），React/HTML playground 元素少不检查 */
  if (framework === 'vue') {
    matches('4.4 · 折叠', `run '__pilot_clickByText("${clickTarget}")' nologs`, /  ·/)
  }

  // ===== 5. 错误处理 =====
  console.log(`\n=== 5. 错误处理 [${label}] ===`)
  matches('5.1 元素不存在', "run '__pilot_clickByText(\"不存在xyz\")' nopage", /No element found/)
  matches('5.2 idx不存在', "run '__pilot_click(99999)' nopage", /not found/)
  matches('5.3 失败时自动snapshot', "run 'throw new Error(\"errtest\")'", /--- page snapshot ---/)

  // ===== 6. 输出格式 =====
  console.log(`\n=== 6. 输出格式 [${label}] ===`)
  matches('6.1 runcode行', "run '1+1' nopage", /--- runcode ---/)
  matches('6.2 snapshot头部', "run '1+1'", /# title:/)
  notMatches('6.3 nopage 无snapshot', `run '__pilot_clickByText("${clickTarget}")' nopage`, /--- page snapshot ---/)
}

/**
 * Vue 完整测试（功能最全的 playground）
 */
function runVueFullTests() {
  console.log('\n=== 7. Vue 完整测试 ===')

  // CLI 命令
  console.log('\n--- 7.1 CLI ---')
  matches('7.1.1 status', 'status', /"instances"/)
  matches('7.1.2 help', 'help', /__pilot_clickByText/)

  // 文本匹配操作（Vue 特有）
  console.log('\n--- 7.2 文本匹配 ---')
  matches('7.2.1 clickByText', "run '__pilot_clickByText(\"添加\")' nologs", /Clicked BUTTON#\d+ "添加"/)
  matches('7.2.2 typeByPlaceholder', "run 'await __pilot_typeByPlaceholder(\"姓名\", \"自动测试\")' nologs", /Set INPUT#\d+/)
  matches('7.2.3 selectValueByText', "run '__pilot_selectValueByText(\"高优先级\")' nologs", /Selected "高优先级"/)
  matches('7.2.4 checkByText', "run '__pilot_checkByText(\"TypeScript\")' nologs", /Checked INPUT#\d+/)
  matches('7.2.5 uncheckByText', "run '__pilot_uncheckByText(\"TypeScript\")' nologs", /Unchecked INPUT#\d+/)
  matches('7.2.6 setValueByPlaceholder', "run '__pilot_setValueByPlaceholder(\"姓名\", \"仅设置\")' nologs", /Set INPUT#\d+/)
  matches('7.2.7 checkMultiple', "run 'await __pilot_uncheckByText(\"Vite\"); await __pilot_checkMultipleByText([\"Vite\", \"Tailwind\"])' nologs", /Checked.*Vite/)
  matches('7.2.8 keydownByText', "run '__pilot_keydownByText(\"输入新任务...\", \"Escape\")' nologs", /Keydown "Escape"/)
  matches('7.2.9 waitFor appear', "run 'await __pilot_waitFor(\"Vue\", 3000)' nopage", /Found:/)
  matches('7.2.10 waitFor disappear', "run 'await __pilot_waitFor(\"不存在xyz\", 1000, true)' nopage", /Disappeared:/)
  matches('7.2.11 waitEnabled', "run 'await __pilot_waitEnabled(\"添加\", 3000)' nopage", /Enabled:/)
  matches('7.2.12 nth 越界', "run '__pilot_clickByText(\"删除\", 999)' nopage", /out of range/)

  // 索引操作
  console.log('\n--- 7.3 索引操作 ---')
  matches('7.3.1 click(idx)', "run '__pilot_click(49)' nologs", /Clicked BUTTON#49/)
  matches('7.3.2 setValue(idx)', "run '__pilot_setValue(64, \"idx测试\")' nologs", /Set INPUT#64/)
  matches('7.3.3 getRect(idx)', "run '__pilot_getRect(49)' nopage", /visible/)
  matches('7.3.4 scrollIntoView', "run '__pilot_scrollIntoView(49)' nopage", /Scrolled to/)
  matches('7.3.5 hover(idx)', "run '__pilot_hover(49)' nologs", /Hovered/)

  // 上下文聚焦（Vue 完整）
  console.log('\n--- 7.4 上下文聚焦 ---')
  matches('7.4.1 checkbox label', "run '__pilot_clickByText(\"TypeScript\")' nologs", /^→ checkbox/m)
  matches('7.4.2 多操作多→', "run 'await __pilot_setValueByPlaceholder(\"姓名\", \"复合\"); __pilot_selectValueByText(\"高优先级\")' nologs", /→ input[\s\S]*→ select/)

  // 错误处理
  console.log('\n--- 7.5 错误处理 ---')
  matches('7.5.1 disabled元素', "run '__pilot_clickByText(\"发布评论\")' nopage", /disabled/)

  // 复合操作
  console.log('\n--- 7.6 复合操作 ---')
  matches('7.6.1 多步操作', "run 'await __pilot_setValueByPlaceholder(\"姓名\", \"复合\"); __pilot_selectValueByText(\"高优先级\")' nologs", /Selected/)

  // 响应式验证
  console.log('\n--- 7.7 响应式验证 ---')
  /** setValueByPlaceholder 设置 input 值后，compact snapshot 中 val= 应反映新值（验证 v-model 响应式更新） */
  matches('7.7.1 input val 更新', "run '__pilot_setValueByPlaceholder(\"姓名\", \"vmodel测试\"); await __pilot_wait(100)' nologs", /input.*val=vmodel测试.*ph:姓名/)
  /** selectValueByText 选择后，compact snapshot 中 check= 应反映新选中项 */
  matches('7.7.2 select check 更新', "run '__pilot_selectValueByText(\"低优先级\"); await __pilot_wait(100)' nologs", /select.*check=低优先级/)
  /** checkbox 勾选后，compact snapshot 中 check= 应包含勾选项 */
  matches('7.7.3 checkbox check 更新', "run 'await __pilot_uncheckByText(\"TypeScript\"); await __pilot_checkByText(\"Tailwind\"); await __pilot_wait(100)' nologs", /checkbox.*Tailwind/)

  // 其他
  console.log('\n--- 7.8 其他 ---')
  matches('7.8.1 bridge', 'bridge', /EventSource/)
  matches('7.8.2 userscript', 'userscript', /GM_/)
}

// ===== 主流程 =====
const color = (c: number, s: string) => `\x1b[${c}m${s}\x1b[0m`

console.log(color(36, '\n=== vite-plugin-pilot 自动化测试 ===\n'))

const instances = getInstances()
if (instances.length === 0) {
  console.log(color(31, '未检测到已连接的浏览器实例'))
  console.log('请确保 pnpm dev 已启动且浏览器已打开 playground 页面')
  process.exit(1)
}

console.log(`检测到 ${instances.length} 个实例:`)
for (const inst of instances) {
  console.log(`  [${inst.type}] ${inst.framework.toUpperCase().padEnd(6)} ${inst.id} — ${inst.url} (${inst.title})`)
}

/** 对每个实例运行基础测试 */
for (const inst of instances) {
  console.log(`\n${color(36, `━━━ ${inst.framework.toUpperCase()} 实例 ${inst.id} ━━━`)}`)
  instancePrefix = inst.id
  runBasicTests(inst.framework)
}

/** Vue 实例运行完整测试 */
const vueInstance = instances.find(i => i.framework === 'vue')
if (vueInstance) {
  instancePrefix = vueInstance.id
  runVueFullTests()
} else {
  console.log(color(33, '\n未检测到 Vue 实例，跳过完整测试'))
}

// ===== 结果 =====
console.log(`\n${color(36, '=== 测试结果 ===')}`)
console.log(`  ${color(32, `通过: ${PASS.length}`)}  ${color(31, `失败: ${FAIL.length}`)}`)
if (FAIL.length > 0) {
  console.log(`  ${color(31, '失败列表:')}`)
  for (const f of FAIL) {
    console.log(`    - ${f}`)
  }
  process.exit(1)
} else {
  console.log(`  ${color(32, '全部通过!')}`)
}
