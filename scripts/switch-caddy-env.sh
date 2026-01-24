#!/bin/bash
# 切换 Caddy 配置的后端端口
# dev 环境: 5173 (Vite 开发服务器)
# prod 环境: 3001 (Node.js 生产服务器)
#
# 工作流程:
# 1. 修改项目仓库中的 Caddyfile (/data/codes/python_scripts/caddy_config/Caddyfile)
# 2. 调用 reload.sh 同步到 /etc/caddy/Caddyfile 并重载

CADDY_CONFIG_DIR="/data/codes/python_scripts/caddy_config"
LOCAL_CADDYFILE="$CADDY_CONFIG_DIR/Caddyfile"
RELOAD_SCRIPT="$CADDY_CONFIG_DIR/reload.sh"
ENV=${1:-dev}

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查参数
if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
    echo -e "${RED}错误: 环境参数必须是 'dev' 或 'prod'${NC}"
    echo "用法: $0 [dev|prod]"
    exit 1
fi

# 检查配置文件是否存在
if [[ ! -f "$LOCAL_CADDYFILE" ]]; then
    echo -e "${RED}错误: 本地 Caddy 配置文件不存在: $LOCAL_CADDYFILE${NC}"
    exit 1
fi

# 检查 reload 脚本是否存在
if [[ ! -f "$RELOAD_SCRIPT" ]]; then
    echo -e "${RED}错误: reload 脚本不存在: $RELOAD_SCRIPT${NC}"
    exit 1
fi

# 确定目标端口
if [[ "$ENV" == "dev" ]]; then
    TARGET_PORT="5173"
    OTHER_PORT="3001"
else
    TARGET_PORT="3001"
    OTHER_PORT="5173"
fi

# 检查当前配置的端口 (查找 dev.piecenote.cn 配置块中的端口)
CURRENT_PORT=$(grep -A 20 "^dev\.piecenote\.cn" "$LOCAL_CADDYFILE" | grep -oP 'reverse_proxy 127\.0\.0\.1:\K\d+' | head -1)

if [[ "$CURRENT_PORT" == "$TARGET_PORT" ]]; then
    echo -e "${GREEN}✓ Caddy 已经配置为 $ENV 环境 (端口: $TARGET_PORT)，无需修改${NC}"
    exit 0
fi

echo -e "${YELLOW}切换 Caddy 配置: $ENV 环境 (端口: $CURRENT_PORT -> $TARGET_PORT)${NC}"

# 备份本地配置文件
cp "$LOCAL_CADDYFILE" "$LOCAL_CADDYFILE.bak.$(date +%Y%m%d_%H%M%S)"

# 修改本地配置文件
# 使用 awk 精确匹配 dev.piecenote.cn 配置块并修改端口
awk -v target="$TARGET_PORT" -v other="$OTHER_PORT" '
/^dev\.piecenote\.cn/ {in_block=1}
in_block && /reverse_proxy 127\.0\.0\.1:/ {
    sub(/127\.0\.0\.1:[0-9]+/, "127.0.0.1:" target)
}
in_block && /^[a-z]/ && !/^dev\.piecenote\.cn/ {in_block=0}
{print}
' "$LOCAL_CADDYFILE" > "$LOCAL_CADDYFILE.tmp"

# 替换文件
mv "$LOCAL_CADDYFILE.tmp" "$LOCAL_CADDYFILE"

# 验证修改
NEW_PORT=$(grep -A 20 "^dev\.piecenote\.cn" "$LOCAL_CADDYFILE" | grep -oP 'reverse_proxy 127\.0\.0\.1:\K\d+' | head -1)
if [[ "$NEW_PORT" != "$TARGET_PORT" ]]; then
    echo -e "${RED}错误: 端口修改失败${NC}"
    # 恢复备份
    BACKUP=$(ls -t "$LOCAL_CADDYFILE.bak."* 2>/dev/null | head -1)
    if [[ -f "$BACKUP" ]]; then
        cp "$BACKUP" "$LOCAL_CADDYFILE"
    fi
    exit 1
fi

echo -e "${GREEN}✓ 本地配置文件已更新 (端口: $TARGET_PORT)${NC}"

# 调用 reload.sh 同步并重载
echo -e "${YELLOW}调用 reload.sh 同步配置并重载 Caddy...${NC}"
if sudo "$RELOAD_SCRIPT"; then
    echo ""
    echo -e "${GREEN}✓ Caddy 已切换到 $ENV 环境 (端口: $TARGET_PORT)${NC}"
    
    # 清理旧备份（保留最近 5 个）
    BACKUP_COUNT=$(ls -1 "$LOCAL_CADDYFILE.bak."* 2>/dev/null | wc -l || echo 0)
    if [ "$BACKUP_COUNT" -gt 5 ]; then
        ls -1t "$LOCAL_CADDYFILE.bak."* 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
    fi
else
    echo -e "${RED}错误: reload.sh 执行失败${NC}"
    echo -e "${YELLOW}正在恢复本地配置文件...${NC}"
    BACKUP=$(ls -t "$LOCAL_CADDYFILE.bak."* 2>/dev/null | head -1)
    if [[ -f "$BACKUP" ]]; then
        cp "$BACKUP" "$LOCAL_CADDYFILE"
    fi
    exit 1
fi
