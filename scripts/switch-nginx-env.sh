#!/bin/bash
# 切换 nginx 配置的后端端口
# dev 环境: 5173 (Vite 开发服务器)
# prod 环境: 3001 (Node.js 生产服务器)

NGINX_CONF="/etc/nginx/conf.d/dev.piecenote.cn.conf"
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
if [[ ! -f "$NGINX_CONF" ]]; then
    echo -e "${RED}错误: nginx 配置文件不存在: $NGINX_CONF${NC}"
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

# 检查当前配置的端口
CURRENT_PORT=$(grep -oP 'server 127\.0\.0\.1:\K\d+' "$NGINX_CONF" | head -1)

if [[ "$CURRENT_PORT" == "$TARGET_PORT" ]]; then
    echo -e "${GREEN}✓ nginx 已经配置为 $ENV 环境 (端口: $TARGET_PORT)，无需修改${NC}"
    exit 0
fi

echo -e "${YELLOW}切换 nginx 配置: $ENV 环境 (端口: $CURRENT_PORT -> $TARGET_PORT)${NC}"

# 修改配置文件 (需要 sudo 权限)
sudo sed -i "s/server 127\.0\.0\.1:${OTHER_PORT}/server 127.0.0.1:${TARGET_PORT}/g" "$NGINX_CONF"

# 验证修改
NEW_PORT=$(grep -oP 'server 127\.0\.0\.1:\K\d+' "$NGINX_CONF" | head -1)
if [[ "$NEW_PORT" != "$TARGET_PORT" ]]; then
    echo -e "${RED}错误: 端口修改失败${NC}"
    exit 1
fi

# 测试 nginx 配置
echo -e "${YELLOW}测试 nginx 配置...${NC}"
if ! sudo nginx -t 2>/dev/null; then
    echo -e "${RED}错误: nginx 配置测试失败${NC}"
    exit 1
fi

# 重载 nginx
echo -e "${YELLOW}重载 nginx...${NC}"
sudo nginx -s reload

echo -e "${GREEN}✓ nginx 已切换到 $ENV 环境 (端口: $TARGET_PORT)${NC}"
