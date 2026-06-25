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

  function serializeResult(val) {
    var str;
    if (val === undefined) str = 'undefined';
    else if (val === null) str = 'null';
    else if (typeof val === 'function') str = '[Function: ' + (val.name || 'anonymous') + ']';
    else if (typeof val === 'string') str = val;
    else { try { str = JSON.stringify(val, null, 2); } catch(e) { str = String(val); } }
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

  /** 当前 exec 专属的显式日志队列指针。exec 开始时置为新数组，grace 窗口结束后置 null（关闭接收） */
  var currentExecLogs = null;

  /** 构造绑定到 currentExecLogs 的 log 函数，作为 IIFE 形参注入用户代码。
   *  每次调用：实时 push 到当前 exec 队列（主通道），同时打到 console（保持开发者可见 + 触发 log-collector 兜底拦截） */
  function makeExecLog() {
    return function log() {
      /** exec 已结束且 grace 窗口已过，丢弃（防延后回调污染或泄漏） */
      if (!currentExecLogs) return;
      var stringify = window.__pilot_stringify;
      var msg = stringify
        ? Array.prototype.map.call(arguments, stringify).join(' ')
        : Array.prototype.join.call(arguments, ' ');
      currentExecLogs.push('[log] ' + msg);
      /** 同步打到浏览器 console：开发者可见，且被 log-collector 拦截进 __pilot_logs 作为兜底 */
      try { console.log.apply(console, arguments); } catch(e) {}
    };
  }

  /** 合并两路日志：console 拦截（getLogsSince，含上下文+exec 期间）+ 显式 log() 队列。按时序拼接，不去重 */
  function collectLogs(logStartIdx, execLogs) {
    var consoleLogs = getLogsSince(logStartIdx);
    if (execLogs && execLogs.length > 0) {
      return consoleLogs.concat(execLogs);
    }
    return consoleLogs;
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
    /** 重置本次 exec 的显式日志队列 */
    currentExecLogs = [];
    /** 闭包捕获本次队列引用：grace 回调只读 myLogs，防止 exec 交叉污染 */
    var myLogs = currentExecLogs;
    /** 记录 exec 开始时的日志位置，用于截取 exec 期间产生的新日志 */
    var logStartIdx = window.__pilot_logs ? window.__pilot_logs.length : 0;
    /** grace 窗口：IIFE settle 后再等 N ms，收集 setTimeout/Promise.then 等延后回调产生的日志 */
    var grace = 300;
    var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

    /** 统一走 async IIFE：用户代码作为 AsyncFunction 函数体，log 作为形参注入。
     *  函数体天然支持顶层 return 和 await，无需启发式 return 注入 */
    return new Promise(function(resolve) {
      var settled = false;
      /** timeout 不含 grace：代码卡死超时立即失败，不等 grace */
      var timeoutId = setTimeout(function() {
        if (settled) return; settled = true;
        currentExecLogs = null;
        resolve(makeResult(code, undefined, false, 'Execution timeout after ' + execTimeout + 'ms', collectLogs(logStartIdx, myLogs)));
      }, execTimeout);

      try {
        var fn = new AsyncFunction('log', code);
        fn(makeExecLog()).then(function(result) {
          if (settled) return;
          clearTimeout(timeoutId);
          /** grace 窗口：等待延后回调的 log()/console.log 落盘 */
          setTimeout(function() {
            if (settled) return; settled = true;
            currentExecLogs = null;
            resolve(makeResult(code, result, true, undefined, collectLogs(logStartIdx, myLogs)));
          }, grace);
        }).catch(function(e) {
          if (settled) return;
          clearTimeout(timeoutId);
          /** 出错也走 grace 窗口：错误发生后的回调日志同样有价值 */
          setTimeout(function() {
            if (settled) return; settled = true;
            currentExecLogs = null;
            resolve(makeResult(code, undefined, false, e.message || String(e), collectLogs(logStartIdx, myLogs)));
          }, grace);
        });
      } catch(e) {
        /** SyntaxError 等 new AsyncFunction 构造期错误 */
        if (settled) return; settled = true;
        clearTimeout(timeoutId);
        currentExecLogs = null;
        resolve(makeResult(code, undefined, false, e.message || String(e), collectLogs(logStartIdx, myLogs)));
      }
    });
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
