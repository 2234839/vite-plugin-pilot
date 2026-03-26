/**
 * 页面快照采集客户端代码（字符串形式，用于注入到浏览器）
 *
 * 功能：
 * 1. 采集页面 URL、标题、路由、查询参数
 * 2. 遍历可见元素（最多 80 个），仅叶子节点含 text，避免冗余
 * 3. 遍历 Vue 组件树（最多 5 层）
 * 4. 提供 __pilot_snapshot() 供 exec 通道采集页面状态
 */

export const snapshotCode = `
(function() {
  /** 存储采集到的元素引用，供 __pilot_click / __pilot_setValue 使用 */
  window.__pilot_elements = {};

  /** 判断元素是否为叶子节点（无可见子元素） */
  var INVISIBLE_TAGS = { SCRIPT:1, STYLE:1, OPTION:1, OPTGROUP:1 };
  var ALWAYS_NONLEAF = { SELECT:1, TEXTAREA:1, TABLE:1, UL:1, OL:1 };
  function isLeaf(el) {
    if (ALWAYS_NONLEAF[el.tagName]) return false;
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      if (!INVISIBLE_TAGS[child.tagName] && child.offsetParent !== null) return false;
    }
    return true;
  }

  window.__pilot_snapshot = function() {
    var timestamp = new Date().toISOString();
    var url = location.href;
    var title = document.title;
    /** 预编译正则，避免每个元素重复编译 */
    var STYLE_RE = /width|height|color|background|opacity|transform/i;
    var STATE_RE = /(active|selected|current|checked|open|expanded)/i;
    var STATE_EXTRACT_RE = /(active|selected|current|checked|open|expanded)/;

    /** 清除不再在 DOM 中的悬空引用（HMR 替换组件后旧引用失效） */
    for (var k in window.__pilot_elements) {
      if (!window.__pilot_elements[k].isConnected) {
        delete window.__pilot_elements[k];
      }
    }

    var allElements = document.body.querySelectorAll('*');
    /** 记录当前 DOM 元素总数，供 findByText 轻量检查是否需要刷新 */
    window.__pilot_lastElementCount = allElements.length;

    /** 采集可见元素 — 仅保留 AI 需要的有信息量元素 */
    var visibleElements = [];
    var SKIP_TAGS = { SCRIPT:1, STYLE:1, LINK:1, HEAD:1, META:1, NOSCRIPT:1, SVG:1, OPTION:1, OPTGROUP:1, TABLE:1, THEAD:1, TBODY:1, TR:1 };
    var STRUCT_TAGS = { DIV:1, SECTION:1, UL:1, OL:1, MAIN:1, HEADER:1, FOOTER:1, NAV:1, ARTICLE:1 };
    /** 索引分配策略：复用已有索引，保证跨 snapshot 稳定 */
    var maxIdx = 0;
    for (var k in window.__pilot_elements) { if (parseInt(k) >= maxIdx) maxIdx = parseInt(k) + 1; }

    /** 处理单个元素：判断是否应采集，返回 entry 或 null */
    function processElement(el) {
      var tag = el.tagName;
      if (SKIP_TAGS[tag]) return null;
      var rect = el.getBoundingClientRect();
      /** offsetParent 为 null 但有尺寸的元素（如 fixed/absolute 定位）仍需采集 */
      if (el.offsetParent === null && tag !== 'BODY' && rect.width === 0 && rect.height === 0) return null;
      if (rect.width === 0 && rect.height === 0) return null;
      if (el.id === 'app' || el.id === '__nuxt') return null;

      var tagLower = tag.toLowerCase();
      var hasText = false;
      var txt = '';
      /** 跳过包含交互子元素的 LABEL（信息已通过子元素的 label 字段捕获，避免 clickByText 点击 label 无法触发 checkbox） */
      if (tagLower === 'label') {
        var hasInteractiveChild = false;
        for (var ci = 0; ci < el.children.length; ci++) {
          var ct = el.children[ci].tagName;
          if (ct === 'INPUT' || ct === 'SELECT' || ct === 'TEXTAREA') { hasInteractiveChild = true; break; }
        }
        if (hasInteractiveChild) return null;
      }
      if (isLeaf(el)) {
        txt = (el.textContent || '').trim();
        hasText = !!txt;
      } else {
        /** 非叶子节点：优先取直接文本节点，否则拼接所有子元素文本 */
        var directText = '';
        for (var ci = 0; ci < el.childNodes.length; ci++) {
          if (el.childNodes[ci].nodeType === 3) directText += el.childNodes[ci].textContent;
        }
        if (directText.trim()) {
          txt = directText.trim().slice(0, 30);
        } else if (tagLower === 'li') {
          /** li 元素：递归收集文本，跳过 button/a 交互子元素（避免 emoji 按钮文本污染） */
          var SKIP_TEXT_TAGS = { BUTTON: 1, A: 1 };
          var liTexts = [];
          (function collect(node) {
            for (var ci = 0; ci < node.childNodes.length; ci++) {
              var child = node.childNodes[ci];
              if (child.nodeType === 3) {
                var t = child.textContent;
                if (t && t.trim()) liTexts.push(t.trim());
              } else if (child.nodeType === 1 && !SKIP_TEXT_TAGS[child.tagName]) {
                collect(child);
              }
            }
          })(el);
          txt = liTexts.join(' ').slice(0, 50);
        } else {
          /** 拼接可见直接子元素的文本（空格分隔），跳过 offsetParent=null 的隐藏子元素 */
          var childTexts = [];
          for (var ci = 0; ci < el.children.length; ci++) {
            if (el.children[ci].offsetParent === null) continue;
            var childText = (el.children[ci].textContent || '').trim();
            if (childText) childTexts.push(childText);
          }
          /** 去重：toast-container 等容器中 transition-group 保留的离开元素会重复文本 */
          var seen = {};
          childTexts = childTexts.filter(function(t) { if (seen[t]) return false; seen[t] = true; return true; });
          txt = childTexts.join(' ').slice(0, 50);
        }
      }
      var isInteractive = tagLower === 'button' || tagLower === 'a' || tagLower === 'input'
        || tagLower === 'textarea' || tagLower === 'select' || tagLower === 'option';
      var hasId = !!el.id;
      var isStructural = !!STRUCT_TAGS[tag];

      var hasValue = (tagLower === 'input' || tagLower === 'textarea' || tagLower === 'select') && el.value;
      var inlineStyle = el.getAttribute('style') || '';
      var hasStyle = STYLE_RE.test(inlineStyle);
      var computedPos = getComputedStyle(el).position;
      var isFixedOrAbsolute = computedPos === 'fixed' || computedPos === 'absolute';
      if (isStructural && !hasText && !isInteractive && !hasId && !hasValue && !hasStyle && !isFixedOrAbsolute) return null;

      var existingIdx = el.getAttribute('data-pilot-idx');
      var elementIdx;
      if (existingIdx !== null) {
        elementIdx = parseInt(existingIdx);
      } else {
        elementIdx = maxIdx++;
        el.setAttribute('data-pilot-idx', elementIdx);
      }
      window.__pilot_elements[elementIdx] = el;

      var entry = { tag: tagLower, idx: elementIdx, _pos: computedPos };
      if (el.id) entry.id = el.id;
      /** select 的 text 是第一个 option 的文本，无意义；已用 value+options 替代 */
      if (txt && tagLower !== 'select') entry.text = txt;
      if (hasStyle) entry.style = inlineStyle.slice(0, 80);

      if (isInteractive) {
        var cls = (el.className || '').toLowerCase();
        if (STATE_RE.test(cls)) {
          var match = cls.match(STATE_EXTRACT_RE);
          if (match) entry.state = match[1];
        }
      }

      if (tagLower === 'input' || tagLower === 'textarea' || tagLower === 'select') {
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) entry.checked = true;
          entry.type = el.type;
          /** 从父元素 <label> 提取文本作为标签 */
          if (el.parentElement && el.parentElement.tagName === 'LABEL') {
            var labelText = el.parentElement.textContent.trim().slice(0, 40);
            if (labelText) entry.label = labelText;
          }
        } else if (tagLower === 'select') {
          var selOpt = el.options[el.selectedIndex];
          if (selOpt) entry.value = selOpt.text.slice(0, 60);
          /** 收集所有 option 的显示文本（AI 用 selectValueByText 搜索的是 text） */
          if (el.options.length > 0 && el.options.length <= 10) {
            var opts = [];
            for (var oi = 0; oi < el.options.length; oi++) {
              opts.push(el.options[oi].text);
            }
            entry.options = opts;
          }
        } else {
          if (el.value) entry.value = el.value.slice(0, 60);
          if (el.placeholder) entry.placeholder = el.placeholder.slice(0, 60);
          if (el.checked) entry.checked = true;
          if (el.type && el.type !== 'text' && el.type !== 'textarea') entry.type = el.type;
          /** range 输入采集 min/max，帮助 AI 理解滑块范围 */
          if (el.type === 'range') {
            if (el.min) entry.min = el.min;
            if (el.max) entry.max = el.max;
          }
        }
      }
      if (tagLower === 'option' && el.selected) entry.selected = true;
      if (el.disabled) entry.disabled = true;
      if (el.getAttribute('aria-label')) entry.aria = el.getAttribute('aria-label').slice(0, 40);

      var sf = el.getAttribute('data-v-pilot-file');
      if (sf && (hasText || isInteractive || hasValue || hasStyle)) {
        if (sf.indexOf('App.vue') === -1) {
          /** 子组件：输出 src（最后两级路径）+ line */
          var parts = sf.split('/');
          entry.src = parts.length >= 2 ? parts.slice(-2).join('/') : sf;
          var sl = el.getAttribute('data-v-pilot-line');
          if (sl) entry.line = parseInt(sl);
        } else {
          /** App.vue 根组件：只输出 line，不输出 src（减少 token，AI 可从上下文推断） */
          var sl = el.getAttribute('data-v-pilot-line');
          if (sl) entry.line = parseInt(sl);
        }
      }

      return entry;
    }

    /** 单遍遍历：按 DOM 顺序采集元素，fixed/absolute 标记为高优先级（不被截断） */
    var normalElements = [];
    var priorityElements = [];
    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      var entry = processElement(el);
      if (!entry) continue;
      if ((entry._pos === 'fixed' || entry._pos === 'absolute') && priorityElements.length < 20) {
        entry.floating = true;
        priorityElements.push(entry);
      } else if (normalElements.length < 500) {
        normalElements.push(entry);
      }
    }

    /** 合并：priority 元素放末尾（覆盖层在视觉上最上层） */
    var visibleElements = normalElements.concat(priorityElements);

    /** 合并连续的纯样式元素（如颜色色块）为一个条目 */
    var merged = [];
    var ei = 0;
    while (ei < visibleElements.length) {
      var cur = visibleElements[ei];
      if (cur.style && !cur.text && !cur.id && !cur.value && !cur.placeholder) {
        var group = [cur];
        var ej = ei + 1;
        while (ej < visibleElements.length
          && visibleElements[ej].tag === cur.tag
          && visibleElements[ej].style
          && !visibleElements[ej].text
          && !visibleElements[ej].id) {
          group.push(visibleElements[ej]);
          ej++;
        }
        if (group.length > 1) {
          var prop = cur.style.split(':')[0];
          merged.push({ tag: cur.tag, count: group.length, style: prop });
          ei = ej;
          continue;
        }
      }
      merged.push(cur);
      ei++;
    }

    /** 合并后截断到 300 个有效元素（适应复杂页面，compact 模式会进一步压缩） */
    if (merged.length > 300) merged = merged.slice(0, 300);

    /** 移除内部辅助字段 _pos（仅用于遍历阶段的 fixed/absolute 检测） */
    for (var mi = 0; mi < merged.length; mi++) { delete merged[mi]._pos; }

    var result = {
      t: timestamp,
      url: url,
      title: title,
      els: merged,
      errors: window.__pilot_errorCount || 0,
      lastErrors: (window.__pilot_errorCount > 0 && window.__pilot_lastErrors) ? window.__pilot_lastErrors : undefined
    };
    /** 缓存 snapshot 结果，供 DOM 不稳定时 fallback 使用 */
    window.__pilot_lastSnapshot = result;
    return result;
  };

  /** 注入 highlight 动画 keyframes（仅注入一次） */
  var _highlightStyleInjected = false;
  function ensureHighlightStyle() {
    if (_highlightStyleInjected) return;
    _highlightStyleInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '@keyframes __pilot-corner-in{' +
        '0%{opacity:0;transform:scale(1.8)}' +
        '60%{opacity:1}' +
        '100%{opacity:1;transform:scale(1)}' +
      '}';
    document.head.appendChild(style);
  }

  /** 创建单个 L 形角标 */
  function createCorner(position) {
    var corner = document.createElement('div');
    var size = 10;
    var thickness = 2;
    var styles = {
      'position': 'absolute',
      'width': size + 'px',
      'height': size + 'px',
      'pointer-events': 'none',
    };
    if (position === 'tl') {
      styles.top = '0'; styles.left = '0';
      styles.borderTop = thickness + 'px solid rgba(59,130,246,0.9)';
      styles.borderLeft = thickness + 'px solid rgba(59,130,246,0.9)';
    } else if (position === 'tr') {
      styles.top = '0'; styles.right = '0';
      styles.borderTop = thickness + 'px solid rgba(59,130,246,0.9)';
      styles.borderRight = thickness + 'px solid rgba(59,130,246,0.9)';
    } else if (position === 'bl') {
      styles.bottom = '0'; styles.left = '0';
      styles.borderBottom = thickness + 'px solid rgba(59,130,246,0.9)';
      styles.borderLeft = thickness + 'px solid rgba(59,130,246,0.9)';
    } else {
      styles.bottom = '0'; styles.right = '0';
      styles.borderBottom = thickness + 'px solid rgba(59,130,246,0.9)';
      styles.borderRight = thickness + 'px solid rgba(59,130,246,0.9)';
    }
    for (var k in styles) corner.style[k] = styles[k];
    return corner;
  }

  /** 等待元素滚动完成（scrollend 或 500ms fallback），然后执行回调 */
  function waitForScrollEnd(el, cb) {
    if ('onscrollend' in el) {
      el.addEventListener('scrollend', cb, { once: true });
      setTimeout(cb, 500);
    } else {
      setTimeout(cb, 350);
    }
  }

  /** 在目标元素上显示聚焦锁定动效（四角 L 形角标从外向内收缩 + 蓝色虚线边框，跟随元素位置，1.5s 后淡出移除）
   *  先显示半透明边框跟随滚动，滚动完成后再播放角标锁定动画
   *  用 ResizeObserver + scroll 事件跟踪元素位置变化，高亮消失时自动断开 observer
   *  由 __PILOT_HIGHLIGHT__ 配置控制是否启用 */
  function highlightElement(el) {
    if (!__PILOT_HIGHLIGHT__) return;
    ensureHighlightStyle();

    /** 外层容器：半透明背景 + 虚线边框（滚动期间可见） */
    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;z-index:2147483640;pointer-events:none;' +
      'border:2px dashed rgba(59,130,246,0.5);background:rgba(59,130,246,0.06);' +
      'border-radius:2px;transition:opacity 0.3s ease;';
    document.body.appendChild(overlay);

    /** 四角角标容器（初始隐藏，滚动完成后显示） */
    var cornerWrap = document.createElement('div');
    cornerWrap.style.cssText =
      'position:fixed;z-index:2147483641;pointer-events:none;opacity:0;';
    cornerWrap.appendChild(createCorner('tl'));
    cornerWrap.appendChild(createCorner('tr'));
    cornerWrap.appendChild(createCorner('bl'));
    cornerWrap.appendChild(createCorner('br'));
    document.body.appendChild(cornerWrap);

    /** 更新 overlay 和角标位置 */
    function updatePosition() {
      var rect = el.getBoundingClientRect();
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      cornerWrap.style.top = rect.top + 'px';
      cornerWrap.style.left = rect.left + 'px';
      cornerWrap.style.width = rect.width + 'px';
      cornerWrap.style.height = rect.height + 'px';
    }

    var resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(el);
    window.addEventListener('scroll', updatePosition, true);
    updatePosition();

    /** 滚动完成后播放角标锁定动画 */
    waitForScrollEnd(el, function() {
      updatePosition();
      cornerWrap.style.animation = '__pilot-corner-in 0.4s ease-out forwards';
    });

    /** 角标动画结束后开始倒计时淡出 */
    setTimeout(function() {
      overlay.style.opacity = '0';
      cornerWrap.style.opacity = '0';
      cornerWrap.style.transition = 'opacity 0.3s ease';
      setTimeout(function() {
        resizeObserver.disconnect();
        window.removeEventListener('scroll', updatePosition, true);
        overlay.remove();
        cornerWrap.remove();
      }, 300);
    }, 1800);
  }

  /** 按索引获取元素并滚动到视口居中（所有 idx 操作函数的统一入口）
   *  返回 { el, idx } 或错误字符串，操作函数只需检查返回值即可 */
  function operateByIndex(i) {
    var el = window.__pilot_elements[i];
    if (!el) return { error: 'Element ' + i + ' not found' };
    if (!el.isConnected) return { error: 'Element ' + i + ' disconnected from DOM' };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(el);
    return { el: el, idx: i };
  }

  /** 按文本匹配元素并滚动到视口居中（所有文本操作函数的统一入口）
   *  返回 { el, idx, label } 或错误字符串 */
  function operateByLabel(text, nth, opts) {
    var result = findByLabel(text, nth, opts);
    if (result.error) return result;
    var t = result.target;
    if (t.el.disabled) return { error: 'Element ' + t.idx + ' "' + t.label + '" is disabled' };
    t.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(t.el);
    return { el: t.el, idx: t.idx, label: t.label };
  }

  /** 点击指定索引的元素（使用 MouseEvent dispatchEvent 兼容 Vue 3 事件委托）
   *  checkbox/radio 使用 checked toggle + input/change 事件（兼容 label 包裹和 Vue v-model）
   */
  window.__pilot_click = function(i) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    var el = r.el;
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    var label = (el.textContent || '').trim().slice(0, 30);
    return label ? 'Clicked ' + el.tagName + '#' + r.idx + ' "' + label + '"' : 'Clicked ' + el.tagName + '#' + r.idx;
  };

  /** 双击指定索引的元素（触发 Vue @dblclick 事件处理） */
  window.__pilot_dblclick = function(i) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    r.el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    var label = (r.el.textContent || '').trim().slice(0, 30);
    return label ? 'DblClicked ' + r.el.tagName + '#' + r.idx + ' "' + label + '"' : 'DblClicked ' + r.el.tagName + '#' + r.idx;
  };

  /** 判断 input 是否为非文本类型（date/color/range/file/time/month/week/datetime-local 等）
   *  这些类型需要同时 dispatch input + change 事件才能兼容 Vue 3 v-model */
  var CHANGE_INPUT_TYPES = { date:1, color:1, range:1, file:1, time:1, month:1, week:1, 'datetime-local':1 };
  function isChangeInputType(el) {
    return el.tagName === 'INPUT' && CHANGE_INPUT_TYPES[el.type];
  }

  /** 设置 input/textarea 的值（兼容 Vue v-model）
   *  文本类 input 使用 InputEvent，非文本类（date/color/range 等）使用 change 事件
   *  用法: __pilot_setValue(i, value) — 默认 blur
   *  用法: __pilot_setValue(i, value, true) — 不 blur（编辑框内连续操作）
   */
  window.__pilot_setValue = function(i, value, noBlur) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    var el = r.el;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      return 'Element ' + r.idx + ' is not an input';
    }
    el.focus();
    el.value = value;
    if (isChangeInputType(el)) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true,
        data: value, inputType: 'insertText'
      }));
    }
    if (!noBlur) el.blur();
    return 'Set ' + el.tagName + '#' + r.idx + ' to "' + value + '"';
  };

  /** 设置 select 的选中值（兼容 Vue v-model — 必须触发 change 事件） */
  window.__pilot_selectValue = function(i, value) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    if (r.el.tagName !== 'SELECT') {
      return 'Element ' + r.idx + ' is not a select';
    }
    r.el.value = value;
    r.el.dispatchEvent(new Event('change', { bubbles: true }));
    var opt = r.el.options[r.el.selectedIndex];
    return 'Selected "' + (opt ? opt.text : value) + '" in SELECT#' + r.idx;
  };

  /** 在指定元素上触发键盘事件（兼容 Vue @keydown/@keyup 事件处理） */
  window.__pilot_keydown = function(i, key, opts) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    var o = opts || {};
    r.el.dispatchEvent(new KeyboardEvent('keydown', {
      key: key, code: o.code || key, bubbles: true, cancelable: true,
      ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta
    }));
    r.el.dispatchEvent(new KeyboardEvent('keyup', {
      key: key, code: o.code || key, bubbles: true, cancelable: true,
      ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta
    }));
    return 'Keydown "' + key + '" on ' + r.el.tagName + '#' + r.idx;
  };

  /** 按文本内容查找元素并触发键盘事件（合并 findByText + keydown 的一步操作）
   *  用法: __pilot_keydownByText("输入新任务...", "Enter")
   *  用法: __pilot_keydownByText("描述", "Escape", {ctrl: true})
   */
  window.__pilot_keydownByText = function(text, key, opts) {
    if (!text || !text.trim()) return 'Empty search text';
    var results = __pilot_findByText(text);
    if (typeof results === 'string') return results;
    if (results.length === 0) return 'No element found with text "' + text + '"';
    var target = results[0];
    return __pilot_keydown(target.idx, key, opts);
  };

  /** 按文本内容查找元素（搜索 textContent、placeholder、value、aria-label、select option、parent LABEL）
   *  结果按相关性排序：精确匹配 > 前缀匹配 > 包含匹配，交互元素优先于结构元素
   *  未找到时自动刷新元素引用（新增 DOM 元素可能尚未注册）
   *  用法: __pilot_findByText("提交") → [{idx:67, tag:"button", text:"提交"}]
   *  用法: __pilot_findByText("姓名") → [{idx:62, tag:"input", via:"placeholder"}]
   *  用法: __pilot_findByText("高优先级") → [{idx:63, tag:"select", via:"option"}]
   */
  function searchByText(tLower) {
    var results = [];
    for (var k in window.__pilot_elements) {
      var el = window.__pilot_elements[k];
      var tag = el.tagName;
      var tagLower = tag.toLowerCase();
      var label = (el.textContent || '').trim().slice(0, 50);
      var via = '';
      var score = 0;
      /** SELECT 标签优先匹配 option 文本（textContent 是所有 option 拼接，匹配不准确） */
      if (tag === 'SELECT') {
        var optTexts = [];
        for (var oi = 0; oi < el.options.length; oi++) optTexts.push(el.options[oi].text);
        var optMatch = optTexts.filter(function(t) { return t.toLowerCase().indexOf(tLower) !== -1; });
        if (optMatch.length > 0) { label = optMatch.join(', '); via = 'option'; score = 50; }
      }
      if (!via && label.toLowerCase().indexOf(tLower) !== -1) {
        via = 'text';
        score = label.toLowerCase() === tLower ? 100 : label.toLowerCase().indexOf(tLower) === 0 ? 80 : 50;
      } else if ((el.placeholder || '').toLowerCase().indexOf(tLower) !== -1) {
        via = 'placeholder'; label = (el.placeholder || '').trim().slice(0, 50);
        score = label.toLowerCase() === tLower ? 100 : label.toLowerCase().indexOf(tLower) === 0 ? 80 : 50;
      } else if ((el.value || '').slice(0, 50).toLowerCase().indexOf(tLower) !== -1) {
        via = 'value'; label = (el.value || '').trim().slice(0, 50);
        score = label.toLowerCase() === tLower ? 100 : label.toLowerCase().indexOf(tLower) === 0 ? 80 : 50;
      } else if ((el.getAttribute('aria-label') || '').toLowerCase().indexOf(tLower) !== -1) {
        via = 'aria'; label = (el.getAttribute('aria-label') || '').trim().slice(0, 50);
        score = label.toLowerCase() === tLower ? 100 : label.toLowerCase().indexOf(tLower) === 0 ? 80 : 50;
      }
      /** input/select/textarea 搜索父元素 <label> 的文本 */
      if (!via && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && el.parentElement && el.parentElement.tagName === 'LABEL') {
        var parentText = (el.parentElement.textContent || '').trim().slice(0, 50);
        if (parentText.toLowerCase().indexOf(tLower) !== -1) {
          via = 'label'; label = parentText;
          score = parentText.toLowerCase() === tLower ? 100 : parentText.toLowerCase().indexOf(tLower) === 0 ? 80 : 50;
        }
      }
      if (via) {
        /** 交互元素加分，结构元素降权 */
        if (tagLower === 'button' || tagLower === 'a' || tagLower === 'input' || tagLower === 'select' || tagLower === 'textarea') score += 20;
        if (/^H[1-6]$/.test(tag) || tagLower === 'p' || tagLower === 'div') score -= 20;
        results.push({ idx: parseInt(k), tag: tagLower, text: label, via: via, score: score });
      }
    }
    return results;
  }

  window.__pilot_findByText = function(text) {
    if (!text || !text.trim()) return 'Empty search text';
    var tLower = text.toLowerCase();
    var results = searchByText(tLower);
    if (results.length === 0 && window.__pilot_snapshot) {
      /** 轻量检查：DOM 元素数量未变化时跳过完整 snapshot（避免不存在的文本触发 ~100ms 开销） */
      var currentCount = document.body.querySelectorAll('*').length;
      if (currentCount !== window.__pilot_lastElementCount) {
        window.__pilot_lastElementCount = currentCount;
        window.__pilot_snapshot();
        results = searchByText(tLower);
      }
    }
    if (results.length === 0) return 'No element found with text "' + text + '"';
    results.sort(function(a, b) { return b.score - a.score || a.idx - b.idx; });
    return results;
  };

  /** 按文本内容点击元素（仅匹配 textContent，优先精确匹配 + 交互元素）
   *  用法: __pilot_clickByText("添加") — 点击文本为"添加"的按钮
   *  用法: __pilot_clickByText("重置", 1) — 点击第 2 个匹配（0-indexed）
   */
  /** 获取元素的文本标签（含父 LABEL 回退） */
  function getElementLabel(el) {
    var label = (el.textContent || '').trim().slice(0, 50);
    if (!label && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') && el.parentElement && el.parentElement.tagName === 'LABEL') {
      label = (el.parentElement.textContent || '').trim().slice(0, 50);
    }
    return label;
  }

  /** 通用文本匹配：搜索元素标签文本，支持标签过滤和 disabled 检查
   *  返回匹配的目标元素，或错误字符串
   *  opts.filterTag — 仅匹配指定 tagName 的元素（如 'INPUT' 过滤 checkbox）
   *  opts.boostTags — 额外加分的标签集合（如 CLICKABLE）
   *  opts.typeName — 错误消息中的元素类型名（如 'checkbox'）
   */
  var CLICKABLE = { BUTTON:1, A:1, INPUT:1, SUMMARY:1, DETAILS:1 };
  function findByLabel(text, nth, opts) {
    if (!text || !text.trim()) return { error: 'Empty search text' };
    var n = nth || 0;
    var tLower = text.toLowerCase();
    var filterTag = opts.filterTag;
    var boostTags = opts.boostTags;
    function find() {
      var matches = [];
      for (var k in window.__pilot_elements) {
        var el = window.__pilot_elements[k];
        if (filterTag && el.type !== filterTag && el.type !== 'radio') continue;
        var label = getElementLabel(el);
        var labelLower = label.toLowerCase();
        var score = -1;
        if (labelLower === tLower) score = 100;
        else if (labelLower.indexOf(tLower) === 0) score = 80;
        else if (labelLower.indexOf(tLower) !== -1) score = 50;
        if (score > 0) {
          if (boostTags && boostTags[el.tagName]) score += 10;
          matches.push({ idx: parseInt(k), el: el, label: label, score: score });
        }
      }
      return matches;
    }
    var matches = find();
    if (matches.length === 0 && window.__pilot_snapshot) { window.__pilot_snapshot(); matches = find(); }
    if (matches.length === 0) return { error: 'No ' + (opts.typeName || 'element') + ' found with text "' + text + '"' };
    matches.sort(function(a, b) { return b.score - a.score || a.idx - b.idx; });
    if (n >= matches.length) {
      var hint = matches.slice(0, 8).map(function(m) { return '#' + m.idx + ' "' + m.label + '"'; }).join(' | ');
      return { error: 'Only ' + matches.length + ' ' + (opts.typeName || '') + ' matches for "' + text + '", nth=' + n + ' out of range: ' + hint };
    }
    return { target: matches[n] };
  }

  window.__pilot_clickByText = function(text, nth) {
    var r = operateByLabel(text, nth, { boostTags: CLICKABLE });
    if (r.error) return r.error;
    if (r.el.type === 'checkbox' || r.el.type === 'radio') {
      r.el.checked = !r.el.checked;
      r.el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      r.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    return 'Clicked ' + r.el.tagName + '#' + r.idx + ' "' + r.label + '"';
  };

  /** 按文本双击元素（复用 findByLabel 匹配逻辑）
   *  用法: __pilot_dblclickByText("任务名") — 双击文本匹配的元素
   */
  window.__pilot_dblclickByText = function(text, nth) {
    var r = operateByLabel(text, nth, { boostTags: CLICKABLE });
    if (r.error) return r.error;
    r.el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return 'DblClicked ' + r.el.tagName + '#' + r.idx + ' "' + r.label + '"';
  };

  /** 按 placeholder 查找 input/textarea 并设置值
   *  用法: __pilot_setValueByPlaceholder("姓名", "张三")
   *  用法: __pilot_setValueByPlaceholder("姓名", "张三", 1) — 第 2 个匹配
   */
  window.__pilot_setValueByPlaceholder = function(ph, value, nth) {
    var tLower = ph.toLowerCase();
    var n = nth || 0;
    function findAll() {
      var matches = [];
      for (var k in window.__pilot_elements) {
        var el = window.__pilot_elements[k];
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && (el.placeholder || '').toLowerCase().indexOf(tLower) !== -1) {
          matches.push(el);
        }
      }
      return matches;
    }
    var matches = findAll();
    if (matches.length === 0 && window.__pilot_snapshot) { window.__pilot_snapshot(); matches = findAll(); }
    if (matches.length === 0) return 'No input found with placeholder "' + ph + '"';
    if (n >= matches.length) return 'No input found with placeholder "' + ph + '" (nth=' + n + ', only ' + matches.length + ' matches)';
    var el = matches[n];
    var matchHint = matches.length > 1 ? ' (' + matches.length + ' matches, nth=' + n + ')' : '';
    var idx = el.getAttribute('data-pilot-idx');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(el);
    el.focus();
    el.value = value;
    if (isChangeInputType(el)) {
      /** 非文本类型（date/color/range 等）：同时 dispatch input + change 兼容 Vue 3 v-model */
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }));
    }
    el.blur();
    return 'Set ' + el.tagName + '#' + idx + ' to "' + value + '"' + matchHint;
  };

  /** 按 option 文本查找 select 并选中
   *  用法: __pilot_selectValueByText("高优先级")
   *  用法: __pilot_selectValueByText("设计", 1) — 第 2 个匹配的 select
   */
  window.__pilot_selectValueByText = function(optionText, nth) {
    var tLower = optionText.toLowerCase();
    var n = nth || 0;
    function findAll() {
      var matches = [];
      for (var k in window.__pilot_elements) {
        var el = window.__pilot_elements[k];
        if (el.tagName === 'SELECT') {
          for (var oi = 0; oi < el.options.length; oi++) {
            if (el.options[oi].text.toLowerCase().indexOf(tLower) !== -1) {
              matches.push(el);
              break;
            }
          }
        }
      }
      return matches;
    }
    var matches = findAll();
    if (matches.length === 0 && window.__pilot_snapshot) { window.__pilot_snapshot(); matches = findAll(); }
    if (matches.length === 0) return 'No select found with option "' + optionText + '"';
    if (n >= matches.length) return 'No select found with option "' + optionText + '" (nth=' + n + ', only ' + matches.length + ' matches)';
    var el = matches[n];
    var matchHint = matches.length > 1 ? ' (' + matches.length + ' matches, nth=' + n + ')' : '';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(el);
    /** 重新遍历 options 设置 value（findAll 返回后 DOM 可能因 snapshot 刷新而变化） */
    for (var oi = 0; oi < el.options.length; oi++) {
      if (el.options[oi].text.toLowerCase().indexOf(tLower) !== -1) {
        el.value = el.options[oi].value;
        break;
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'Selected "' + el.options[el.selectedIndex].text + '" in SELECT#' + el.getAttribute('data-pilot-idx') + matchHint;
  };

  /** 勾选指定索引的 checkbox/radio（始终 checked，非 toggle）
   *  用法: __pilot_check(68)
   */
  window.__pilot_check = function(i) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    if (r.el.type !== 'checkbox' && r.el.type !== 'radio') return 'Element ' + r.idx + ' is not a checkbox/radio';
    r.el.checked = true;
    r.el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'Checked ' + r.el.tagName + '#' + r.idx;
  };

  /** 取消勾选指定索引的 checkbox/radio（始终 unchecked，非 toggle）
   *  用法: __pilot_uncheck(68)
   */
  window.__pilot_uncheck = function(i) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    if (r.el.type !== 'checkbox' && r.el.type !== 'radio') return 'Element ' + r.idx + ' is not a checkbox/radio';
    r.el.checked = false;
    r.el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'Unchecked ' + r.el.tagName + '#' + r.idx;
  };

  /** 按文本勾选 checkbox/radio（始终 checked，不受之前状态影响）
   *  用法: __pilot_checkByText("Vue") — 勾选 Vue 标签
   *  用法: __pilot_checkByText("我同意条款") — 勾选同意条款
   */
  window.__pilot_checkByText = function(text, nth) {
    var r = operateByLabel(text, nth, { filterTag: 'checkbox', typeName: 'checkbox' });
    if (r.error) return r.error;
    r.el.checked = true;
    r.el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'Checked ' + r.el.tagName + '#' + r.idx + ' "' + r.label + '"';
  };

  /** 按文本取消勾选 checkbox/radio（始终 unchecked，不受之前状态影响）
   *  用法: __pilot_uncheckByText("Vue")
   */
  window.__pilot_uncheckByText = function(text, nth) {
    var r = operateByLabel(text, nth, { filterTag: 'checkbox', typeName: 'checkbox' });
    if (r.error) return r.error;
    r.el.checked = false;
    r.el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'Unchecked ' + r.el.tagName + '#' + r.idx + ' "' + r.label + '"';
  };

  /** 异步等待指定毫秒数（仅在 async exec 中使用）
   *  用法: await __pilot_wait(100)
   */
  window.__pilot_wait = function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  };

  /** 异步等待指定文本出现在 DOM 中（轮询 snapshot 直到匹配或超时）
   *  比 __pilot_wait 更可靠：不需要猜测等待时间，条件满足即返回
   *  用法: await __pilot_waitFor("操作成功") — 默认超时 5s
   *  用法: await __pilot_waitFor("新评论", 10000) — 自定义超时 10s
   *  用法: await __pilot_waitFor("加载中", 3000, true) — 等待文本消失
   */
  window.__pilot_waitFor = function(text, timeout, waitForDisappear) {
    var ms = timeout || 5000;
    var disappear = !!waitForDisappear;
    var tLower = text.toLowerCase();

    /** 轻量文本搜索（不触发完整 snapshot，仅遍历已有元素引用） */
    function searchExisting() {
      var found = false;
      for (var k in window.__pilot_elements) {
        var el = window.__pilot_elements[k];
        if (el.offsetParent === null) continue;
        var label = getElementLabel(el);
        if (disappear) {
          if (label.toLowerCase() === tLower) { found = true; break; }
        } else {
          if (label.toLowerCase().indexOf(tLower) !== -1) { found = true; break; }
        }
        if ((el.placeholder || '').toLowerCase().indexOf(tLower) !== -1) { found = true; break; }
        if ((el.value || '').toLowerCase().indexOf(tLower) !== -1) { found = true; break; }
      }
      return found;
    }

    return new Promise(function(resolve) {
      /** 立即检查一次（条件可能已经满足） */
      window.__pilot_snapshot();
      if (disappear ? !searchExisting() : searchExisting()) {
        resolve(disappear ? 'Disappeared: "' + text + '"' : 'Found: "' + text + '"');
        return;
      }

      /** 用 MutationObserver 监听 DOM 变化，变化后立即轻量搜索（无需完整 snapshot） */
      var observer = new MutationObserver(function() {
        if (disappear ? !searchExisting() : searchExisting()) {
          observer.disconnect();
          clearTimeout(fallbackTimer);
          resolve(disappear ? 'Disappeared: "' + text + '"' : 'Found: "' + text + '"');
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      /** fallback：MutationObserver 可能遗漏（React 不走 DOM mutation），200ms 轮询兜底 */
      var fallbackTimer = setInterval(function() {
        if (disappear ? !searchExisting() : searchExisting()) {
          observer.disconnect();
          clearTimeout(fallbackTimer);
          resolve(disappear ? 'Disappeared: "' + text + '"' : 'Found: "' + text + '"');
        }
      }, 200);

      /** 超时清理 */
      setTimeout(function() {
        observer.disconnect();
        clearTimeout(fallbackTimer);
        resolve(disappear ? 'Timeout (text still present)' : 'Timeout (text not found)');
      }, ms);
    });
  };

  /** 异步等待指定文本的元素变为可交互状态（disabled 移除）
   *  比 __pilot_wait 更可靠：不需要猜测等待时间，条件满足即返回
   *  用法: await __pilot_waitEnabled("提交") — 等待"提交"按钮从 disabled 变为可用
   *  用法: await __pilot_waitEnabled("下一步", 10000) — 自定义超时 10s
   */
  window.__pilot_waitEnabled = function(text, timeout) {
    var ms = timeout || 5000;
    var tLower = text.toLowerCase();

    function checkEnabled() {
      var results = searchByText(tLower);
      for (var ri = 0; ri < results.length; ri++) {
        var el = window.__pilot_elements[results[ri].idx];
        if (el && !el.disabled) return true;
      }
      return false;
    }

    return new Promise(function(resolve) {
      if (checkEnabled()) { resolve('Enabled: "' + text + '"'); return; }

      /** MutationObserver 监听属性变化（disabled 移除），立即检查 */
      var observer = new MutationObserver(function() {
        if (checkEnabled()) {
          observer.disconnect();
          clearTimeout(fallbackTimer);
          resolve('Enabled: "' + text + '"');
        }
      });
      observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['disabled'] });

      /** fallback：200ms 轮询兜底 */
      var fallbackTimer = setInterval(function() {
        if (checkEnabled()) {
          observer.disconnect();
          clearTimeout(fallbackTimer);
          resolve('Enabled: "' + text + '"');
        }
      }, 200);

      setTimeout(function() {
        observer.disconnect();
        clearTimeout(fallbackTimer);
        resolve('Timeout (element still disabled)');
      }, ms);
    });
  };

  /** 批量勾选 checkbox/radio（自动在每次勾选间 yield，解决 Vue 3 reactivity 竞态）
   *  Vue 3 的 v-model array checkbox 在连续同步 change 事件中会丢失第一个的状态，
   *  需要 await __pilot_wait(0) 让 Vue scheduler 处理每个 change 后再继续。
   *  用法: await __pilot_checkMultipleByText(["Vue", "TypeScript", "Vite"])
   */
  window.__pilot_checkMultipleByText = function(texts) {
    var results = [];
    var pending = [];
    for (var i = 0; i < texts.length; i++) {
      (function(idx) {
        var promise;
        if (idx > 0) {
          promise = __pilot_wait(0).then(function() {
            var r = __pilot_checkByText(texts[idx]);
            results.push(r);
          });
        } else {
          var r = __pilot_checkByText(texts[idx]);
          results.push(r);
          promise = Promise.resolve();
        }
        pending.push(promise);
      })(i);
    }
    return Promise.all(pending).then(function() { return results; });
  };

  /** 在 input/textarea 中输入文本并触发回车（自动处理 Vue 3 reactivity 批处理）
   *  组合了 setValueByPlaceholder + wait(0) + keydownByText，一步完成输入+提交
   *  Vue 3 的 reactivity 批处理会导致连续同步事件中 @keyup.enter 读到旧值，
   *  await __pilot_wait(0) 让 Vue scheduler 在两次事件间处理响应式更新
   *  用法: await __pilot_typeByPlaceholder("输入标签后回车", "TestTag")
   *  用法: await __pilot_typeByPlaceholder("输入新任务...", "买牛奶")
   */
  window.__pilot_typeByPlaceholder = function(ph, value) {
    var r = __pilot_setValueByPlaceholder(ph, value);
    if (typeof r === 'string' && r.indexOf('No input found') === 0) {
      return Promise.resolve([r]);
    }
    return __pilot_wait(0).then(function() {
      var kr = __pilot_keydownByText(ph, 'Enter');
      return [r, kr];
    });
  };

  /** 在指定元素中输入文本并触发回车（基于 idx）
   *  用法: await __pilot_type(48, "买牛奶")
   */
  window.__pilot_type = function(i, value) {
    var r = __pilot_setValue(i, value);
    if (typeof r === 'string' && (r.indexOf('not found') !== -1 || r.indexOf('not an input') !== -1)) {
      return Promise.resolve([r]);
    }
    return __pilot_wait(0).then(function() {
      var kr = __pilot_keydown(i, 'Enter');
      return [r, kr];
    });
  };

  /** 滚动指定元素到视口内（支持 align 参数控制对齐方式）
   *  用法: __pilot_scrollIntoView(100) — 滚动到元素 100（默认 center）
   *  用法: __pilot_scrollIntoView(100, "start") — 滚动到元素顶部对齐视口顶部
   */
  window.__pilot_scrollIntoView = function(i, align) {
    var el = window.__pilot_elements[i];
    if (!el) return 'Element ' + i + ' not found';
    if (!el.isConnected) return 'Element ' + i + ' disconnected from DOM';
    el.scrollIntoView({ behavior: 'smooth', block: align || 'center' });
    var rect = el.getBoundingClientRect();
    return 'Scrolled to ' + el.tagName + '#' + i + ' (y=' + Math.round(rect.y) + ', h=' + Math.round(rect.height) + ')';
  };

  /** 在指定元素上触发 hover 事件（兼容 Vue @mouseenter 事件处理）
   *  用法: __pilot_hover(100)
   */
  window.__pilot_hover = function(i) {
    var r = operateByIndex(i);
    if (r.error) return r.error;
    r.el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
    r.el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    var label = (r.el.textContent || '').trim().slice(0, 30);
    return label ? 'Hovered ' + r.el.tagName + '#' + r.idx + ' "' + label + '"' : 'Hovered ' + r.el.tagName + '#' + r.idx;
  };

  /** 获取指定元素的位置和尺寸信息（用于布局调试）
   *  用法: __pilot_getRect(100) → {x, y, width, height, top, right, bottom, left, visible}
   */
  window.__pilot_getRect = function(i) {
    var el = window.__pilot_elements[i];
    if (!el) return 'Element ' + i + ' not found';
    if (!el.isConnected) return 'Element ' + i + ' disconnected from DOM';
    var rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      visible: rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0
    };
  };

})();
`
