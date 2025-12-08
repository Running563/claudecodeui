# 服务启动指南

## 前置条件

```bash
brew install caddy   # HTTPS 代理（可选）
```

## 快速开始

```bash
# 启动 HTTP 服务（后台运行）
./caddy/run.sh start

# 启动 HTTPS 代理（可选）
./caddy/start-https.sh
```

- HTTP 访问: http://localhost:3001
- HTTPS 访问: https://waderli-mb1.local

## 命令

### run.sh - HTTP 服务

| 命令 | 说明 |
|------|------|
| `./run.sh start` | 构建并启动服务 |
| `./run.sh stop` | 停止服务 |
| `./run.sh log` | 查看日志 |

### start-https.sh - HTTPS 代理

| 命令 | 说明 |
|------|------|
| `./start-https.sh` | 启动 |
| `./start-https.sh stop` | 停止 |
| `./start-https.sh status` | 状态 |
| `./start-https.sh log` | 日志 |

## 手机/其他设备访问

需先安装根证书 `rootCA.crt`：

1. 将 `rootCA.crt` 传到设备
2. **iOS**: 设置 → 通用 → VPN与设备管理 → 安装 → 关于本机 → 证书信任设置 → 启用
3. **Android**: 设置 → 安全 → 安装证书

## 文件说明

```
caddy/
├── run.sh                      # HTTP 服务启停脚本
├── start-https.sh              # HTTPS 代理启停脚本
├── waderli-mb1.local.pem       # SSL 证书
├── waderli-mb1.local-key.pem   # SSL 私钥
└── rootCA.crt                  # 根证书（供其他设备安装）
```
