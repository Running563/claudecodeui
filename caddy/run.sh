#!/bin/bash

# 简单的启停脚本
cd "$(dirname "$0")/.."

# 确保日志目录存在
mkdir -p logs

case "$1" in
    start)
        npm run build
        nohup node server/index.js > logs/server.log 2>&1 &
        echo "✅ 已启动 (PID: $!)"
        echo "   访问: http://localhost:3001"
        ;;
    stop)
        pkill -f "node server/index.js"
        echo "✅ 已停止"
        ;;
    log)
        tail -f logs/server.log
        ;;
    *)
        echo "用法: $0 {start|stop|log}"
        ;;
esac
