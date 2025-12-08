#!/bin/bash

# Claude Code UI - HTTPS Proxy Script using Caddy
# 使用 Caddy 反向代理实现 HTTPS 访问

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$SCRIPT_DIR/caddy.log"
PID_FILE="$SCRIPT_DIR/caddy.pid"

# 证书路径
CERT_FILE="$SCRIPT_DIR/waderli-mb1.local.pem"
KEY_FILE="$SCRIPT_DIR/waderli-mb1.local-key.pem"

# 配置
HTTPS_PORT=${HTTPS_PORT:-443}
HTTP_BACKEND="http://localhost:3001"
DOMAIN="waderli-mb1.local"

case "$1" in
    stop)
        if [ -f "$PID_FILE" ]; then
            kill $(cat "$PID_FILE") 2>/dev/null
            rm "$PID_FILE"
            rm -f "$SCRIPT_DIR/Caddyfile.tmp"
            echo "✅ Caddy 已停止"
        else
            pkill -f "caddy run" 2>/dev/null
            rm -f "$SCRIPT_DIR/Caddyfile.tmp"
            echo "✅ Caddy 已停止"
        fi
        exit 0
        ;;
    log)
        tail -f "$LOG_FILE"
        exit 0
        ;;
    status)
        if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            echo "✅ Caddy 运行中 (PID: $(cat $PID_FILE))"
        else
            echo "⚠️  Caddy 未运行"
        fi
        exit 0
        ;;
esac

# 检查 Caddy 是否安装
if ! command -v caddy &> /dev/null; then
    echo "❌ Caddy 未安装，请先安装："
    echo "   brew install caddy"
    exit 1
fi

# 检查证书文件
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "❌ 证书文件不存在："
    echo "   $CERT_FILE"
    echo "   $KEY_FILE"
    exit 1
fi

# 先停止已有进程
if [ -f "$PID_FILE" ]; then
    kill $(cat "$PID_FILE") 2>/dev/null
    rm "$PID_FILE"
fi

# 创建临时 Caddyfile
CADDYFILE="$SCRIPT_DIR/Caddyfile.tmp"
cat > "$CADDYFILE" << EOF
{
    admin off
    auto_https off
}

$DOMAIN:$HTTPS_PORT {
    tls $CERT_FILE $KEY_FILE
    reverse_proxy $HTTP_BACKEND
}
EOF

# 后台启动 Caddy
nohup caddy run --config "$CADDYFILE" > "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"

echo "✅ Caddy HTTPS 代理已启动"
echo "   域名: https://$DOMAIN:$HTTPS_PORT"
echo "   后端: $HTTP_BACKEND"
echo "   日志: $LOG_FILE"
echo ""
echo "📱 其他设备访问前，需安装根证书: $SCRIPT_DIR/rootCA.crt"
echo ""
echo "命令: $0 {stop|log|status}"
