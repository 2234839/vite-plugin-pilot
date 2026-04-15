/**
 * 元素选择器客户端代码（字符串形式，用于注入到浏览器）
 *
 * 功能：
 * 1. 按住 Alt 键激活选择模式，鼠标移动时高亮目标元素（组件名、源码位置、尺寸）
 * 2. Alt+Click 选中元素，弹出输入框+操作按钮面板
 * 3. 用户输入描述后可复制提示词或直接发送给 Claude Code（需启动 channel server）
 * 4. 操作后 8 秒倒计时自动关闭，用户输入可重置倒计时
 */

export const elementInspectorCode = `
(function() {
  var active = false;
  var currentTarget = null;
  var overlay = null;
  var tooltip = null;
  /** 面板打开时保持高亮，忽略 Alt 键松开 */
  var panelOpen = false;
  /** pilot-channel server 地址（Claude Code Channels 功能）
   *  使用 location.hostname 动态获取，兼容 WSL2 等非 localhost 场景 */
  var CHANNEL_URL = 'http://' + location.hostname + ':8789/message';
  /** channel server 健康检查 URL */
  var CHANNEL_HEALTH_URL = 'http://' + location.hostname + ':8789/health';

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
      if (current.parentElement) {
        current = current.parentElement;
      } else {
        /** 穿越 shadow boundary：跳到 shadow host 继续查找 */
        var root = current.getRootNode();
        if (root && root.host) {
          current = root.host;
        } else {
          break;
        }
      }
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
      var tag = current.tagName ? current.tagName.toLowerCase() : '';
      var id = current.id ? '#' + current.id : '';
      var cls = current.className && typeof current.className === 'string'
        ? '.' + current.className.trim().split(/\\s+/).slice(0, 2).join('.')
        : '';
      parts.unshift(tag + id + cls);
      if (current.parentElement) {
        current = current.parentElement;
      } else {
        /** 穿越 shadow boundary：插入标记并跳到 shadow host */
        var root = current.getRootNode();
        if (root && root.host) {
          parts.unshift('shadow-root');
          current = root.host;
        } else {
          break;
        }
      }
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
    /** 仅单独按下 Alt 键时激活选择模式，组合键（Ctrl+Alt、Alt+Shift 等）不触发 */
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !active) {
      active = true;
      document.body.style.cursor = 'crosshair';
    }
    /** Alt 已激活时，出现其他修饰键立即取消（防止 Ctrl+Alt 组合仍高亮） */
    if (active && (e.ctrlKey || e.shiftKey || e.metaKey) && !panelOpen) {
      active = false;
      hideHighlight();
      document.body.style.cursor = '';
    }
  }

  function onAltKeyUp(e) {
    if (!e.altKey && active) {
      active = false;
      /** 面板打开时保持高亮 */
      if (!panelOpen) hideHighlight();
      document.body.style.cursor = '';
    }
  }

  function onMouseMove(e) {
    if (!active) return;
    /** 出现其他修饰键时不高亮（防御性检查） */
    if (e.ctrlKey || e.shiftKey || e.metaKey) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== document.body && el !== document.documentElement) {
      showHighlight(el);
    }
  }

  function onClick(e) {
    if (!active || !currentTarget) return;
    /** 组合键（Ctrl+Click、Shift+Click 等）不触发选择面板 */
    if (e.ctrlKey || e.shiftKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();

    var info = collectElementInfo(currentTarget);
    /** 弹窗存在时保持元素高亮，方便用户对照 */
    active = false;
    document.body.style.cursor = '';

    showPromptPanel(info);
  }

  /** 显示提示词面板：用户输入描述后可复制完整提示词给 agent */
  function showPromptPanel(info) {
    /** 移除已有面板和倒计时 */
    var old = document.getElementById('__pilot-prompt-panel');
    if (old) old.remove();
    if (showPromptPanel._timer) clearTimeout(showPromptPanel._timer);

    var panel = document.createElement('div');
    panel.id = '__pilot-prompt-panel';
    panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483645;background:rgba(15,23,42,0.95);color:#e2e8f0;border-radius:12px;padding:20px;min-width:420px;max-width:520px;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid rgba(59,130,246,0.3);font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;';

    /** 元素信息摘要 */
    var sourceInfo = info.sourceFile
      ? info.sourceFile + (info.sourceLine ? ':' + info.sourceLine : '')
      : info.domPath;
    var compInfo = info.componentName
      ? '  [' + info.componentName + ']'
      : '';

    panel.innerHTML =
      '<div style="margin-bottom:12px;font-size:13px;color:#94a3b8;">__LOCALE_SELECTED__: <span style="color:#60a5fa">' +
        info.tagName + compInfo + '</span> <span style="color:#475569">' + sourceInfo + '</span></div>' +
      '<div style="margin-bottom:12px;font-size:13px;color:#94a3b8;">__LOCALE_TEXT__: <span style="color:#cbd5e1">' +
        (info.textContent || '__LOCALE_EMPTY__').slice(0, 100) + '</span></div>' +
      '<textarea id="__pilot-prompt-input" placeholder="__LOCALE_PLACEHOLDER__" style="width:100%;height:72px;background:rgba(30,41,59,0.8);border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:10px;color:#e2e8f0;font-size:13px;resize:vertical;outline:none;font-family:inherit;box-sizing:border-box;"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">' +
        '<span id="__pilot-prompt-timer" style="font-size:12px;color:#64748b;line-height:28px;margin-right:auto;"></span>' +
        '<button id="__pilot-prompt-send" style="padding:6px 16px;background:#7c3aed;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">__LOCALE_SEND_TO_CLAUDE__</button>' +
        '<button id="__pilot-prompt-copy" style="padding:6px 16px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">__LOCALE_COPY_PROMPT__</button>' +
        '<button id="__pilot-prompt-close" style="padding:6px 16px;background:rgba(51,65,85,0.8);color:#94a3b8;border:none;border-radius:6px;cursor:pointer;font-size:13px;">__LOCALE_CLOSE__</button>' +
      '</div>';

    document.body.appendChild(panel);
    panelOpen = true;

    /** 预检测 channel server 连通性，未连接时禁用发送按钮 */
    var sendBtn = document.getElementById('__pilot-prompt-send');
    fetch(CHANNEL_HEALTH_URL, { signal: AbortSignal.timeout(1500) })
      .then(function() { /* channel server 可用，按钮保持启用 */ })
      .catch(function() {
        if (sendBtn) {
          sendBtn.textContent = '__LOCALE_NOT_CONNECTED__';
          sendBtn.style.background = '#475569';
          sendBtn.style.cursor = 'not-allowed';
          sendBtn.disabled = true;
        }
      });

    /** 聚焦输入框 */
    var textarea = document.getElementById('__pilot-prompt-input');
    var timerSpan = document.getElementById('__pilot-prompt-timer');
    setTimeout(function() { textarea.focus(); }, 50);

    /** 倒计时自动关闭（默认 8 秒，用户交互时重置） */
    var countdown = 8;
    var autoCloseTimer = null;

    function resetAutoClose() {
      countdown = 8;
      if (autoCloseTimer) clearInterval(autoCloseTimer);
      timerSpan.textContent = '';
      autoCloseTimer = setInterval(function() {
        countdown--;
        timerSpan.textContent = countdown + '__LOCALE_CLOSE_IN__';
        if (countdown <= 0) {
          closePanel();
        }
      }, 1000);
    }

    /** 复制后启动倒计时 */
    function startAutoClose() {
      resetAutoClose();
    }

    /** 用户在输入框中输入时重置倒计时 */
    textarea.addEventListener('input', function() {
      if (autoCloseTimer) {
        countdown = 8;
        timerSpan.textContent = '';
      }
    });

    /** 生成提示词文本 */
    function getPromptText() {
      var userDesc = textarea.value.trim();
      var parts = [];
      if (userDesc) parts.push(userDesc);
      parts.push('');
      parts.push('__LOCALE_ELEMENT_INFO__');
      parts.push('__LOCALE_TAG__: ' + info.tagName + (info.className ? '.' + info.className.split(/\\s+/).slice(0, 3).join('.') : ''));
      if (info.componentName) parts.push('__LOCALE_COMPONENT__: ' + info.componentName);
      if (info.sourceFile) parts.push('__LOCALE_SOURCE__: ' + info.sourceFile + (info.sourceLine ? ':' + info.sourceLine : ''));
      parts.push('__LOCALE_DOM_PATH__: ' + info.domPath);
      parts.push('__LOCALE_POSITION__: ' + info.rect.top + ', ' + info.rect.left + ' (' + info.rect.width + '×' + info.rect.height + ')');
      var text = info.textContent || '';
      if (text) parts.push('__LOCALE_TEXT_CONTENT__: ' + text.slice(0, 200));
      if (info.computedStyles) parts.push('__LOCALE_STYLE__: color=' + info.computedStyles.color + ' font-size=' + info.computedStyles.fontSize);
      return parts.join('\\n');
    }

    /** 发送给 Claude 按钮（通过 pilot-channel server 推送到 Claude Code session） */
    document.getElementById('__pilot-prompt-send').onclick = function() {
      if (this.disabled) return;
      var text = getPromptText();
      var btn = document.getElementById('__pilot-prompt-send');
      var originalText = btn.textContent;
      btn.textContent = '__LOCALE_SENDING__';
      btn.style.background = '#6d28d9';
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, 3000);
      fetch(CHANNEL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      }).then(function(res) {
        clearTimeout(timer);
        if (res.ok) {
          btn.textContent = '__LOCALE_SENT__';
          btn.style.background = '#22c55e';
          startAutoClose();
        } else {
          btn.textContent = '__LOCALE_SEND_FAILED__';
          btn.style.background = '#ef4444';
        }
        setTimeout(function() { btn.textContent = originalText; btn.style.background = '#7c3aed'; }, 1500);
      }).catch(function() {
        /** channel server 未启动时静默提示 */
        btn.textContent = '__LOCALE_NOT_CONNECTED__';
        btn.style.background = '#64748b';
        setTimeout(function() { btn.textContent = originalText; btn.style.background = '#7c3aed'; }, 1500);
      });
    };

    /** 使用 execCommand fallback 复制文本（兼容非 Secure Context） */
    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }

    /** 复制按钮（三级降级：clipboard API → execCommand → 提示手动复制） */
    document.getElementById('__pilot-prompt-copy').onclick = function() {
      var text = getPromptText();
      var btn = document.getElementById('__pilot-prompt-copy');
      var originalText = btn.textContent;

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function() {
          btn.textContent = '__LOCALE_COPIED__';
          btn.style.background = '#22c55e';
          startAutoClose();
          setTimeout(function() { btn.textContent = originalText; btn.style.background = '#3b82f6'; }, 1500);
        }).catch(function() {
          if (fallbackCopy(text)) {
            btn.textContent = '__LOCALE_COPIED__';
            btn.style.background = '#22c55e';
            startAutoClose();
            setTimeout(function() { btn.textContent = originalText; btn.style.background = '#3b82f6'; }, 1500);
          } else {
            showManualCopyHint(text);
          }
        });
      } else if (fallbackCopy(text)) {
        btn.textContent = '__LOCALE_COPIED__';
        btn.style.background = '#22c55e';
        startAutoClose();
        setTimeout(function() { btn.textContent = originalText; btn.style.background = '#3b82f6'; }, 1500);
      } else {
        showManualCopyHint(text);
      }
    };

    /** 显示手动复制提示（将提示词填入 textarea 并选中） */
    function showManualCopyHint(text) {
      textarea.value = text;
      textarea.select();
      var btn = document.getElementById('__pilot-prompt-copy');
      btn.textContent = '__LOCALE_COPY_MANUAL__';
      btn.style.background = '#f59e0b';
      setTimeout(function() { btn.textContent = '__LOCALE_COPY_PROMPT__'; btn.style.background = '#3b82f6'; }, 2000);
    }

    /** 关闭面板时清理高亮 */
    function closePanel() {
      if (autoCloseTimer) clearInterval(autoCloseTimer);
      panelOpen = false;
      hideHighlight();
      panel.remove();
    }

    /** 关闭按钮 */
    document.getElementById('__pilot-prompt-close').onclick = closePanel;

    /** ESC 关闭 */
    function onEsc(e) {
      if (e.key === 'Escape') {
        closePanel();
        document.removeEventListener('keydown', onEsc);
      }
    }
    document.addEventListener('keydown', onEsc);

    /** 点击面板外关闭 */
    function onOutsideClick(e) {
      if (!panel.contains(e.target)) {
        closePanel();
        document.removeEventListener('mousedown', onOutsideClick);
      }
    }
    setTimeout(function() { document.addEventListener('mousedown', onOutsideClick); }, 100);
  }

  document.addEventListener('keydown', onAltKeyDown);
  document.addEventListener('keyup', onAltKeyUp);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
})();
`
