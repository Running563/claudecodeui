# Shell 前后端链路实现原理

## 目录
- [整体架构](#整体架构)
- [核心组件](#核心组件)
- [消息流程](#消息流程)
- [会话管理](#会话管理)
- [安全机制](#安全机制)
- [技术栈](#技术栈)

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (React)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐         ┌─────────────────────┐          │
│  │  Shell.jsx       │────────▶│  xterm.js (Terminal)│          │
│  │  组件层          │         │  终端渲染层          │          │
│  └────────┬─────────┘         └─────────────────────┘          │
│           │                                                       │
│           │ WebSocket                                             │
│           │ /shell?token=xxx                                      │
│           ▼                                                       │
└───────────┼───────────────────────────────────────────────────────┘
            │
            │ wss:// or ws://
            │
┌───────────▼───────────────────────────────────────────────────────┐
│                      后端 (Node.js)                                │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              WebSocket Server (ws)                       │    │
│  │                                                          │    │
│  │  ┌──────────────┐         ┌──────────────┐            │    │
│  │  │ /shell 路由  │         │  /ws 路由    │            │    │
│  │  │ handleShell  │         │ handleChat   │            │    │
│  │  │ Connection() │         │ Connection() │            │    │
│  │  └──────┬───────┘         └──────────────┘            │    │
│  │         │                                              │    │
│  └─────────┼──────────────────────────────────────────────┘    │
│            │                                                     │
│            ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              PTY Session Manager                         │   │
│  │  ┌───────────────────────────────────────────────┐     │   │
│  │  │  ptySessionsMap (Map)                         │     │   │
│  │  │  Key: "${projectPath}_${sessionId}"           │     │   │
│  │  │  Value: {                                     │     │   │
│  │  │    pty: Process,                              │     │   │
│  │  │    ws: WebSocket,                             │     │   │
│  │  │    buffer: [],                                │     │   │
│  │  │    timeoutId: Timer,                          │     │   │
│  │  │    projectPath, sessionId                     │     │   │
│  │  │  }                                            │     │   │
│  │  └───────────────────────────────────────────────┘     │   │
│  └─────────┬───────────────────────────────────────────────┘   │
│            │                                                     │
│            ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         node-pty (Pseudo Terminal)                       │   │
│  │                                                          │   │
│  │  pty.spawn(shell, shellArgs, {                          │   │
│  │    name: 'xterm-256color',                              │   │
│  │    cols, rows, cwd, env                                 │   │
│  │  })                                                     │   │
│  └─────────┬───────────────────────────────────────────────┘   │
│            │                                                     │
└────────────┼─────────────────────────────────────────────────────┘
             │
             ▼
    ┌────────────────────┐
    │   System Shell     │
    │  - bash (Linux)    │
    │  - powershell.exe  │
    │    (Windows)       │
    └────────────────────┘
```

## 核心组件

### 前端组件

#### 1. Shell.jsx
**路径**: `src/components/Shell.jsx`

**核心职责**:
- 管理 xterm.js 终端实例
- 处理 WebSocket 连接
- 处理用户输入和终端输出
- 管理终端大小调整

**关键特性**:
```javascript
// 组件状态
const [isConnected, setIsConnected] = useState(false)
const [isInitialized, setIsInitialized] = useState(false)

// WebSocket 连接
const wsUrl = `${protocol}//${host}/shell?token=${token}`
ws.current = new WebSocket(wsUrl)

// xterm.js 配置
terminal.current = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  scrollback: 10000,
  theme: { /* VS Code 暗色主题 */ }
})
```

#### 2. xterm.js 插件
- **FitAddon**: 自动适应容器大小
- **WebglAddon**: GPU 加速渲染
- **WebLinksAddon**: URL 自动识别和点击

### 后端组件

#### 1. WebSocket 服务器
**路径**: `server/index.js:186-221`

**配置**:
```javascript
const wss = new WebSocketServer({
  server,
  verifyClient: (info) => {
    // Platform 模式：直接允许
    if (process.env.VITE_IS_PLATFORM === 'true') {
      return authenticateWebSocket(null)
    }
    
    // Normal 模式：验证 token
    const token = url.searchParams.get('token')
    return authenticateWebSocket(token)
  }
})
```

#### 2. PTY 会话管理器
**路径**: `server/index.js:182-184`

**数据结构**:
```javascript
const ptySessionsMap = new Map()
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000  // 30分钟

// 会话对象结构
{
  pty: Process,           // node-pty 进程实例
  ws: WebSocket,          // 当前 WebSocket 连接
  buffer: [],             // 输出缓冲（最多 5000 条）
  timeoutId: Timer,       // 超时定时器
  projectPath: string,    // 项目路径
  sessionId: string       // 会话 ID
}
```

#### 3. node-pty 进程
**路径**: `server/index.js:980-993`

**配置**:
```javascript
shellProcess = pty.spawn(shell, shellArgs, {
  name: 'xterm-256color',
  cols: termCols,
  rows: termRows,
  cwd: process.env.HOME,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    BROWSER: 'echo "OPEN_URL:"'  // 防止直接打开浏览器
  }
})
```

## 消息流程

### 1. 连接建立流程

#### 前端 (Shell.jsx:52-157)
```javascript
connectWebSocket() {
  // 1. 构建 WebSocket URL
  const wsUrl = `${protocol}//${host}/shell?token=${token}`
  
  // 2. 创建 WebSocket 连接
  ws.current = new WebSocket(wsUrl)
  
  // 3. 连接成功后发送初始化消息
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'init',
      projectPath: project.fullPath,
      sessionId: session?.id,
      hasSession: !!session,
      provider: 'claude' | 'cursor' | 'codebuddy' | 'plain-shell',
      cols: terminal.cols,
      rows: terminal.rows,
      initialCommand: command,
      isPlainShell: boolean
    }))
  }
}
```

#### 后端 (index.js:850-1004)
```javascript
if (data.type === 'init') {
  // 1. 生成 PTY 会话键
  ptySessionKey = `${projectPath}_${sessionId || 'default'}`
  
  // 2. 检查是否有现存会话（重连场景）
  const existingSession = ptySessionsMap.get(ptySessionKey)
  if (existingSession) {
    // 重连：清除超时，发送缓冲数据
    clearTimeout(existingSession.timeoutId)
    existingSession.ws = ws
    return
  }
  
  // 3. 构建 shell 命令
  let shellCommand
  if (isPlainShell) {
    shellCommand = `cd "${projectPath}" && ${initialCommand}`
  } else if (provider === 'cursor') {
    shellCommand = `cd "${projectPath}" && cursor-agent`
  } else if (provider === 'codebuddy') {
    shellCommand = `cd "${projectPath}" && codebuddy`
  } else {
    shellCommand = `cd "${projectPath}" && claude`
  }
  
  // 4. 创建 PTY 进程
  shellProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: data.cols,
    rows: data.rows,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: 'xterm-256color' }
  })
  
  // 5. 保存会话到 Map
  ptySessionsMap.set(ptySessionKey, {
    pty: shellProcess,
    ws: ws,
    buffer: [],
    timeoutId: null,
    projectPath,
    sessionId
  })
  
  // 6. 监听 PTY 输出
  shellProcess.onData((data) => {
    // 缓冲数据
    session.buffer.push(data)
    // 发送到前端
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'output',
        data: data
      }))
    }
  })
  
  // 7. 监听进程退出
  shellProcess.onExit((exitCode) => {
    ptySessionsMap.delete(ptySessionKey)
    shellProcess = null
  })
}
```

### 2. 用户输入流程

```
用户在终端输入
     ↓
xterm.js 触发 onData 事件
     ↓
WebSocket 发送 { type: 'input', data: inputData }
     ↓
后端接收消息
     ↓
shellProcess.write(data.data)
     ↓
写入 PTY 进程的标准输入
```

**前端代码** (Shell.jsx:331-338):
```javascript
terminal.onData((data) => {
  if (ws.current && ws.current.readyState === WebSocket.OPEN) {
    ws.current.send(JSON.stringify({
      type: 'input',
      data: data  // 可能是字符、回车、方向键等
    }))
  }
})
```

**后端代码** (index.js:1087-1097):
```javascript
if (data.type === 'input') {
  if (shellProcess && shellProcess.write) {
    shellProcess.write(data.data)
  }
}
```

### 3. 终端输出流程

```
Shell 进程输出
     ↓
node-pty 捕获输出
     ↓
shellProcess.onData() 触发
     ↓
缓冲数据（最多 5000 条）
     ↓
检测 URL 模式
     ↓
WebSocket 发送 { type: 'output', data: outputData }
     ↓
前端 xterm.js 渲染输出
```

**后端代码** (index.js:1007-1060):
```javascript
shellProcess.onData((data) => {
  const session = ptySessionsMap.get(ptySessionKey)
  
  // 1. 缓冲数据（循环队列，最多 5000 条）
  if (session.buffer.length < 5000) {
    session.buffer.push(data)
  } else {
    session.buffer.shift()
    session.buffer.push(data)
  }
  
  // 2. URL 检测与自动打开
  const urlPatterns = [
    /(?:xdg-open|open|start)\s+(https?:\/\/[^\s\x1b\x07]+)/g,
    /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
    /Opening\s+(https?:\/\/[^\s\x1b\x07]+)/gi,
    /Visit:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
  ]
  
  patterns.forEach(pattern => {
    let match
    while ((match = pattern.exec(data)) !== null) {
      const url = match[1]
      // 发送 URL 打开消息
      session.ws.send(JSON.stringify({
        type: 'url_open',
        url: url
      }))
    }
  })
  
  // 3. 发送输出到前端
  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({
      type: 'output',
      data: outputData
    }))
  }
})
```

**前端代码** (Shell.jsx:109-137):
```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  
  if (data.type === 'output') {
    // 检查进程退出（用于 plain shell 模式）
    if (isPlainShell && onProcessComplete) {
      const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '')
      if (cleanOutput.includes('Process exited with code 0')) {
        onProcessComplete(0)
      }
    }
    
    // 写入终端显示
    if (terminal.current) {
      terminal.current.write(data.data)
    }
  } else if (data.type === 'url_open') {
    // 在浏览器中打开 URL
    window.open(data.url, '_blank')
  }
}
```

### 4. 终端调整大小流程

```
浏览器窗口大小改变
     ↓
ResizeObserver 触发
     ↓
fitAddon.fit() 调整 xterm.js 大小
     ↓
WebSocket 发送 { type: 'resize', cols, rows }
     ↓
后端调用 shellProcess.resize(cols, rows)
     ↓
PTY 进程更新终端尺寸
```

**前端代码** (Shell.jsx:340-353):
```javascript
const resizeObserver = new ResizeObserver(() => {
  if (fitAddon.current && terminal.current) {
    // 1. 调整 xterm.js 终端大小以适应容器
    fitAddon.current.fit()
    
    // 2. 通知后端更新 PTY 尺寸
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'resize',
        cols: terminal.current.cols,
        rows: terminal.current.rows
      }))
    }
  }
})
```

**后端代码** (index.js:1098-1104):
```javascript
if (data.type === 'resize') {
  if (shellProcess && shellProcess.resize) {
    shellProcess.resize(data.cols, data.rows)
  }
}
```

## 会话管理

### PTY 会话持久化

**设计目标**: 允许前端断线重连而不丢失终端状态

**实现方式**:
1. 使用 `Map` 存储所有活动的 PTY 会话
2. 键名格式: `${projectPath}_${sessionId || 'default'}`
3. 每个会话包含 PTY 进程、WebSocket 引用、输出缓冲等

**数据结构** (index.js:182-184):
```javascript
const ptySessionsMap = new Map()
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000  // 30分钟

// 会话对象
{
  pty: Process,           // node-pty 进程实例
  ws: WebSocket,          // 当前 WebSocket 连接
  buffer: [],             // 输出缓冲（最多 5000 条）
  timeoutId: Timer,       // 超时定时器
  projectPath: string,    // 项目路径
  sessionId: string       // 会话 ID
}
```

### 断线重连机制

#### 场景 1: 前端主动断开（刷新页面、切换标签）

**后端处理** (index.js:1116-1134):
```javascript
ws.on('close', () => {
  if (ptySessionKey) {
    const session = ptySessionsMap.get(ptySessionKey)
    if (session) {
      console.log('⏳ PTY session kept alive, will timeout in 30 minutes')
      
      // 1. 清空 WebSocket 引用但保留 PTY 进程
      session.ws = null
      
      // 2. 设置 30 分钟超时
      session.timeoutId = setTimeout(() => {
        console.log('⏰ PTY session timeout, killing process')
        if (session.pty && session.pty.kill) {
          session.pty.kill()
        }
        ptySessionsMap.delete(ptySessionKey)
      }, PTY_SESSION_TIMEOUT)
    }
  }
})
```

#### 场景 2: 前端重新连接

**后端处理** (index.js:860-884):
```javascript
const existingSession = ptySessionsMap.get(ptySessionKey)
if (existingSession) {
  console.log('♻️  Reconnecting to existing PTY session')
  shellProcess = existingSession.pty
  
  // 1. 清除超时定时器
  clearTimeout(existingSession.timeoutId)
  
  // 2. 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'output',
    data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
  }))
  
  // 3. 发送缓冲的历史输出（最多 5000 条）
  if (existingSession.buffer && existingSession.buffer.length > 0) {
    console.log(`📜 Sending ${existingSession.buffer.length} buffered messages`)
    existingSession.buffer.forEach(bufferedData => {
      ws.send(JSON.stringify({
        type: 'output',
        data: bufferedData
      }))
    })
  }
  
  // 4. 更新 WebSocket 引用
  existingSession.ws = ws
  
  return  // 不创建新进程
}
```

### 缓冲机制

**目的**: 在 WebSocket 断开期间保存输出，重连时发送给客户端

**实现** (index.js:1011-1016):
```javascript
// 循环队列，最多保留 5000 条消息
if (session.buffer.length < 5000) {
  session.buffer.push(data)
} else {
  session.buffer.shift()  // 删除最旧的
  session.buffer.push(data)
}
```

## 安全机制

### 1. WebSocket 认证

**Platform 模式** (单用户部署):
```javascript
if (process.env.VITE_IS_PLATFORM === 'true') {
  const user = authenticateWebSocket(null)
  if (!user) return false
  info.req.user = user
  return true
}
```

**Normal 模式** (多用户部署):
```javascript
// 从 URL 参数或 Header 提取 token
const token = url.searchParams.get('token') || 
              info.req.headers.authorization?.split(' ')[1]

// 验证 token
const user = authenticateWebSocket(token)
if (!user) return false

info.req.user = user
return true
```

### 2. 环境变量隔离

**防止恶意命令打开浏览器** (index.js:985-992):
```javascript
env: {
  ...process.env,
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  FORCE_COLOR: '3',
  // 覆盖 BROWSER 环境变量，防止直接打开浏览器
  BROWSER: 'echo "OPEN_URL:"'
}
```

当程序尝试打开浏览器时，会执行 `echo "OPEN_URL: <url>"`，后端检测到该模式后：
1. 通过 WebSocket 发送 `url_open` 消息给前端
2. 前端在受控环境中打开 URL

### 3. 进程隔离

每个 PTY 会话运行在独立的 shell 进程中：
- 不同项目/会话之间完全隔离
- 进程退出自动清理资源
- 30 分钟超时保护

## 技术栈

### 前端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18+ | UI 框架 |
| xterm.js | 5.x | 终端模拟器 |
| @xterm/addon-fit | 最新 | 自动调整终端大小 |
| @xterm/addon-webgl | 最新 | GPU 加速渲染 |
| @xterm/addon-web-links | 最新 | URL 识别和点击 |

### 后端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 18+ | 运行时环境 |
| ws | 8.x | WebSocket 服务器 |
| node-pty | 1.x | 伪终端（PTY）实现 |
| express | 4.x | HTTP 服务器 |

### 核心依赖说明

#### node-pty
- **功能**: 提供完整的 PTY (Pseudo Terminal) 功能
- **特性**:
  - 支持 ANSI 转义序列
  - 支持颜色和光标控制
  - 跨平台（Linux/macOS 用 bash，Windows 用 powershell）
  - 支持终端尺寸调整

#### xterm.js
- **功能**: 在浏览器中渲染完整的终端界面
- **特性**:
  - 支持 256 色和 True Color
  - GPU 加速渲染（WebGL）
  - 支持鼠标操作
  - 可扩展插件系统

## 数据流总结

```
┌──────────────┐
│  用户操作    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  xterm.js    │  (前端终端渲染)
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  WebSocket       │  (双向通信)
│  type: input     │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  node-pty        │  (伪终端)
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Shell 进程      │  (bash/powershell)
│  命令执行        │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  命令输出        │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  node-pty        │  (捕获输出)
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  WebSocket       │  (发送输出)
│  type: output    │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  xterm.js        │  (渲染到浏览器)
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  浏览器显示      │
└──────────────────┘
```

## 特殊功能

### 1. URL 自动检测和打开

支持检测多种 URL 模式：
- 直接命令: `xdg-open`, `open`, `start`
- 环境变量覆盖: `OPEN_URL:`
- 工具输出: `Opening`, `Visit`, `View at`, `Browse to`

### 2. 多 AI 代理支持

支持以下 AI 代理的终端交互：
- **Claude**: `claude` 命令
- **Cursor**: `cursor-agent` 命令
- **CodeBuddy**: `codebuddy` 命令
- **Plain Shell**: 纯终端模式

### 3. 会话恢复

支持恢复之前的会话：
```bash
# Claude
claude --resume <session-id>

# Cursor
cursor-agent --resume <session-id>

# CodeBuddy
codebuddy --resume <session-id>
```

### 4. 剪贴板支持

- **Ctrl/Cmd + C**: 复制选中文本
- **Ctrl/Cmd + V**: 粘贴文本到终端

## 性能优化

1. **WebGL 渲染**: 使用 GPU 加速终端渲染
2. **输出缓冲**: 循环队列限制最多 5000 条历史记录
3. **会话复用**: 30 分钟内重连复用现有 PTY 进程
4. **防抖处理**: 终端大小调整使用 50ms 防抖
5. **惰性连接**: 前端支持手动连接模式，节省资源

## 错误处理

### 前端错误处理
- WebSocket 连接失败自动重置状态
- 终端初始化失败显示错误消息
- 进程退出显示退出码和信号

### 后端错误处理
- PTY 进程启动失败发送错误消息
- WebSocket 消息解析失败捕获并记录
- 进程异常退出自动清理会话

## 扩展性

### 支持的 Shell
- **Linux/macOS**: bash, zsh, sh
- **Windows**: powershell.exe, cmd.exe

### 支持的提供商
- Claude (官方 CLI)
- Cursor (第三方 CLI)
- CodeBuddy (第三方 CLI)
- Plain Shell (纯终端模式)

可通过修改 `shellCommand` 构建逻辑轻松添加新的 AI 代理支持。

---

## 总结

这个 Shell 实现提供了：
- ✅ 完整的终端功能（颜色、光标、交互）
- ✅ 可靠的会话管理（断线重连、缓冲）
- ✅ 良好的安全性（认证、隔离、超时）
- ✅ 优秀的性能（GPU 加速、缓冲优化）
- ✅ 灵活的扩展性（多 AI 代理、多 Shell）

适用于构建基于 Web 的开发工具和 AI 辅助编程平台。
