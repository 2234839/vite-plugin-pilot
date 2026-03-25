/**
 * Compact snapshot 过滤和序列化
 * 将完整的 snapshot 数据过滤为 AI 友好的精简格式，节省 ~50% token
 */

/**
 * compact 过滤：保留交互元素、section 标题、有 id 的元素、含文本的内容元素和浮动层元素
 * 经过多步管线处理：过滤 → 合并同 src → 去重 → 合并 span/button/td/li/radio/checkbox → 合并 h2/h3
 */
export function filterCompact(data: Record<string, unknown>): Record<string, unknown> {
  const INTERACTIVE = new Set(['button', 'input', 'textarea', 'select', 'a', 'option'])
  const SECTIONS = new Set(['h2', 'h3'])
  const CONTENT = new Set(['li', 'td', 'th'])
  const raw = data.els ?? data.visibleElements
  if (!Array.isArray(raw)) return data

  const filtered = raw.filter((e: Record<string, unknown>) =>
    INTERACTIVE.has(e.tag as string)
    || SECTIONS.has(e.tag as string)
    || (('id' in e) && e.text)
    || (CONTENT.has(e.tag as string) && e.text)
    || (e.floating && e.text)
    || (e.tag === 'span' && e.text),
  )

  /** 只保留紧跟 li 的 span（用于双击编辑目标）、有 style 的 span（标签/徽章）、
   *  有 id 的 span（开发者标记的语义元素）和连续 span 组（如星级评分 ★★★☆☆）
   *  过滤其他 span */
  /** 先标记属于连续 span 组的索引（≥2 个连续 span），排除紧跟 li 的组（与 li 文本重复） */
  const consecutiveSpanIdx = new Set<number>()
  /** 找到连续 span 组的起始位置 */
  let si = 1
  while (si < filtered.length) {
    if (filtered[si].tag === 'span' && filtered[si - 1].tag === 'span') {
      const groupStart = si - 1
      /** 找到连续组的结束位置 */
      let groupEnd = si
      while (groupEnd < filtered.length && filtered[groupEnd].tag === 'span') groupEnd++
      /** 检查连续组的第一个 span 前面是否是 li（跳过，因为 li 文本已包含 span 信息） */
      const beforeGroup = groupStart > 0 ? filtered[groupStart - 1] : null
      if (!beforeGroup || beforeGroup.tag !== 'li') {
        for (let gi = groupStart; gi < groupEnd; gi++) consecutiveSpanIdx.add(gi)
      }
      si = groupEnd
    } else {
      si++
    }
  }
  /** 过滤纯 hex 颜色值、调试信息和单字符按键名的 span */
  const isNoiseSpan = (e: Record<string, unknown>) => {
    const t = e.text as string
    return /^#[0-9a-f]{3,8}$/i.test(t) || /^code=/.test(t) || /^(Enter|Tab|Escape|Backspace|Delete|Arrow\w+|Shift|Control|Alt|Meta)$/i.test(t)
  }
  const spanFiltered: Record<string, unknown>[] = []
  for (let si = 0; si < filtered.length; si++) {
    const cur = filtered[si]
    if (cur.tag === 'span') {
      const prev = si > 0 ? filtered[si - 1] : null
      /** 跟随 li 的 span 需要有 style 才保留（避免重复 li 文本的噪音），
       *  有 style/id 的 span 始终保留，连续 span 组也保留（如星级评分） */
      if ((prev && prev.tag === 'li' && cur.style) || cur.style || cur.id || consecutiveSpanIdx.has(si)) {
        if (!isNoiseSpan(cur)) {
          spanFiltered.push(cur)
        }
      }
    } else {
      spanFiltered.push(cur)
    }
  }

  /** 合并连续同 src 元素（如 UserCard 的头像+姓名+角色 → 一条） */
  const merged: Record<string, unknown>[] = []
  let i = 0
  while (i < spanFiltered.length) {
    const e = spanFiltered[i]
    if (e.src && typeof e.src === 'string' && i + 1 < spanFiltered.length && spanFiltered[i + 1].src === e.src) {
      const group = [e]
      i++
      while (i < spanFiltered.length && spanFiltered[i].src === e.src) {
        group.push(spanFiltered[i])
        i++
      }
      const texts = group.map((g: Record<string, unknown>) => g.text as string).filter(Boolean)
      const { floating: _, ...first } = e
      merged.push({ ...first, text: texts.join(' · ') })
    } else {
      merged.push(e)
      i++
    }
  }

  /** 去重 + 精简：去除 compact 中不需要的字段 */
  const NO_IDX_TAGS = new Set(['h2', 'h3', 'div', 'span', 'li', 'ul', 'ol'])
  /** compact 模式不需要的 input type（AI 通过 placeholder/label 交互，不依赖 type） */
  const SKIP_TYPES = new Set(['text', 'password', 'number'])
  const deduped = merged.map((e: Record<string, unknown>, idx: number) => {
    const { floating, line, ...rest } = e
    /** compact 模式只为带 src 的子组件保留 line（App.vue 元素的 line 在 full snapshot 中可用） */
    if (rest.src && line) rest.line = line
    /** h2/h3/div 标题和容器不需要 idx（AI 通过文本交互），节省 token */
    if (NO_IDX_TAGS.has(rest.tag as string)) {
      const { idx: _, ...noIdx } = rest
      return noIdx
    }
    /** 移除不影响 AI 交互的 input type（text/password/number），节省 ~8 bytes/条 */
    if (SKIP_TYPES.has(rest.type as string)) {
      const { type: _, ...noType } = rest
      return noType
    }
    if (rest.tag === 'span' && rest.text && idx > 0) {
      const prev = merged[idx - 1]
      if (prev.tag === 'li' && prev.text === rest.text) {
        const { text: _, ...noText } = rest
        return noText
      }
    }
    return rest
  })

  /** 移除紧跟 span 的短文本按钮（≤2 字符的标签/徽章删除按钮，如 tag 的 "x"）
   *  必须在 button collapse/dedup 之前执行，否则 "x" 按钮会被合并后移到数组末尾，脱离 span 邻居 */
  const spanXFiltered: Record<string, unknown>[] = []
  for (let xi = 0; xi < deduped.length; xi++) {
    const cur = deduped[xi]
    const prev = spanXFiltered.length > 0 ? spanXFiltered[spanXFiltered.length - 1] : null
    if (prev && prev.tag === 'span' && cur.tag === 'button'
      && typeof cur.text === 'string' && cur.text.length <= 2) {
      continue
    }
    spanXFiltered.push(cur)
  }

  /** 合并连续同 tag 的 span 为一个 text 数组（标签/徽章类元素压缩） */
  const spanCollapsed: Record<string, unknown>[] = []
  let sci = 0
  while (sci < spanXFiltered.length) {
    const cur = spanXFiltered[sci]
    if (cur.tag === 'span' && sci + 1 < spanXFiltered.length && spanXFiltered[sci + 1].tag === 'span') {
      const group = [cur]
      let ni = sci + 1
      while (ni < spanXFiltered.length && spanXFiltered[ni].tag === 'span') {
        group.push(spanXFiltered[ni])
        ni++
      }
      if (group.length > 1) {
        const texts = group.map((g: Record<string, unknown>) => g.text as string)
        const entry: Record<string, unknown> = { tag: 'span', text: texts }
        spanCollapsed.push(entry)
        sci = ni
        continue
      }
    }
    spanCollapsed.push(cur)
    sci++
  }

  /** 合并连续同 tag 的 button 为一个 text 数组（节省 ~30% token）
   *  disabled 按钮不参与合并，单独输出以保留 disabled 状态供 AI 判断 */
  const collapsed: Record<string, unknown>[] = []
  let ci = 0
  while (ci < spanCollapsed.length) {
    const cur = spanCollapsed[ci]
    /** 只合并非 disabled 的 button（AI 通过 clickByText 操作，不需要 idx） */
    if (cur.tag === 'button' && !cur.disabled && ci + 1 < spanCollapsed.length && spanCollapsed[ci + 1].tag === 'button') {
      const group = [cur]
      let ni = ci + 1
      while (ni < spanCollapsed.length && spanCollapsed[ni].tag === 'button'
        && !spanCollapsed[ni].disabled) {
        group.push(spanCollapsed[ni])
        ni++
      }
      if (group.length > 1) {
        /** 提取 state 信息（如 active tab） */
        const states = group
          .filter((g: Record<string, unknown>) => g.state)
          .map((g: Record<string, unknown>) => `${g.text}:${g.state}`)
        /** 为每个 button 标注 idx，合并时仍可精确操作 */
        const texts = group.map((g: Record<string, unknown>) => {
          const prefix = g.idx != null ? `#${g.idx} ` : ''
          return prefix + (g.text as string)
        })
        const entry: Record<string, unknown> = { tag: 'button', text: texts }
        if (states.length > 0) entry.state = states
        collapsed.push(entry)
        ci = ni
        continue
      }
    }
    collapsed.push(cur)
    ci++
  }

  /** 合并连续同 tag 的 td/th 为行条目（表格数据压缩，不混合 th 和 td） */
  const tableCollapsed: Record<string, unknown>[] = []
  let ti = 0
  while (ti < collapsed.length) {
    const cur = collapsed[ti]
    const cellTag = cur.tag === 'td' || cur.tag === 'th' ? cur.tag : ''
    if (cellTag && ti + 1 < collapsed.length && collapsed[ti + 1].tag === cellTag) {
      const group = [cur]
      let ni = ti + 1
      while (ni < collapsed.length && collapsed[ni].tag === cellTag) {
        group.push(collapsed[ni])
        ni++
      }
      if (group.length > 1) {
        const texts = group.map((g: Record<string, unknown>) => g.text as string)
        tableCollapsed.push({ tag: cellTag === 'th' ? 'th' : 'tr', text: texts })
        ti = ni
        continue
      }
    }
    tableCollapsed.push(cur)
    ti++
  }

  /** 合并紧跟 tr 的重复 button（tr text 末尾已包含按钮文本时，省略独立 button 行）
   *  例如：tr 张三|28|前端|删除 + button 删除 → tr 张三|28|前端|删除（省略 button 删除）
   *  AI 通过 clickByText("删除", n) 定位行内操作按钮，n 对应全局第 n+1 个匹配 */
  const trBtnMerged: Record<string, unknown>[] = []
  for (const e of tableCollapsed) {
    const prev = trBtnMerged.length > 0 ? trBtnMerged[trBtnMerged.length - 1] : null
    if (prev?.tag === 'tr' && e.tag === 'button' && typeof e.text === 'string'
      && Array.isArray(prev.text)) {
      const lastCell = prev.text[prev.text.length - 1]
      if (lastCell === e.text) continue
    }
    trBtnMerged.push(e)
  }

  /** 合并紧跟 input/select/textarea 的单字符 button（仅 ≤1 字符的 +、-、x 等）到 input 行中
   *  使用 idx 差值（≤3）判断 DOM 邻居，避免跨 section 误合并
   *  例如：input #209 val=5 + button #208 - + button #210 + → input #209 val=5 [- +]
   *  AI 通过 clickByText 定位 button 不受影响 */
  const INPUT_TAGS = new Set(['input', 'textarea', 'select'])
  const inputBtnMerged: Record<string, unknown>[] = []
  let ibi = 0
  while (ibi < trBtnMerged.length) {
    const cur = trBtnMerged[ibi]
    const curTag = cur.tag as string
    if (INPUT_TAGS.has(curTag)
      && typeof cur.idx === 'number'
      && ibi + 1 < trBtnMerged.length) {
      const next = trBtnMerged[ibi + 1]
      const nextText = next.text as string | undefined
      const nextIdx = next.idx as number | undefined
      if (next.tag === 'button' && nextText && nextText.length <= 1 && typeof nextIdx === 'number') {
        const btnIdx = nextIdx
        const inputIdx = cur.idx as number
        if (btnIdx - inputIdx <= 3 && btnIdx - inputIdx > 0) {
          const btnTexts = [nextText]
          let ni = ibi + 2
          while (ni < trBtnMerged.length) {
            const s = trBtnMerged[ni]
            const sText = s.text as string | undefined
            const sIdx = s.idx as number | undefined
            if (s.tag === 'button' && sText && sText.length <= 1 && typeof sIdx === 'number' && sIdx - inputIdx <= 3) {
              btnTexts.push(sText)
              ni++
            } else break
          }
          const { text: _, ...noText } = cur
          noText._btns = btnTexts
          inputBtnMerged.push(noText)
          ibi = ni
          continue
        }
      }
    }
    inputBtnMerged.push(cur)
    ibi++
  }

  /** 合并 input/select/textarea 前置的短按钮（仅 ≤1 字符的 -、+ 等）
   *  与 inputBtnMerged 配合，实现双向合并：
   *  button - + input val=0 [+] → input [- +] val=0
   */
  const preBtnMerged: Record<string, unknown>[] = []
  let pbi = 0
  while (pbi < inputBtnMerged.length) {
    const cur = inputBtnMerged[pbi]
    const curTag = cur.tag as string
    if (curTag === 'button' && typeof cur.text === 'string' && cur.text.length <= 1
      && typeof cur.idx === 'number'
      && pbi + 1 < inputBtnMerged.length) {
      const next = inputBtnMerged[pbi + 1]
      const nextTag = next.tag as string
      if (INPUT_TAGS.has(nextTag) && typeof next.idx === 'number') {
        const btnIdx = cur.idx as number
        const inputIdx = next.idx as number
        if (inputIdx - btnIdx <= 3 && inputIdx - btnIdx > 0) {
          const existingBtns = next._btns as string[] | undefined
          next._btns = existingBtns ? [cur.text, ...existingBtns] : [cur.text]
          preBtnMerged.push(next)
          pbi += 2
          continue
        }
      }
    }
    preBtnMerged.push(cur)
    pbi++
  }

  /** 保留所有元素的 idx（AI 在多个同名元素时需要 idx 精确操作） */
  const btnMerged = preBtnMerged

  /** 合并连续 radio 为一个条目（节省 token，保留 checked 索引） */
  const radioMerged: Record<string, unknown>[] = []
  let ri = 0
  while (ri < btnMerged.length) {
    const cur = btnMerged[ri]
    if (cur.tag === 'input' && cur.type === 'radio') {
      const group = [cur]
      let ni = ri + 1
      while (ni < btnMerged.length && btnMerged[ni].tag === 'input' && btnMerged[ni].type === 'radio') {
        group.push(btnMerged[ni])
        ni++
      }
      if (group.length > 1) {
        const checkedIdx = group.findIndex((g: Record<string, unknown>) => g.checked)
        const labels = group.map((g: Record<string, unknown>) => g.label as string)
        radioMerged.push({ tag: 'radio', text: labels, checked: checkedIdx })
        ri = ni
        continue
      }
    }
    radioMerged.push(cur)
    ri++
  }

  /** 合并连续 checkbox 为一个条目（节省 token，保留 checked 标签数组） */
  const checkMerged: Record<string, unknown>[] = []
  let cki = 0
  while (cki < radioMerged.length) {
    const cur = radioMerged[cki]
    if (cur.tag === 'input' && cur.type === 'checkbox') {
      const group = [cur]
      let ni = cki + 1
      while (ni < radioMerged.length && radioMerged[ni].tag === 'input' && radioMerged[ni].type === 'checkbox') {
        group.push(radioMerged[ni])
        ni++
      }
      if (group.length > 1) {
        const checkedLabels = group
          .filter((g: Record<string, unknown>) => g.checked)
          .map((g: Record<string, unknown>) => g.label as string)
        const labels = group.map((g: Record<string, unknown>) => g.label as string)
        checkMerged.push({ tag: 'checkbox', text: labels, checked: checkedLabels })
        cki = ni
        continue
      }
    }
    checkMerged.push(cur)
    cki++
  }

  /** 跳过紧跟 li 的 collapsed button 数组（纯 emoji/图标按钮，li 文本已包含操作上下文）
   *  保留含文字的按钮组（如"随机打乱"、"重置顺序"）
   *  判断规则：按钮文本全部为 emoji 或短符号（≤2 字符且含非字母字符） */
  const isEmojiOrIcon = (t: string) => t.length <= 2 && /[^\w\s]/.test(t)
  const liBtnFiltered: Record<string, unknown>[] = []
  for (let bi = 0; bi < checkMerged.length; bi++) {
    const cur = checkMerged[bi]
    const prev = bi > 0 ? checkMerged[bi - 1] : null
    if (prev && prev.tag === 'li' && cur.tag === 'button' && Array.isArray(cur.text)
      && (cur.text as string[]).every(isEmojiOrIcon)) {
      continue
    }
    liBtnFiltered.push(cur)
  }

  /** 合并紧跟 li 的短按钮（≤2 字符）到 li 行中，使后续 liCollapsed 能正确合并连续 li
   *  必须在 liCollapsed 之前执行，否则按钮会打断 li 的连续性
   *  例如：li 任务1 + button x + li 任务2 + button x → li 任务1 [x] + li 任务2 [x] → liCollapsed → li 任务1|任务2 [x x] */
  const liBtnMerged: Record<string, unknown>[] = []
  for (let lbi = 0; lbi < liBtnFiltered.length; lbi++) {
    const cur = liBtnFiltered[lbi]
    if (cur.tag === 'li' && lbi + 1 < liBtnFiltered.length) {
      const next = liBtnFiltered[lbi + 1]
      if (next.tag === 'button' && !next.disabled && !next.state) {
        const isSingleShort = typeof next.text === 'string' && (next.text as string).length <= 2
        const isCollapsedShort = Array.isArray(next.text) && (next.text as string[]).every(t => t.length <= 2)
        if (isSingleShort || isCollapsedShort) {
          const texts = isSingleShort ? [next.text as string] : (next.text as string[])
          cur._btns = texts
          liBtnMerged.push(cur)
          lbi++
          continue
        }
      }
    }
    liBtnMerged.push(cur)
  }

  /** 合并连续 li 为一个条目（节省 ~25% li bytes，AI 通过 clickByText 定位各条目） */
  const liCollapsed: Record<string, unknown>[] = []
  let lci = 0
  while (lci < liBtnMerged.length) {
    const cur = liBtnMerged[lci]
    if (cur.tag === 'li' && lci + 1 < liBtnMerged.length && liBtnMerged[lci + 1].tag === 'li') {
      const group = [cur]
      let ni = lci + 1
      while (ni < liBtnMerged.length && liBtnMerged[ni].tag === 'li') {
        group.push(liBtnMerged[ni])
        ni++
      }
      if (group.length > 1) {
        const texts = group.map((g: Record<string, unknown>) => g.text as string)
        /** 合并各 li 的 _btns（如每个 todo 的删除按钮） */
        const allBtns = group
          .filter((g: Record<string, unknown>) => g._btns)
          .flatMap((g: Record<string, unknown>) => g._btns as string[])
        const entry: Record<string, unknown> = { tag: 'li', text: texts }
        if (allBtns.length > 0) entry._btns = allBtns
        liCollapsed.push(entry)
        lci = ni
        continue
      }
    }
    liCollapsed.push(cur)
    lci++
  }

  /** 合并所有 h2/h3 为一个 section 列表（节省 ~20% token）
   *  超过 15 个 section 时只显示前 10 个 + 概览提示（避免长 section 行浪费 token） */
  const h2s = liCollapsed.filter((e: Record<string, unknown>) => e.tag === 'h2' || e.tag === 'h3')
  if (h2s.length > 1) {
    const nonH2 = liCollapsed.filter((e: Record<string, unknown>) => e.tag !== 'h2' && e.tag !== 'h3')
    const texts = h2s.map((e: Record<string, unknown>) => e.text as string)
    let sectionText: string
    if (texts.length > 15) {
      sectionText = texts.slice(0, 10).join('|') + '|... (+' + (texts.length - 10) + ')'
    } else {
      sectionText = texts.join('|')
    }
    nonH2.unshift({ tag: 'sections', text: sectionText })
    return { ...data, els: nonH2 }
  }

  return { ...data, els: liCollapsed }
}

/**
 * 将 compact 元素数组序列化为文本格式（比 JSON 节省 ~50% token）
 * 格式：每行一个元素，字段用空格分隔
 *   tag[#idx][val=V][type:T][ph=P][xN][disabled][check=labels|idx][state=s][opts=o] text|text|...
 */
export function serializeCompactText(els: Record<string, unknown>[]): string {
  const INTERACTIVE_TAGS = new Set(['button', 'input', 'textarea', 'select', 'a', 'option'])
  return els.map((e) => {
    const parts: string[] = [e.tag as string]
    /** 交互元素显示 idx，供 __pilot_click(i) / __pilot_setValue(i,v) 精确操作 */
    if (e.idx != null) parts.push(`#${e.idx}`)
    /** 有 id 的非交互元素（如 span#count）输出 id，帮助 AI 理解语义 */
    if (e.id != null && !INTERACTIVE_TAGS.has(e.tag as string)) parts.push(`#${e.id}`)
    if (e.value != null) {
      /** select 值与 options 重复时，用 check=N（索引）替代 val=X（文本），与 radio 格式一致 */
      const opts = Array.isArray(e.options) ? e.options as string[] : null
      if (opts) {
        const idx = opts.indexOf(String(e.value))
        if (idx >= 0) {
          parts.push(`check=${idx}`)
        } else {
          parts.push(`val=${e.value}`)
        }
      } else {
        parts.push(`val=${e.value}`)
      }
    }
    if (e.type != null) parts.push(`type:${e.type}`)
    /** range 输入追加 min-max 范围，帮助 AI 理解滑块可调范围 */
    if (e.min != null && e.max != null) {
      parts.push(`${e.min}-${e.max}`)
    }
    if (e.placeholder != null) parts.push(`ph:${e.placeholder}`)
    if (e.count != null) parts.push(`x${e.count}`)
    if (e.disabled) parts.push('disabled')
    if (e.checked != null) {
      if (Array.isArray(e.checked)) {
        if (e.checked.length > 0) {
          parts.push(`check=${(e.checked as string[]).join('|')}`)
        }
      } else if (typeof e.checked === 'number') {
        if (e.checked >= 0) {
          parts.push(`check=${e.checked}`)
        }
      } else {
        parts.push('check')
      }
    }
    if (e.state != null) {
      if (Array.isArray(e.state)) {
        parts.push(`(${(e.state as string[]).join(' ')})`)
      } else {
        parts.push(`(${e.state})`)
      }
    }
    if (e.options != null && Array.isArray(e.options)) {
      parts.push(`<${(e.options as string[]).join('|')}>`)
    }
    if (e.text != null) {
      if (Array.isArray(e.text)) {
        parts.push((e.text as string[]).join('|'))
      } else {
        parts.push(String(e.text))
      }
    }
    /** 内联的短按钮（input+button 合并后的 [- +] 等） */
    if (e._btns != null) {
      parts.push(`[${(e._btns as string[]).join(' ')}]`)
    }
    return parts.join(' ')
  }).join('\n')
}

/** compact 过滤后的结果类型 */
export interface CompactResult {
  meta: Record<string, unknown>
  text: string
  fullText: string
}

/**
 * compact 过滤 + 文本序列化（一站式调用）
 * 返回带 meta 头部的完整文本（供 AI cat 读取）
 */
export function getCompactText(data: Record<string, unknown>): CompactResult {
  const filtered = filterCompact(data)
  const els = (filtered.els ?? []) as Record<string, unknown>[]
  const { els: _, ...meta } = filtered
  const text = serializeCompactText(els)
  /** 生成带 meta 头部的完整文本，AI 一次 cat 即可获取完整上下文 */
  const header = [
    `# url: ${meta.url ?? ''}`,
    `# title: ${meta.title ?? ''}`,
  ].join('\n')
  /** lastErrors 在末尾单独展示，避免干扰 agent 对页面结构的阅读 */
  const errors = (meta.lastErrors as string[] | undefined)
  const errorSuffix = errors && errors.length > 0
    ? '\n# errors:\n' + errors.map(e => '#   ' + e).join('\n')
    : ''
  const fullText = header + '\n' + text + errorSuffix
  return { meta, text, fullText }
}
