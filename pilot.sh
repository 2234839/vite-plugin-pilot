#!/usr/bin/env bash
# pilot.sh — vite-plugin-pilot 的 agent 友好 CLI
# 用法: bash pilot.sh run '1+1' | bash pilot.sh page | bash pilot.sh run 'code' page logs

set -euo pipefail

# 自动探测端口（搜索多个可能的 .pilot/port.txt 位置）
PORT="${PILOT_PORT:-$(cat playground/vue/.pilot/port.txt 2>/dev/null || cat .pilot/port.txt 2>/dev/null || echo 5173)}"
HOST="http://localhost:$PORT/__pilot"
INSTANCE="${PILOT_INSTANCE:-default}"

case "${1:-help}" in
  run)
    CODE="${2:?用法: bash pilot.sh run <code> [page] [logs]}"
    ENCODED=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$CODE")
    EXTRA=""
    for arg in "${3:-}" "${4:-}"; do
      case "$arg" in page) EXTRA="$EXTRA&page=1" ;; logs) EXTRA="$EXTRA&logs=1" ;; esac
    done
    curl -s --noproxy localhost --max-time 30 "$HOST/run?code=$ENCODED&instance=$INSTANCE$EXTRA"
    ;;
  page)
    EXTRA="&fresh=1"
    if [ "${2:-}" = "cached" ]; then EXTRA=""; fi
    curl -s --noproxy localhost --max-time 10 "$HOST/page?instance=$INSTANCE$EXTRA"
    ;;
  status)
    curl -s --noproxy localhost --max-time 10 "$HOST/status?instance=$INSTANCE"
    ;;
  logs)
    curl -s --noproxy localhost --max-time 10 "$HOST/logs?instance=$INSTANCE" 2>/dev/null || echo "NO_LOGS"
    ;;
  help|*)
    echo "pilot.sh — vite-plugin-pilot CLI"
    echo ""
    echo "用法: bash pilot.sh <command> [args]"
    echo ""
    echo "命令:"
    echo "  run <code> [page] [logs]  执行 JS，可选附带页面快照和日志"
    echo "  page [cached]            读取页面快照（默认实时采集，cached=读缓存）"
    echo "  status                   浏览器连接状态"
    echo "  logs                     最近一次 exec 的控制台日志"
    echo ""
    echo "环境变量: PILOT_PORT  PILOT_INSTANCE"
    echo "端口探测: .pilot/port.txt > PILOT_PORT > 5173"
    ;;
esac
