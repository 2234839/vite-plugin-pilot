/**
 * 元素选择器客户端代码（字符串形式，用于注入到浏览器）
 *
 * 功能：
 * 1. Alt+Click 激活选择模式
 * 2. 鼠标移动时高亮目标元素，显示覆盖层
 * 3. 覆盖层显示：组件名、文件路径:行号、元素尺寸
 * 4. 点击确认选中，收集元素信息并 POST 到 /__pilot/inspect
 */

export const elementInspectorCode = `
(function() {
  var active = false;
  var currentTarget = null;
  var overlay = null;
  var tooltip = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__pilot-overlay';
    overlay.style.cssText = 'position:fixed;z-index:2147483640;pointer-events:none;border:2px dashed rgba(59,130,246,0.8);background:rgba(59,130,246,0.08);transition:all 0.05s ease;display:none;';
    document.body.appendChild(overlay);

    tooltip = document.createElement('div');
    tooltip.id = '__pilot-tooltip';
    tooltip.style.cssText = 'position:fixed;z-index:2147483641;pointer-events:none;background:rgba(15,23,42,0.92);color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:12px;font-family:monospace;line-height:1.6;max-width:400px;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.3);border:1px solid rgba(59,130,246,0.3);';
    document.body.appendChild(tooltip);
  }

  function getVueComponent(el) {
    var current = el;
    while (current) {
      if (current.__vueParentComponent) return current.__vueParentComponent;
      if (current._vnode && current._vnode.component) return current._vnode.component;
      current = current.parentElement;
    }
    return null;
  }

  function getComponentPath(comp) {
    var parts = [];
    var current = comp;
    while (current) {
      var name = current.type ? (current.type.name || current.type.__name || '') : '';
      if (name) parts.unshift(name);
      current = current.parent;
    }
    return parts.length > 0 ? parts.join(' > ') : '';
  }

  function getComputedStyles(el) {
    var cs = window.getComputedStyle(el);
    return {
      color: cs.color,
      fontSize: cs.fontSize,
      display: cs.display
    };
  }

  function getDomPath(el) {
    var parts = [];
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var tag = current.tagName.toLowerCase();
      var id = current.id ? '#' + current.id : '';
      var cls = current.className && typeof current.className === 'string'
        ? '.' + current.className.trim().split(/\\s+/).slice(0, 2).join('.')
        : '';
      parts.unshift(tag + id + cls);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function showHighlight(el) {
    if (!overlay) createOverlay();

    currentTarget = el;
    var rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    /** 构建 tooltip 内容 */
    var lines = [];
    var comp = getVueComponent(el);
    if (comp) {
      var compName = comp.type ? (comp.type.name || comp.type.__name || '<Anonymous>') : '<Anonymous>';
      lines.push('<span style="color:#60a5fa">' + compName + '</span>');
    } else {
      lines.push('<span style="color:#60a5fa">&lt;' + el.tagName.toLowerCase() + '&gt;</span>');
    }

    var sourceFile = el.getAttribute('data-v-pilot-file');
    var sourceLine = el.getAttribute('data-v-pilot-line');
    if (sourceFile) {
      lines.push('<span style="color:#94a3b8">' + sourceFile + (sourceLine ? ':' + sourceLine : '') + '</span>');
    }

    lines.push('<span style="color:#a78bfa">' + Math.round(rect.width) + ' × ' + Math.round(rect.height) + 'px</span>');

    tooltip.innerHTML = lines.join('<br>');
    tooltip.style.display = 'block';
    tooltip.style.left = (rect.left + rect.width + 8) + 'px';
    tooltip.style.top = rect.top + 'px';

    /** 防止 tooltip 溢出右侧 */
    requestAnimationFrame(function() {
      var tr = tooltip.getBoundingClientRect();
      if (tr.right > window.innerWidth) {
        tooltip.style.left = (rect.left - tr.width - 8) + 'px';
      }
      if (tr.bottom > window.innerHeight) {
        tooltip.style.top = (rect.bottom - tr.height) + 'px';
      }
    });
  }

  function hideHighlight() {
    if (overlay) overlay.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
    currentTarget = null;
  }

  function collectElementInfo(el) {
    var rect = el.getBoundingClientRect();
    var comp = getVueComponent(el);
    var compName = '';
    if (comp && comp.type) {
      compName = comp.type.name || comp.type.__name || '';
    }

    return {
      tagName: el.tagName.toLowerCase(),
      className: el.className && typeof el.className === 'string' ? el.className.trim() : '',
      rect: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left)
      },
      textContent: (el.textContent || '').trim().slice(0, 200),
      sourceFile: el.getAttribute('data-v-pilot-file') || undefined,
      sourceLine: el.getAttribute('data-v-pilot-line') ? parseInt(el.getAttribute('data-v-pilot-line')) : undefined,
      componentName: compName || undefined,
      domPath: getDomPath(el),
      computedStyles: getComputedStyles(el)
    };
  }

  function onAltKeyDown(e) {
    if (e.altKey && !active) {
      active = true;
      document.body.style.cursor = 'crosshair';
    }
  }

  function onAltKeyUp(e) {
    if (!e.altKey && active) {
      active = false;
      hideHighlight();
      document.body.style.cursor = '';
    }
  }

  function onMouseMove(e) {
    if (!active) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== document.body && el !== document.documentElement) {
      showHighlight(el);
    }
  }

  function onClick(e) {
    if (!active || !currentTarget) return;
    e.preventDefault();
    e.stopPropagation();

    var info = collectElementInfo(currentTarget);
    hideHighlight();

    fetch('/__pilot/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pilot-Instance': __pilot_instanceId },
      body: JSON.stringify(info)
    }).catch(function() {});
  }

  document.addEventListener('keydown', onAltKeyDown);
  document.addEventListener('keyup', onAltKeyUp);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
})();
`
