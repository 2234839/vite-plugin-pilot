/**
 * 客户端通信代码（字符串形式，用于注入到浏览器）
 *
 * 策略：SSE（Server-Sent Events）接收代码推送
 * EventSource 不支持自定义 headers，instance 和 version 通过 query params 传递
 */

export const wsClientCode = `
(function() {
  /** HMR 代际计数器：旧实例的 SSE 通过比对代际自动关闭 */
  window.__pilot_gen = (window.__pilot_gen || 0) + 1;
  var myGen = window.__pilot_gen;

  /** 清理旧实例的 SSE 连接 */
  if (window.__pilot_es) {
    window.__pilot_es.close();
    window.__pilot_es = null;
  }

  var execTimeout = __EXEC_TIMEOUT__;
  var maxResultSize = __MAX_RESULT_SIZE__;

  function serializeResult(val) {
    var str;
    if (val === undefined) str = 'undefined';
    else if (val === null) str = 'null';
    else if (typeof val === 'function') str = '[Function: ' + (val.name || 'anonymous') + ']';
    else if (typeof val === 'string') str = val;
    else { try { str = JSON.stringify(val, null, 2); } catch(e) { str = String(val); } }
    if (str.length > maxResultSize) {
      str = str.slice(0, maxResultSize) + '\\n... [truncated, ' + str.length + ' chars total]';
    }
    return str;
  }

  function makeResult(code, result, success, error, logsSinceExec) {
    var operated = window.__pilot_operated && window.__pilot_operated.length > 0
      ? window.__pilot_operated.slice() : undefined;
    var operatedLabels = window.__pilot_operatedLabels && window.__pilot_operatedLabels.length > 0
      ? window.__pilot_operatedLabels.slice() : undefined;
    return {
      code: code,
      result: success ? serializeResult(result) : undefined,
      success: success,
      error: error || undefined,
      logs: logsSinceExec && logsSinceExec.length > 0 ? logsSinceExec : undefined,
      operated: operated,
      operatedLabels: operatedLabels
    };
  }

  /** 已知的噪音日志关键词，匹配时不纳入 exec 日志以节省 token */
  var LOG_NOISE = ['[Vue warn]', '[vite]', '[COSE]', '[Pilot] Running'];

  /** 格式化单条日志为紧凑文本 */
  function formatLog(l) {
    var msg = window.__pilot_logToMessage(l);
    /** warn/info 截断到 150 字符（去掉 Vue 组件堆栈等冗余信息），error 保留完整信息 */
    if (l.type !== 'error' && msg.length > 150) {
      var cutIdx = msg.indexOf('\\n');
      msg = cutIdx > 0 && cutIdx < 150 ? msg.slice(0, cutIdx) : msg.slice(0, 150) + '...';
    }
    return '[' + l.type + '] ' + msg;
  }

  /** 截取 exec 期间的日志 + exec 之前的上下文日志（帮助 agent 了解页面状态）
   *  上下文日志：取 exec 开始前最近 10 条非噪音日志 */
  function getLogsSince(idx) {
    if (!window.__pilot_logs) return [];
    var allLogs = window.__pilot_logs;

    /** 收集 exec 开始前的上下文日志（最近 10 条非噪音） */
    var contextLogs = [];
    var contextMax = 10;
    for (var ci = idx - 1; ci >= 0 && contextLogs.length < contextMax; ci--) {
      var entry = allLogs[ci];
      var cMsg = window.__pilot_logToMessage(entry);
      var isNoise = false;
      for (var ni = 0; ni < LOG_NOISE.length; ni++) {
        if (cMsg.indexOf(LOG_NOISE[ni]) !== -1) { isNoise = true; break; }
      }
      if (!isNoise) contextLogs.unshift(formatLog(entry));
    }

    /** 收集 exec 期间的新增日志 */
    var newLogs = allLogs.slice(idx);
    var execLogs = [];
    for (var li = 0; li < newLogs.length; li++) {
      var l = newLogs[li];
      var lMsg = window.__pilot_logToMessage(l);
      var lNoise = false;
      for (var lni = 0; lni < LOG_NOISE.length; lni++) {
        if (lMsg.indexOf(LOG_NOISE[lni]) !== -1) { lNoise = true; break; }
      }
      if (!lNoise) execLogs.push(formatLog(l));
    }

    /** 合并：上下文日志和 exec 日志用分隔线区分 */
    var result = [];
    if (contextLogs.length > 0 && execLogs.length > 0) {
      for (var ri = 0; ri < contextLogs.length; ri++) result.push(contextLogs[ri]);
      result.push('---');
    } else if (contextLogs.length > 0) {
      for (var ri = 0; ri < contextLogs.length; ri++) result.push(contextLogs[ri]);
    }
    for (var ei = 0; ei < execLogs.length; ei++) result.push(execLogs[ei]);
    return result;
  }

  function execCode(code) {
    /** 清空操作元素记录（每次 exec 重新开始） */
    window.__pilot_operated = [];
    window.__pilot_operatedLabels = [];
    /** 检测是否需要 async 执行（显式 await 或调用返回 Promise 的辅助函数） */
    var hasAwait = /\\bawait\\b/.test(code) || code.indexOf('__pilot_waitFor(') !== -1 || code.indexOf('__pilot_wait(') !== -1
      || code.indexOf('__pilot_typeByPlaceholder(') !== -1 || code.indexOf('__pilot_type(') !== -1
      || code.indexOf('__pilot_checkMultipleByText(') !== -1 || code.indexOf('__pilot_waitEnabled(') !== -1;
    /** 记录 exec 开始时的日志位置，用于截取 exec 期间产生的新日志 */
    var logStartIdx = window.__pilot_logs ? window.__pilot_logs.length : 0;

    if (hasAwait) {
      /** 自动在最后一个表达式前添加 return，使 async exec 与 sync eval 行为一致
       *  支持块语句（if-else、try-catch 等）和简单表达式
       *  用法: await __pilot_wait(100); __pilot_clickByText("提交")
       *  用法: if (btn) { btn.click(); "CLICKED" } else { "NOT_FOUND" }  → 自动 return */
      var lines = code.split('\\n');
      var lastIdx = -1;
      for (var li = lines.length - 1; li >= 0; li--) {
        var trimmed = lines[li].trim();
        if (trimmed && trimmed !== '}' && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
          lastIdx = li;
          break;
        }
      }
      if (lastIdx >= 0) {
        var lastLine = lines[lastIdx].trim();
        if (!/^return\\b/.test(lastLine) && !/^}/.test(lastLine) && !/}\\s*$/.test(lastLine)) {
          /** 单行含分号时，提取最后一个 ; 后的表达式加 return（避免 return await 导致后续表达式不可达） */
          var semiIdx = lastLine.lastIndexOf(';');
          if (semiIdx !== -1 && semiIdx < lastLine.length - 1) {
            var prefix = lastLine.slice(0, semiIdx + 1);
            var suffix = lastLine.slice(semiIdx + 1).trim();
            if (suffix && !/^return\\b/.test(suffix)) {
              lines[lastIdx] = prefix + ' return ' + suffix;
            }
          } else {
            lines[lastIdx] = 'return ' + lastLine;
          }
          code = lines.join('\\n');
        } else if (/}\\s*$/.test(lastLine)) {
          /** 最后一行以 } 结尾：可能是 if-else、try-catch 等块语句
           *  在每个块语句的叶子块（最内层 {} 对）的最后一个表达式前加 return */
          var blockLine = lines[lastIdx];
          var bChars = blockLine.split('');
          var bDepthStack = [];
          var bBlocks = [];
          var bInStr = false, bStrCh = '', bEsc = false;
          for (var bi = 0; bi < bChars.length; bi++) {
            var bc = bChars[bi];
            if (bEsc) { bEsc = false; continue; }
            if (bc === '\\\\') { bEsc = true; continue; }
            if (bInStr) { if (bc === bStrCh) bInStr = false; continue; }
            if (bc === '"' || bc === "'" || bc === '\\\`') { bInStr = true; bStrCh = bc; continue; }
            if (bc === '{') bDepthStack.push(bi);
            if (bc === '}' && bDepthStack.length > 0) {
              bBlocks.push({ start: bDepthStack.pop(), end: bi });
            }
          }
          var bLeafBlocks = [];
          for (var bbi = 0; bbi < bBlocks.length; bbi++) {
            var bHasChild = false;
            for (var bbj = 0; bbj < bBlocks.length; bbj++) {
              if (bbi !== bbj && bBlocks[bbj].start > bBlocks[bbi].start && bBlocks[bbj].end < bBlocks[bbi].end) {
                bHasChild = true; break;
              }
            }
            if (!bHasChild) bLeafBlocks.push(bBlocks[bbi]);
          }
          var bEdits = [];
          var BLOCK_KW_RE = /\\b(if|else|for|while|do|try|catch|finally|switch|with)\\b\\s*(\\([^)]*\\)\\s*)*$/;
          for (var bli = 0; bli < bLeafBlocks.length; bli++) {
            var bBlock = bLeafBlocks[bli];
            var bBefore = blockLine.substring(0, bBlock.start).trimEnd();
            if (!BLOCK_KW_RE.test(bBefore)) continue;
            var bContent = blockLine.substring(bBlock.start + 1, bBlock.end);
            var bEndPos = bContent.length;
            while (bEndPos > 0 && /\\s/.test(bContent[bEndPos - 1])) bEndPos--;
            while (bEndPos > 0 && bContent[bEndPos - 1] === ';') bEndPos--;
            while (bEndPos > 0 && /\\s/.test(bContent[bEndPos - 1])) bEndPos--;
            if (bEndPos === 0) continue;
            var bExprStart = 0;
            var bInStr2 = false, bStrCh2 = '', bEsc2 = false;
            for (var bci = bEndPos - 1; bci >= 0; bci--) {
              var bcc = bContent[bci];
              if (bEsc2) { bEsc2 = false; continue; }
              if (bcc === '\\\\') { bEsc2 = true; continue; }
              if (bInStr2) { if (bcc === bStrCh2) bInStr2 = false; continue; }
              if (bcc === '"' || bcc === "'" || bcc === '\\\`') { bInStr2 = true; bStrCh2 = bcc; continue; }
              if (bcc === ';') { bExprStart = bci + 1; break; }
            }
            while (bExprStart < bEndPos && /\\s/.test(bContent[bExprStart])) bExprStart++;
            if (bExprStart >= bEndPos) continue;
            var bExpr = bContent.substring(bExprStart, bEndPos);
            if (/^\\s*return\\b/.test(bExpr)) continue;
            bEdits.push({ pos: bBlock.start + 1 + bExprStart });
          }
          for (var bei = bEdits.length - 1; bei >= 0; bei--) {
            blockLine = blockLine.substring(0, bEdits[bei].pos) + 'return ' + blockLine.substring(bEdits[bei].pos);
          }
          lines[lastIdx] = blockLine;
          code = lines.join('\\n');
        }
      }
      var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      return new Promise(function(resolve) {
        var timeoutId = setTimeout(function() {
          resolve(makeResult(code, undefined, false, 'Execution timeout after ' + execTimeout + 'ms'));
        }, execTimeout);

        try {
          var fn = new AsyncFunction(code);
          fn().then(function(result) {
            clearTimeout(timeoutId);
            resolve(makeResult(code, result, true, undefined, getLogsSince(logStartIdx)));
          }).catch(function(e) {
            clearTimeout(timeoutId);
            resolve(makeResult(code, undefined, false, e.message || String(e), getLogsSince(logStartIdx)));
          });
        } catch(e) {
          clearTimeout(timeoutId);
          resolve(makeResult(code, undefined, false, e.message || String(e)));
        }
      });
    }

    var result;
    var success = true;
    var errorMsg = '';

    var timeoutId = setTimeout(function() {
      throw new Error('Execution timeout after ' + execTimeout + 'ms');
    }, execTimeout);

    try {
      /** 支持 return 语句：检测顶层 return 并用 IIFE 包裹 */
      var hasTopReturn = false;
      var depth = 0;
      for (var ci = 0; ci < code.length; ci++) {
        var ch = code[ci];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
        else if (depth === 0 && code.slice(ci, ci + 6) === 'return' && (ci + 6 >= code.length || /[^a-zA-Z0-9_$]/.test(code[ci + 6])) && (ci === 0 || /[^a-zA-Z0-9_$]/.test(code[ci - 1]))) {
          hasTopReturn = true;
          break;
        }
      }
      if (hasTopReturn) {
        result = (0, eval)('(function() { ' + code + ' })()');
      } else {
        result = (0, eval)(code);
      }
    } catch(e) {
      success = false;
      errorMsg = e.message || String(e);
      result = undefined;
    } finally {
      clearTimeout(timeoutId);
    }

    return makeResult(code, result, success, errorMsg, getLogsSince(logStartIdx));
  }

  /** 构建 API URL（Console Bridge 模式下使用绝对 URL 连接 dev server） */
  function apiUrl(path) {
    if (window.__PILOT_SERVER_ORIGIN__) return window.__PILOT_SERVER_ORIGIN__ + path;
    return path;
  }

  /** 通过 HTTP POST 发送执行结果（失败自动重试一次，确保 CLI 不超时） */
  function postResult(result) {
    fetch(apiUrl('/__pilot/result'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pilot-Instance': __pilot_instanceId, 'X-Pilot-Title': encodeURIComponent(document.title || '') },
      body: JSON.stringify(result)
    }).catch(function(err) {
      console.log('[Pilot] postResult failed: ' + err.message);
      /** 后台 tab 或网络抖动导致首次失败时，200ms 后重试一次 */
      setTimeout(function() {
        fetch(apiUrl('/__pilot/result'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Pilot-Instance': __pilot_instanceId, 'X-Pilot-Title': encodeURIComponent(document.title || '') },
          body: JSON.stringify(result)
        }).catch(function() {});
      }, 200);
    });
  }

  /** 发送执行结果（POST /result handler 内部已调用 writeExecDone） */
  function sendResult(result) {
    postResult(result);
  }

  /** 执行锁：防止快速连续代码推送时并发执行导致 snapshot 竞态 */
  var isExecuting = false;
  /** 排队的代码（exec 锁忙时暂存，当前 exec 完成后立即执行） */
  var pendingCode = null;

  /** 执行代码并发送结果的通用处理 */
  function handleCode(code) {
    if (isExecuting) {
      pendingCode = code;
      return;
    }
    isExecuting = true;
    var result = execCode(code);
    /** 等待 Vue nextTick + 浏览器渲染后再采集 snapshot，确保 DOM 已更新
     *  后台 tab 时 requestAnimationFrame 不触发，直接发送结果 */
    function sendWithSnapshot(result) {
      /** 安全采集 snapshot，出错时不阻塞结果发送 */
      function safeSnapshot() {
        try { return window.__pilot_snapshot ? window.__pilot_snapshot() : undefined; } catch(e) { return undefined; }
      }
      if (window.__pilot_snapshot && !document.hidden) {
        requestAnimationFrame(function() {
          result.snapshot = safeSnapshot();
          sendResult(result);
          /** exec 完成，检查是否有排队的代码需要执行 */
          isExecuting = false;
          if (pendingCode) { var next = pendingCode; pendingCode = null; handleCode(next); }
        });
      } else if (window.__pilot_snapshot) {
        /** 后台 tab 时 rAF 不触发，用 setTimeout 兜底确保 snapshot 采集 */
        setTimeout(function() {
          result.snapshot = safeSnapshot();
          sendResult(result);
          isExecuting = false;
          if (pendingCode) { var next = pendingCode; pendingCode = null; handleCode(next); }
        }, 50);
      } else {
        sendResult(result);
        isExecuting = false;
        if (pendingCode) { var next = pendingCode; pendingCode = null; handleCode(next); }
      }
    }
    /** async exec 返回 Promise，需要等待完成后再采集 snapshot */
    if (result && typeof result.then === 'function') {
      result.then(function(r) { sendWithSnapshot(r); });
    } else {
      sendWithSnapshot(result);
    }
  }

  /** 通过 SSE 接收代码推送，替代 HTTP 轮询 */
  function connectSSE() {
    var titleParam = encodeURIComponent(document.title || '');
    var typeParam = typeof __PILOT_INSTANCE_TYPE__ !== 'undefined' ? ('&type=' + __PILOT_INSTANCE_TYPE__) : '';
    var url = apiUrl('/__pilot/sse?instance=' + __pilot_instanceId + '&version=' + __PILOT_VERSION__ + '&title=' + titleParam + typeParam);
    var es = new EventSource(url);
    window.__pilot_es = es;

    es.addEventListener('code', function(e) {
      if (myGen !== window.__pilot_gen) return;
      handleCode(e.data);
    });

    es.addEventListener('reload', function() {
      es.close();
      /** Console Bridge 模式下不 reload（控制台注入的代码会丢失） */
      if (!window.__pilot_bridge_active) {
        location.reload();
      }
    });

    es.onerror = function() {
      /** EventSource 浏览器自动重连，仅在代际过期时手动关闭 */
      if (myGen !== window.__pilot_gen) {
        es.close();
      }
    };
  }

  console.log('[Pilot] Running with SSE (gen=' + myGen + ')');
  connectSSE();
})();
`
