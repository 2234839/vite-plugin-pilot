import { relative } from 'path'
import type { ResolvedPilotOptions } from '../types'

/** pilot 注入的属性名 */
const KEY_FILE = 'data-v-pilot-file'
const KEY_LINE = 'data-v-pilot-line'
/** 不注入属性的标签 */
const EXCLUDE_TAGS = ['template', 'script', 'style']

/**
 * 源码定位模块
 * 通过 Vite transform 钩子注入位置标记属性
 *
 * - .html 文件：使用正则在 body 内注入（简单可靠）
 * - .vue 文件：使用 @vue/compiler-dom 的 AST 注入（参考 vite-plugin-vue-inspector 方案）
 */
export function createSourceLocator(root: string, _options: ResolvedPilotOptions) {
  function transform(code: string, id: string) {
    const sourceFile = relative(root, id).replace(/\\/g, '/')

    if (id.endsWith('.vue')) {
      return transformVueSfc(code, sourceFile)
    }

    if (id.endsWith('.html')) {
      return transformHtml(code, sourceFile)
    }

    return null
  }

  return { transform }
}

/**
 * 处理 Vue SFC 文件
 * 使用 @vue/compiler-dom 的 AST 在 template 区域注入位置标记
 * 参考 vite-plugin-vue-inspector 的实现方案
 */
async function transformVueSfc(code: string, sourceFile: string) {
  try {
    const [{ default: MagicString }, { parse: vueParse, transform: vueTransform }] = await Promise.all([
      import('magic-string'),
      import('@vue/compiler-dom'),
    ])

    const s = new MagicString(code)

    const ast = vueParse(code, { comments: true })
    vueTransform(ast, {
      nodeTransforms: [
        (node) => {
          if (node.type !== 1) return
          /** 只处理原生 HTML 元素，跳过组件（组件上的 non-props attributes 会触发 Vue 警告） */
          if (node.tagType !== 0) return
          if (EXCLUDE_TAGS.includes(node.tag)) return
          if (node.loc.source.includes(KEY_FILE)) return

          /** 计算插入位置：属性列表末尾或标签名之后 */
          const insertPosition = node.props.length
            ? Math.max(...node.props.map(p => p.loc.end.offset))
            : node.loc.start.offset + node.tag.length + 1

          const { line } = node.loc.start
          const attrs = ` ${KEY_FILE}="${sourceFile}" ${KEY_LINE}="${line}"`
          s.prependLeft(insertPosition, attrs)
        }
      ]
    })

    return s.toString()
  } catch {
    /** @vue/compiler-dom 不可用时静默跳过 */
    return null
  }
}

/**
 * 处理 HTML 文件
 * 在 body 内的元素注入位置标记（正则方式，适用于纯 HTML）
 */
function transformHtml(code: string, sourceFile: string) {
  const bodyMatch = code.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (!bodyMatch) return null

  const bodyContent = bodyMatch[1]
  const beforeBody = code.slice(0, code.indexOf(bodyMatch[0]) + bodyMatch[0].indexOf(bodyMatch[1]))
  const baseLine = (beforeBody.match(/\n/g) || []).length + 1

  const injected = injectPilotAttributes(bodyContent, sourceFile, baseLine)
  if (!injected) return null

  return code.replace(bodyMatch[1], injected)
}

/**
 * 在 HTML 内容的元素上注入 data-v-pilot-* 属性
 *
 * 策略：从后往前插入，避免偏移量计算
 * 只跳过 script/style 标签和已注入过的标签
 */
function injectPilotAttributes(html: string, sourceFile: string, baseLine: number): string | null {
  const tagRegex = /<(?!\/)(?!script)(?!style)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?>)/g
  const matches = [...html.matchAll(tagRegex)].filter(m => !m[0].includes(KEY_FILE))

  if (matches.length === 0) return null

  /** 从后往前处理，前面的插入不影响后面的位置 */
  let result = html
  for (const match of [...matches].reverse()) {
    const fullMatch = match[0]
    const isSelfClosing = fullMatch.endsWith('/>')

    /** 在原始 html 中计算行号 */
    const line = baseLine + (html.slice(0, match.index).match(/\n/g) || []).length
    const attrs = ` ${KEY_FILE}="${sourceFile}" ${KEY_LINE}="${line}"`

    /**
     * 定位到闭合符号（> 或 />）的位置
     * 然后在闭合符号前插入属性，跳过原始闭合符号
     */
    const closingPos = isSelfClosing
      ? match.index + fullMatch.length - 2  /* / 的位置 */
      : match.index + fullMatch.length - 1  /* > 的位置 */

    result = result.slice(0, closingPos) + attrs + result.slice(closingPos)
  }

  return result
}
