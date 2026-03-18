import { resolve } from 'path'
import type { ElementInfo } from '../types'

/**
 * 元素信息 → AI 提示词生成器
 * 将 ElementInfo 转换为结构化的自然语言描述，供 AI Agent 直接使用
 */
export function generateElementPrompt(info: ElementInfo, projectRoot: string): string {
  const sections: string[] = []

  /** 组件标识 */
  const label = info.componentName
    ? `<${info.componentName}> 组件`
    : `<${info.tagName}> 元素`
  sections.push(`用户选中了页面上的 ${label}。`)

  /** 位置信息 */
  const locationLines: string[] = []
  if (info.sourceFile) {
    const line = info.sourceLine ? ` 第 ${info.sourceLine} 行` : ''
    locationLines.push(`- 源码文件：${info.sourceFile}${line}`)
  }
  if (info.domPath) {
    locationLines.push(`- 组件路径：${info.domPath}`)
  }
  locationLines.push(`- 元素尺寸：${info.rect.width} × ${info.rect.height}px`)
  if (info.className) {
    locationLines.push(`- CSS 类名：${info.className}`)
  }
  const textPreview = info.textContent.trim().slice(0, 100)
  locationLines.push(`- 文本内容：${textPreview || '（无文本内容）'}`)
  sections.push('位置信息：\n' + locationLines.join('\n'))

  /** 上下文推断 */
  const contextLines = inferContext(info)
  if (contextLines.length > 0) {
    sections.push('上下文：\n' + contextLines.join('\n'))
  }

  /** 修改指引 */
  if (info.sourceFile) {
    sections.push(`如需修改，请编辑：${info.sourceFile}`)
    const absolutePath = resolve(projectRoot, info.sourceFile)
    const lineSuffix = info.sourceLine ? `:${info.sourceLine}` : ''
    sections.push(`IDE 跳转：vscode://file/${absolutePath}${lineSuffix}`)
  }

  return sections.join('\n\n')
}

/**
 * 根据元素信息推断上下文描述
 */
function inferContext(info: ElementInfo): string[] {
  const lines: string[] = []
  const tag = info.tagName.toLowerCase()
  const text = info.textContent.trim()

  if (['img', 'svg', 'canvas', 'video'].includes(tag)) {
    lines.push('当前元素可能是媒体/图片元素。')
  } else if (text.length > 0) {
    lines.push(`当前元素包含文本内容："${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`)
  }

  if (info.componentName) {
    lines.push(`该组件名称为 ${info.componentName}，可以通过查看源文件了解其完整实现。`)
  }

  if (info.computedStyles.display === 'none') {
    lines.push('注意：该元素当前为隐藏状态（display: none）。')
  }

  return lines
}
