<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  frame: HTMLIFrameElement | undefined
  pilotReady: boolean
  autoDemoRunning: boolean
}>()

const emit = defineEmits<{
  'update:autoDemoRunning': [running: boolean]
  'reset': []
}>()

/** 终端状态 */
const minimized = ref(false)
const closed = ref(false)
const inputText = ref('')
const outputLines = ref<Array<{ text: string; cls: string }>>([])
const commandHistory = ref<string[]>([])
const historyIdx = ref(-1)

/** 拖拽状态 */
const terminalEl = ref<HTMLElement>()
let dragging = false
let dragOffset = { x: 0, y: 0 }

/** 获取 iframe 中的 pilot 上下文 */
function getPilot(): Window | null {
  const frame = props.frame
  if (!(frame?.contentWindow as any)?.__pilot_snapshot) return null
  return frame.contentWindow
}

/** 向终端输出一行 */
function appendLine(text: string, cls = '') {
  outputLines.value.push({ text, cls })
  nextTick(() => {
    const el = terminalEl.value?.querySelector('.terminal-output')
    if (el) el.scrollTop = el.scrollHeight
  })
}

/** 延迟 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 打字机效果：逐字输出到终端 */
async function typeLine(text: string, cls: string, charDelay = 30): Promise<void> {
  const lineIdx = outputLines.value.length
  outputLines.value.push({ text: '', cls })
  for (let i = 0; i < text.length; i++) {
    if (demoAbort) break
    outputLines.value[lineIdx] = { text: text.slice(0, i + 1), cls }
    await delay(charDelay)
    nextTick(() => {
      const el = terminalEl.value?.querySelector('.terminal-output')
      if (el) el.scrollTop = el.scrollHeight
    })
  }
}

/** 格式化 snapshot 为紧凑文本 */
function formatSnapshot(snap: any): string {
  if (!snap?.els) return '(empty snapshot)'
  const lines = [
    `# url: ${snap.url}`,
    `# title: ${snap.title}`,
    `# elements: ${snap.els.length}`,
    '',
  ]
  for (const el of snap.els.slice(0, 50)) {
    let line = el.tag
    if (el.idx != null) line += ` #${el.idx}`
    if (el.id) line += ` #${el.id}`
    if (el.value != null && String(el.value)) line += ` val=${el.value}`
    if (el.placeholder) line += ` ph:${el.placeholder}`
    if (el.checked) line += ' ✓'
    if (el.disabled) line += ' ✗'
    if (el.text) {
      const t = Array.isArray(el.text) ? el.text.join('|') : el.text
      if (t) line += ` ${t}`
    }
    if (el.options?.length) line += ` <${el.options.join('|')}>`
    lines.push(line)
  }
  if (snap.els.length > 50) lines.push(`... (${snap.els.length - 50} more)`)
  return lines.join('\n')
}

/** 解析命令字符串为可执行的 pilot API 调用 */
function parseCommand(input: string): { type: string; code?: string; label?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { type: 'empty' }

  /** 直接调用 __pilot_xxx */
  if (trimmed.startsWith('__pilot_')) return { type: 'exec', code: trimmed }

  switch (trimmed) {
    case 'page':
    case 'snapshot':
      return { type: 'snapshot' }
    case 'help':
      return { type: 'help' }
    case 'clear':
      return { type: 'clear' }
    case 'reset':
      return { type: 'reset' }
  }

  /** 缩写命令解析 */
  const match = trimmed.match(/^(\w+)\s+(.*)$/)
  if (!match) return { type: 'exec', code: trimmed }

  const [, cmd, argsStr] = match
  const args = parseArgs(argsStr)
  const jsonArgs = args.map(a => JSON.stringify(a)).join(', ')

  switch (cmd) {
    case 'clickByText': return { type: 'exec', code: `__pilot_clickByText(${jsonArgs})` }
    case 'setValue': return { type: 'exec', code: `__pilot_setValueByPlaceholder(${jsonArgs})` }
    case 'type': return { type: 'exec', code: `__pilot_typeByPlaceholder(${jsonArgs})` }
    case 'select': return { type: 'exec', code: `__pilot_selectValueByText(${jsonArgs})` }
    case 'check': return { type: 'exec', code: `__pilot_checkByText(${jsonArgs})` }
    case 'uncheck': return { type: 'exec', code: `__pilot_uncheckByText(${jsonArgs})` }
    case 'find': return { type: 'exec', code: `JSON.stringify(__pilot_findByText(${JSON.stringify(args[0])}), null, 2)` }
    case 'click': return { type: 'exec', code: `__pilot_click(${args[0]})` }
    default: return { type: 'exec', code: trimmed }
  }
}

/** 解析引号参数 */
function parseArgs(str: string): string[] {
  const args: string[] = []
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = regex.exec(str)) !== null) {
    args.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3])
  }
  return args
}

/** 在 iframe 上下文中执行代码 */
async function execInFrame(code: string): Promise<string> {
  const pilot = getPilot()
  if (!pilot) return '[Pilot] Not ready'

  /** 判断是否需要 async 执行 */
  const hasAwait = /\bawait\b/.test(code) ||
    code.includes('__pilot_waitFor(') ||
    code.includes('__pilot_wait(') ||
    code.includes('__pilot_typeByPlaceholder(') ||
    code.includes('__pilot_checkMultipleByText(') ||
    code.includes('__pilot_waitEnabled(')

  const start = performance.now()

  try {
    let result: unknown

    if (hasAwait) {
      const AsyncFunction = (pilot as any).eval('(async function(){}).constructor') as FunctionConstructor
      const fn = new AsyncFunction(code)
      result = await fn.call(pilot)
    } else {
      result = (pilot as any).eval(`(function() { return (${code}); })()`)
    }

    const elapsed = (performance.now() - start).toFixed(0)
    const output = result === undefined || result === null
      ? '(no output)'
      : typeof result === 'string' ? result : JSON.stringify(result)

    return `${output}\n  (${elapsed}ms)`
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}

/** 从命令中提取目标文本并滚动 iframe 到该元素 */
function scrollToTarget(cmd: string) {
  const pilot = getPilot()
  if (!pilot) return

  /** 从命令中提取引号内的文本参数 */
  const quoteMatch = cmd.match(/["']([^"']+)["']/)
  const text = quoteMatch?.[1]
  if (!text) return

  try {
    const els = (pilot as any).__pilot_findByText(text)
    if (els?.[0]) {
      (pilot as any).__pilot_scrollIntoView(els[0].idx)
    }
  } catch { /* ignore */ }
}

/** 执行命令 */
async function execCommand(cmd: string) {
  const parsed = parseCommand(cmd)

  switch (parsed.type) {
    case 'empty': return
    case 'clear':
      outputLines.value = []
      return
    case 'reset':
      emit('reset')
      return
    case 'help':
      appendLine(`Available commands:
  page / snapshot          Show page snapshot
  clickByText "text"       Click element by text
  setValue "ph" "value"    Set input value by placeholder
  type "ph" "value"        Type into input (triggers input event)
  select "option"          Select dropdown option by text
  check "text"             Check checkbox by text
  find "text"              Find elements by text
  __pilot_xxx(...)         Call any pilot API directly
  clear                    Clear terminal
  reset                    Reload playground`, 'cmd-info')
      return
    case 'snapshot': {
      appendLine(`$ npx pilot page`, 'cmd-prompt')
      const pilot = getPilot()
      if (!pilot) { appendLine('[Pilot] Not ready', 'cmd-error'); return }
      const snap = (pilot as any).__pilot_snapshot()
      appendLine(formatSnapshot(snap), 'cmd-snapshot')
      return
    }
    case 'exec': {
      appendLine(`$ npx pilot run '${cmd}'`, 'cmd-prompt')
      const result = await execInFrame(parsed.code!)
      scrollToTarget(cmd)
      appendLine(result, result.startsWith('Error:') ? 'cmd-error' : 'cmd-result')
      return
    }
  }
}

/** 自动演示脚本 — 模拟 agent 的工作流程 */
const DEMO_SCRIPT: Array<{
  think?: string
  cmd?: string
  thinkDelay?: number
  cmdDelay?: number
}> = [
  { think: 'Let me first take a snapshot of the page to understand its structure.', thinkDelay: 15, cmd: 'page', cmdDelay: 1800 },
  { think: 'I can see a counter, todo list, form, tabs and more. Let me try clicking the counter.', thinkDelay: 15, cmd: '__pilot_clickByText("+")', cmdDelay: 1400 },
  { think: 'The counter increased. Let me click a few more times.', thinkDelay: 12, cmd: '__pilot_clickByText("+")', cmdDelay: 1200 },
  { think: '', cmd: '__pilot_clickByText("+")', cmdDelay: 1200 },
  { think: 'Counter is at 3 now. Let me verify by checking the page state.', thinkDelay: 15, cmd: 'page', cmdDelay: 1800 },
  { think: 'Good. Now let me reset the counter and try something more complex — filling out the form.', thinkDelay: 15, cmd: '__pilot_clickByText("重置")', cmdDelay: 1400 },
  { think: 'Now let me fill in the form. First, the name field.', thinkDelay: 12, cmd: 'setValue "姓名" "Pilot AI"', cmdDelay: 1600 },
  { think: 'Fill in the description.', thinkDelay: 10, cmd: 'setValue "描述..." "Automated by vite-plugin-pilot"', cmdDelay: 1600 },
  { think: 'Check the agreement checkbox.', thinkDelay: 10, cmd: 'check "我同意条款"', cmdDelay: 1400 },
  { think: 'Submit the form.', thinkDelay: 10, cmd: '__pilot_clickByText("提交")', cmdDelay: 1600 },
  { think: 'Let me verify the form submission result.', thinkDelay: 15, cmd: 'page', cmdDelay: 2000 },
  { think: 'Form submitted successfully. Now let me try adding a todo item.', thinkDelay: 12, cmd: 'setValue "输入新任务..." "Learn vite-plugin-pilot"', cmdDelay: 1600 },
  { think: 'Click the add button.', thinkDelay: 10, cmd: '__pilot_clickByText("添加")', cmdDelay: 1400 },
  { think: 'Add another one.', thinkDelay: 10, cmd: 'setValue "输入新任务..." "Build cool demos"', cmdDelay: 1600 },
  { think: '', cmd: '__pilot_clickByText("添加")', cmdDelay: 1400 },
  { think: 'Verify the todo items were added.', thinkDelay: 12, cmd: 'page', cmdDelay: 2000 },
  { think: 'Let me try switching tabs to explore more of the page.', thinkDelay: 12, cmd: '__pilot_clickByText("详情")', cmdDelay: 1400 },
  { think: '', cmd: '__pilot_clickByText("设置")', cmdDelay: 1400 },
  { think: 'Go back to overview.', thinkDelay: 10, cmd: '__pilot_clickByText("概览")', cmdDelay: 1400 },
  { think: 'Let me trigger some notifications to show interactivity.', think: 10, cmd: '__pilot_clickByText("成功通知")', cmdDelay: 1600 },
  { think: '', cmd: '__pilot_clickByText("信息通知")', cmdDelay: 1400 },
  { think: 'Final snapshot to see the complete page state.', think: 10, cmd: 'page', cmdDelay: 2000 },
]

let demoAbort = false

async function runAutoDemo() {
  if (props.autoDemoRunning) {
    demoAbort = true
    return
  }

  emit('update:autoDemoRunning', true)
  demoAbort = false
  outputLines.value = []

  await typeLine('┌─ Claude Code [mock demo] ────────────', 'cmd-agent', 0)
  await typeLine("│ Simulated agent flow. Try typing your own commands!", 'cmd-agent', 18)
  await typeLine('└───────────────────────────────────────', 'cmd-agent', 0)
  appendLine('', '')

  for (const step of DEMO_SCRIPT) {
    if (demoAbort) break
    if (step.think) {
      await typeLine(`  ${step.think}`, 'cmd-think', step.thinkDelay || 30)
    }
    if (demoAbort) break
    appendLine('', '')
    if (step.cmd) {
      await execCommand(step.cmd)
    }
    await delay(step.cmdDelay || 800)
  }

  if (!demoAbort) {
    appendLine('', '')
    await typeLine('┌─ Claude Code [mock demo] ────────────', 'cmd-agent', 0)
    await typeLine('│ Done! Type commands below to interact with the page.', 'cmd-agent', 15)
    await typeLine('└───────────────────────────────────────', 'cmd-agent', 0)
  }

  demoAbort = false
  emit('update:autoDemoRunning', false)
}

/** 输入框键盘事件 */
function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    const cmd = inputText.value.trim()
    if (cmd) {
      commandHistory.value.push(cmd)
      historyIdx.value = commandHistory.value.length
      execCommand(cmd)
      inputText.value = ''
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (historyIdx.value > 0) {
      historyIdx.value--
      inputText.value = commandHistory.value[historyIdx.value]
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIdx.value < commandHistory.value.length - 1) {
      historyIdx.value++
      inputText.value = commandHistory.value[historyIdx.value]
    } else {
      historyIdx.value = commandHistory.value.length
      inputText.value = ''
    }
  }
}

/** 拖拽处理 */
function onDragStart(e: MouseEvent) {
  if ((e.target as HTMLElement).tagName === 'BUTTON') return
  dragging = true
  const rect = terminalEl.value!.getBoundingClientRect()
  dragOffset.x = e.clientX - rect.left
  dragOffset.y = e.clientY - rect.top
}

function onDragMove(e: MouseEvent) {
  if (!dragging) return
  const el = terminalEl.value!
  el.style.left = `${e.clientX - dragOffset.x}px`
  el.style.top = `${e.clientY - dragOffset.y}px`
  el.style.right = 'auto'
  el.style.bottom = 'auto'
}

function onDragEnd() {
  dragging = false
}

/** pilot ready 后自动开始演示 */
watch(() => props.pilotReady, (ready) => {
  if (ready && !closed.value) {
    nextTick(() => runAutoDemo())
  }
})

onMounted(() => {
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  demoAbort = true
})
</script>

<template>
  <div
    v-show="!closed"
    ref="terminalEl"
    class="terminal"
    :class="{ minimized }"
  >
    <!-- 标题栏 -->
    <div class="terminal-header" @mousedown="onDragStart">
      <div class="header-dots">
        <span class="dot dot-red" @click.stop="closed = true" />
        <span class="dot dot-yellow" @click.stop="minimized = !minimized" />
        <span class="dot dot-green" />
      </div>
      <span class="terminal-title">pilot</span>
      <button
        class="btn-demo"
        :class="{ running: autoDemoRunning }"
        @click.stop="runAutoDemo"
      >
        {{ autoDemoRunning ? 'Stop' : 'Auto Demo' }}
      </button>
    </div>

    <!-- 输出区域 -->
    <div v-show="!minimized" class="terminal-output">
      <div
        v-for="(line, i) in outputLines"
        :key="i"
        :class="['line', line.cls]"
      >{{ line.text }}</div>
    </div>

    <!-- 输入行 -->
    <div v-show="!minimized" class="terminal-input-line">
      <span class="prompt">$</span>
      <input
        v-model="inputText"
        class="terminal-input"
        type="text"
        placeholder='Type "help" for commands...'
        autocomplete="off"
        spellcheck="false"
        :disabled="!pilotReady"
        @keydown="onInputKeydown"
      />
    </div>
  </div>
</template>

<style scoped>
.terminal {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 480px;
  max-height: 340px;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(51, 65, 85, 0.6);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  z-index: 9999;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  color: #e2e8f0;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  transition: opacity 0.2s, transform 0.2s;
  overflow: hidden;
}

.terminal.minimized {
  max-height: 36px;
}

.terminal-header {
  display: flex;
  align-items: center;
  padding: 0 12px;
  height: 36px;
  background: rgba(30, 41, 59, 0.8);
  cursor: move;
  user-select: none;
  flex-shrink: 0;
  gap: 10px;
}

.header-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  cursor: pointer;
  transition: opacity 0.15s;
}

.dot:hover {
  opacity: 0.8;
}

.dot-red { background: #f87171; }
.dot-yellow { background: #fbbf24; }
.dot-green { background: #34d399; }

.terminal-title {
  font-size: 13px;
  font-weight: 500;
  color: #94a3b8;
  flex: 1;
}

.btn-demo {
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid #475569;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-demo:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: #3b82f6;
  color: #60a5fa;
}

.btn-demo.running {
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #f87171;
}

.terminal-output {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 260px;
}

.terminal-output::-webkit-scrollbar {
  width: 6px;
}

.terminal-output::-webkit-scrollbar-track {
  background: transparent;
}

.terminal-output::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 3px;
}

.line.cmd-prompt { color: #34d399; font-weight: 500; }
.line.cmd-result { color: #e2e8f0; }
.line.cmd-error { color: #f87171; }
.line.cmd-info { color: #60a5fa; opacity: 0.8; }
.line.cmd-agent { color: #c084fc; font-weight: 500; }
.line.cmd-think { color: #94a3b8; font-style: italic; }
.line.cmd-snapshot {
  color: #94a3b8;
  font-size: 11.5px;
  line-height: 1.5;
  opacity: 0.9;
}

.terminal-input-line {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-top: 1px solid rgba(51, 65, 85, 0.6);
  flex-shrink: 0;
}

.prompt {
  color: #34d399;
  margin-right: 8px;
  font-weight: 600;
}

.terminal-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e2e8f0;
  font-family: inherit;
  font-size: inherit;
  outline: none;
}

.terminal-input::placeholder {
  color: #475569;
}

.terminal-input:disabled {
  opacity: 0.4;
}
</style>
