/**
 * vite-plugin-pilot 自动化测试
 * 用法: npx tsx scripts/test.ts
 * 前置条件: playground 页面已打开（pnpm dev + 浏览器打开 /vue/）
 */

import { execSync } from 'child_process'

/** 超时时间（ms） */
const TIMEOUT = 30_000
const PASS: string[] = []
const FAIL: string[] = []

/**
 * 执行 pilot 命令，返回 stdout
 */
function pilot(cmd: string): string {
  const full = `npx pilot ${cmd}`
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

// ===== 1. CLI 基础命令 =====
console.log('\n=== 1. CLI 基础命令 ===')
matches('1.1 status', 'status', /"instances"/)
matches('1.2 help', 'help', /__pilot_clickByText/)
matches('1.3 page', 'page', /# url:/)
matches('1.4 page cached', 'page cached', /# url:/)

// ===== 2. 纯代码执行 =====
console.log('\n=== 2. 纯代码执行 ===')
matches('2.1 1+1', "run '1+1' nopage", /^--- runcode.*\n2$/m)
matches('2.2 title', "run 'document.title' nopage", /Pilot Playground/)
matches('2.3 async', "run 'await __pilot_wait(50); \"done\"' nopage", /done/)
matches('2.4 error', "run 'throw new Error(\"test\")' nopage", /ERROR:/)
notMatches('2.5 no undef', "run 'void 0' nopage", /^undefined$/m)

// ===== 3. 文本匹配操作 =====
console.log('\n=== 3. 文本匹配操作 ===')
matches('3.1 clickByText', "run '__pilot_clickByText(\"添加\")' nologs", /Clicked BUTTON#\d+ "添加"/)
matches('3.2 typeByPlaceholder', "run 'await __pilot_typeByPlaceholder(\"姓名\", \"自动测试\")' nologs", /Set INPUT#\d+/)
matches('3.3 selectValueByText', "run '__pilot_selectValueByText(\"高优先级\")' nologs", /Selected "高优先级"/)
matches('3.4 checkByText', "run '__pilot_checkByText(\"TypeScript\")' nologs", /Checked INPUT#\d+/)
matches('3.5 uncheckByText', "run '__pilot_uncheckByText(\"TypeScript\")' nologs", /Unchecked INPUT#\d+/)
matches('3.6 findByText ok', "run '__pilot_findByText(\"添加\")' nologs", /idx.*tag.*text/s)
matches('3.7 findByText fail', "run '__pilot_findByText(\"不存在xyzabc\")' nologs", /No element found/)
matches('3.8 setValueByPlaceholder', "run '__pilot_setValueByPlaceholder(\"姓名\", \"仅设置\")' nologs", /Set INPUT#\d+/)
matches('3.9 checkMultiple', "run 'await __pilot_uncheckByText(\"Vite\"); await __pilot_checkMultipleByText([\"Vite\", \"Tailwind\"])' nologs", /Checked.*Vite/)
matches('3.10 dblclickByText', "run '__pilot_dblclickByText(\"任务 A\")' nologs", /DblClicked/)
matches('3.11 keydownByText', "run '__pilot_keydownByText(\"输入新任务...\", \"Escape\")' nologs", /Keydown "Escape"/)
matches('3.12 waitFor appear', "run 'await __pilot_waitFor(\"Vue\", 3000)' nopage", /Found:/)
matches('3.13 waitFor disappear', "run 'await __pilot_waitFor(\"不存在xyz\", 1000, true)' nopage", /Disappeared:/)
matches('3.14 waitEnabled', "run 'await __pilot_waitEnabled(\"添加\", 3000)' nopage", /Enabled:/)
matches('3.15 nth 越界', "run '__pilot_clickByText(\"删除\", 999)' nopage", /out of range/)

// ===== 4. 索引操作 =====
console.log('\n=== 4. 索引操作 ===')
matches('4.1 click(idx)', "run '__pilot_click(49)' nologs", /Clicked BUTTON#49/)
matches('4.2 setValue(idx)', "run '__pilot_setValue(64, \"idx测试\")' nologs", /Set INPUT#64/)
matches('4.3 getRect(idx)', "run '__pilot_getRect(49)' nopage", /visible/)
matches('4.4 scrollIntoView', "run '__pilot_scrollIntoView(49)' nopage", /Scrolled to/)
matches('4.5 hover(idx)', "run '__pilot_hover(49)' nologs", /Hovered/)
matches('4.6 idx不存在', "run '__pilot_click(99999)' nopage", /not found/)

// ===== 5. 上下文聚焦 =====
console.log('\n=== 5. 上下文聚焦 ===')
matches('5.1 → 标记', "run '__pilot_clickByText(\"添加\")' nologs", /^→ button/m)
matches('5.2 · 折叠', "run '__pilot_clickByText(\"添加\")' nologs", /  ·/)
notMatches('5.3 无操作无→', "run 'document.title' nologs", /^→ /m)
notMatches('5.4 无操作无·', "run 'document.title' nologs", /  ·/)
matches('5.5 checkbox label', "run '__pilot_clickByText(\"TypeScript\")' nologs", /^→ checkbox/m)
notMatches('5.6 nopage 无snapshot', "run '__pilot_clickByText(\"添加\")' nopage", /--- page snapshot ---/)
matches('5.7 多操作多→', "run 'await __pilot_setValueByPlaceholder(\"姓名\", \"复合\"); __pilot_selectValueByText(\"高优先级\")' nologs", /→ input.*\n.*→ select/s)

// ===== 6. 错误处理 =====
console.log('\n=== 6. 错误处理 ===')
matches('6.1 元素不存在', "run '__pilot_clickByText(\"不存在xyz\")' nopage", /No element found/)
matches('6.2 disabled元素', "run '__pilot_clickByText(\"发布评论\")' nopage", /disabled/)
matches('6.3 失败时自动snapshot', "run 'throw new Error(\"errtest\")'", /--- page snapshot ---/)

// ===== 7. 输出格式 =====
console.log('\n=== 7. 输出格式 ===')
matches('7.1 runcode行', "run '1+1' nopage", /--- runcode ---/)
matches('7.2 snapshot头部', "run '1+1'", /# title:/)

// ===== 8. 复合操作 =====
console.log('\n=== 8. 复合操作 ===')
matches('8.1 多步操作', "run 'await __pilot_setValueByPlaceholder(\"姓名\", \"复合\"); __pilot_selectValueByText(\"高优先级\")' nologs", /Selected/)

// ===== 9. 其他 =====
console.log('\n=== 9. 其他 ===')
matches('9.1 bridge', 'bridge', /EventSource/)
matches('9.2 userscript', 'userscript', /GM_/)

// ===== 结果 =====
console.log('\n=== 结果 ===')
const color = (c: number, s: string) => `\x1b[${c}m${s}\x1b[0m`
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
