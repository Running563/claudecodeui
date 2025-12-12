# Chat 功能架构设计文档

## 目录
- [整体架构概览](#整体架构概览)
- [核心组件](#核心组件)
- [数据流分析](#数据流分析)
- [WebSocket 通信协议](#websocket-通信协议)
- [前端实现](#前端实现)
- [后端实现](#后端实现)
- [多 Provider 支持](#多-provider-支持)
- [会话管理系统](#会话管理系统)
- [图片处理流程](#图片处理流程)
- [工具权限管理](#工具权限管理)
- [MCP 集成](#mcp-集成)
- [性能优化](#性能优化)
- [安全机制](#安全机制)
- [错误处理](#错误处理)

---

## 整体架构概览

Chat 功能采用 **WebSocket 实时通信** + **流式响应** 的架构,支持 Claude、Cursor、CodeBuddy 三种 AI Provider。

```
┌─────────────────────────────────────────────────────────────────┐
│                      前端层 (React)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │           ChatInterface.jsx (主组件)                        │ │
│  │  • State: messages, input, isLoading, currentSessionId     │ │
│  │  • Functions: handleSubmit, loadSessionMessages            │ │
│  │  • Effects: WebSocket 消息处理, 会话状态同步               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ▲  │                                 │
│                            │  ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │      WebSocketContext (全局 WebSocket 管理)                │ │
│  │  • useWebSocket() Hook                                     │ │
│  │  • 自动重连机制                                            │ │
│  │  • 消息队列管理                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                            ▲  │
                   WebSocket │  │ Connection
                  (ws://host/ws)
                            │  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   后端层 (Node.js + Express)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         WebSocket 服务器 (server/index.js)                 │ │
│  │  • handleChatConnection(ws)                                │ │
│  │  • 消息路由 (claude/cursor/codebuddy)                      │ │
│  │  • 会话管理 (创建/恢复/中止)                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ▲  │                                 │
│                            │  ▼                                 │
│  ┌──────────────┬──────────────────┬──────────────────┐        │
│  │  claude-sdk  │   cursor-cli.js  │ codebuddy-sdk.js │        │
│  │    .js       │                  │                  │        │
│  │              │                  │                  │        │
│  │ • SDK 集成   │ • CLI 子进程     │ • CLI 子进程     │        │
│  │ • MCP 配置   │ • 流式输出解析   │ • 流式输出解析   │        │
│  │ • 图片处理   │ • 会话恢复       │ • 会话恢复       │        │
│  └──────────────┴──────────────────┴──────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                            │  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI Provider 层                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ @anthropic-ai/   │  │ cursor-agent │  │ codebuddy CLI    │  │
│  │ claude-agent-sdk │  │ CLI          │  │                  │  │
│  │                  │  │              │  │                  │  │
│  │ • 流式 API       │  │ • 子进程执行 │  │ • 子进程执行     │  │
│  │ • 工具调用       │  │ • stdout解析 │  │ • stdout解析     │  │
│  │ • 会话持久化     │  │ • 本地存储   │  │ • 本地存储       │  │
│  └──────────────────┘  └──────────────┘  └──────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心组件

### 1. 前端组件

#### ChatInterface.jsx
**路径**: `src/components/ChatInterface.jsx`

**核心状态**:
```javascript
const [chatMessages, setChatMessages] = useState([]);      // 聊天消息列表
const [input, setInput] = useState('');                    // 用户输入
const [isLoading, setIsLoading] = useState(false);         // 加载状态
const [currentSessionId, setCurrentSessionId] = useState(null); // 当前会话ID
const [provider, setProvider] = useState('claude');        // AI Provider
const [attachedImages, setAttachedImages] = useState([]);  // 附加图片
const [canAbortSession, setCanAbortSession] = useState(false); // 是否可中止
```

**核心功能**:
- **handleSubmit**: 发送消息到后端
- **useEffect(messages)**: 处理 WebSocket 消息
- **loadSessionMessages**: 加载历史会话
- **handleAbortSession**: 中止当前会话
- **handleImageUpload**: 处理图片上传

---

#### WebSocketContext
**路径**: `src/utils/websocket.js`

**功能**:
- 全局 WebSocket 连接管理
- 自动重连机制 (3秒延迟)
- 消息队列 (发布-订阅模式)
- 认证 Token 传递

**核心代码**:
```javascript
export function useWebSocket() {
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  
  const connect = async () => {
    const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';
    let wsUrl;
    
    if (isPlatform) {
      // 平台模式: 通过代理连接
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws`;
    } else {
      // OSS 模式: 带认证 Token
      const token = localStorage.getItem('auth-token');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    }
    
    const websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
      setIsConnected(true);
      setWs(websocket);
    };
    
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessages(prev => [...prev, data]);
    };
    
    websocket.onclose = () => {
      setIsConnected(false);
      setWs(null);
      setTimeout(() => connect(), 3000); // 自动重连
    };
  };
  
  const sendMessage = (message) => {
    if (ws && isConnected) {
      ws.send(JSON.stringify(message));
    }
  };
  
  return { ws, sendMessage, messages, isConnected };
}
```

---

### 2. 后端组件

#### WebSocket 服务器
**路径**: `server/index.js` (行 718-836)

**核心功能**:
```javascript
function handleChatConnection(ws) {
  console.log('[INFO] Chat WebSocket connected');
  
  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    
    switch (data.type) {
      case 'claude-command':
        await queryClaudeSDK(data.command, data.options, ws);
        break;
        
      case 'cursor-command':
        await spawnCursor(data.command, data.options, ws);
        break;
        
      case 'codebuddy-command':
        await spawnCodeBuddy(data.command, data.options, ws);
        break;
        
      case 'abort-session':
        // 中止会话
        const provider = data.provider || 'claude';
        let success;
        if (provider === 'cursor') {
          success = abortCursorSession(data.sessionId);
        } else if (provider === 'codebuddy') {
          success = abortCodeBuddySession(data.sessionId);
        } else {
          success = await abortClaudeSDKSession(data.sessionId);
        }
        ws.send(JSON.stringify({
          type: 'session-aborted',
          sessionId: data.sessionId,
          success
        }));
        break;
        
      case 'check-session-status':
        // 检查会话状态
        const isActive = isClaudeSDKSessionActive(data.sessionId);
        ws.send(JSON.stringify({
          type: 'session-status',
          sessionId: data.sessionId,
          isProcessing: isActive
        }));
        break;
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Chat client disconnected');
    connectedClients.delete(ws);
  });
}
```

---

#### Claude SDK 集成
**路径**: `server/claude-sdk.js`

**核心功能**:
1. **选项映射** (`mapCliOptionsToSDK`)
2. **MCP 配置加载** (`loadMcpConfig`)
3. **图片处理** (`handleImages`)
4. **会话管理** (`addSession`, `removeSession`, `abortClaudeSDKSession`)
5. **流式查询** (`queryClaudeSDK`)

**关键实现**:

```javascript
// 1. 选项映射
function mapCliOptionsToSDK(options = {}) {
  const sdkOptions = {};
  
  // 工作目录
  if (options.cwd) sdkOptions.cwd = options.cwd;
  
  // 权限模式
  if (options.permissionMode && options.permissionMode !== 'default') {
    sdkOptions.permissionMode = options.permissionMode;
  }
  
  // 工具设置
  const settings = options.toolsSettings || {};
  if (settings.skipPermissions) {
    sdkOptions.permissionMode = 'bypassPermissions';
  } else {
    if (settings.allowedTools?.length > 0) {
      sdkOptions.allowedTools = settings.allowedTools;
    }
    if (settings.disallowedTools?.length > 0) {
      sdkOptions.disallowedTools = settings.disallowedTools;
    }
  }
  
  // 模型配置
  sdkOptions.model = options.model || 'sonnet';
  
  // 系统提示 (启用 CLAUDE.md)
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'
  };
  
  // 会话恢复
  if (options.sessionId) {
    sdkOptions.resume = options.sessionId;
  }
  
  return sdkOptions;
}

// 2. MCP 配置加载
async function loadMcpConfig(cwd) {
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  
  try {
    await fs.access(claudeConfigPath);
  } catch {
    return null; // 配置文件不存在
  }
  
  const configContent = await fs.readFile(claudeConfigPath, 'utf8');
  const claudeConfig = JSON.parse(configContent);
  
  let mcpServers = {};
  
  // 全局 MCP 服务器
  if (claudeConfig.mcpServers) {
    mcpServers = { ...claudeConfig.mcpServers };
  }
  
  // 项目特定 MCP 服务器
  if (claudeConfig.claudeProjects && cwd) {
    const projectConfig = claudeConfig.claudeProjects[cwd];
    if (projectConfig?.mcpServers) {
      mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
    }
  }
  
  return Object.keys(mcpServers).length > 0 ? mcpServers : null;
}

// 3. 图片处理
async function handleImages(command, images, cwd) {
  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths: [], tempDir: null };
  }
  
  // 创建临时目录
  const workingDir = cwd || process.cwd();
  const tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
  await fs.mkdir(tempDir, { recursive: true });
  
  const tempImagePaths = [];
  
  // 保存每张图片
  for (const [index, image] of images.entries()) {
    const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) continue;
    
    const [, mimeType, base64Data] = matches;
    const extension = mimeType.split('/')[1] || 'png';
    const filename = `image_${index}.${extension}`;
    const filepath = path.join(tempDir, filename);
    
    await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
    tempImagePaths.push(filepath);
  }
  
  // 在提示词中添加图片路径
  let modifiedCommand = command;
  if (tempImagePaths.length > 0 && command?.trim()) {
    const imageNote = `\n\n[Images provided at the following paths:]\n${
      tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')
    }`;
    modifiedCommand = command + imageNote;
  }
  
  return { modifiedCommand, tempImagePaths, tempDir };
}

// 4. 主查询函数
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  
  try {
    // 1. 映射选项
    const sdkOptions = mapCliOptionsToSDK(options);
    
    // 2. 加载 MCP 配置
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }
    
    // 3. 处理图片
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;
    
    // 4. 创建 SDK query 实例
    const queryInstance = query({
      prompt: finalCommand,
      options: sdkOptions
    });
    
    // 5. 跟踪会话
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);
    }
    
    // 6. 流式处理消息
    for await (const message of queryInstance) {
      // 捕获会话 ID (首次消息)
      if (message.session_id && !capturedSessionId) {
        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);
        
        // 发送会话创建事件
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(JSON.stringify({
            type: 'session-created',
            sessionId: capturedSessionId
          }));
        }
      }
      
      // 发送消息到 WebSocket
      ws.send(JSON.stringify({
        type: 'claude-response',
        data: message
      }));
      
      // 提取 token 预算
      if (message.type === 'result') {
        const tokenBudget = extractTokenBudget(message);
        if (tokenBudget) {
          ws.send(JSON.stringify({
            type: 'token-budget',
            data: tokenBudget
          }));
        }
      }
    }
    
    // 7. 清理会话
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }
    
    // 8. 清理临时文件
    await cleanupTempFiles(tempImagePaths, tempDir);
    
    // 9. 发送完成事件
    ws.send(JSON.stringify({
      type: 'claude-complete',
      sessionId: capturedSessionId,
      exitCode: 0,
      isNewSession: !sessionId && !!command
    }));
    
  } catch (error) {
    console.error('SDK query error:', error);
    
    // 清理资源
    if (capturedSessionId) removeSession(capturedSessionId);
    await cleanupTempFiles(tempImagePaths, tempDir);
    
    // 发送错误
    ws.send(JSON.stringify({
      type: 'claude-error',
      error: error.message
    }));
    
    throw error;
  }
}

// 5. 会话管理
const activeSessions = new Map();

function addSession(sessionId, queryInstance, tempImagePaths, tempDir) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir
  });
}

async function abortClaudeSDKSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  
  try {
    // 调用 SDK 的 interrupt() 方法
    await session.instance.interrupt();
    session.status = 'aborted';
    
    // 清理临时文件
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);
    
    // 移除会话
    activeSessions.delete(sessionId);
    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}
```

---

## 数据流分析

### 1. 用户发送消息流程

```
[用户输入消息]
       │
       ▼
[handleSubmit() 验证输入]
       │
       ▼
[上传图片 (如有)]
  POST /api/projects/:name/upload-images
       │
       ▼
[添加用户消息到 UI]
  setChatMessages([...prev, userMessage])
       │
       ▼
[设置加载状态]
  setIsLoading(true)
  setCanAbortSession(true)
       │
       ▼
[会话保护: 标记为活跃]
  onSessionActive(sessionId)
       │
       ▼
[获取工具设置]
  getToolsSettings() from localStorage
       │
       ▼
[通过 WebSocket 发送命令]
  sendMessage({
    type: 'claude-command',
    command: input,
    options: { ... }
  })
       │
       ▼
[清理输入状态]
  setInput('')
  setAttachedImages([])
```

---

### 2. 后端处理流程

```
[WebSocket 接收消息]
       │
       ▼
[handleChatConnection]
       │
       ▼
[解析消息类型]
  JSON.parse(message)
       │
       ├──────────────┬──────────────┬──────────────┐
       │              │              │              │
   [claude-      [cursor-      [codebuddy-   [abort-session]
    command]      command]       command]
       │              │              │              │
       ▼              ▼              ▼              ▼
[queryClaudeSDK] [spawnCursor] [spawnCodeBuddy] [abortSession]
       │              │              │              │
       ▼              ▼              ▼              ▼
[Claude SDK]    [child_process] [child_process]  [interrupt()]
       │              │              │              │
       └──────────────┴──────────────┴──────────────┘
                      │
                      ▼
            [流式输出消息]
                      │
                      ▼
         [WebSocket 发送 claude-response]
                      │
                      ▼
              [前端接收并渲染]
```

---

### 3. WebSocket 消息类型

#### 前端 → 后端

| 消息类型 | 说明 | Payload |
|---------|------|---------|
| `claude-command` | 发送 Claude 命令 | `{ command, options: { cwd, sessionId, images, ... } }` |
| `cursor-command` | 发送 Cursor 命令 | `{ command, options: { cwd, sessionId, model, ... } }` |
| `codebuddy-command` | 发送 CodeBuddy 命令 | `{ command, options: { cwd, sessionId, model, ... } }` |
| `abort-session` | 中止会话 | `{ sessionId, provider }` |
| `check-session-status` | 检查会话状态 | `{ sessionId, provider }` |
| `get-active-sessions` | 获取所有活跃会话 | `{}` |

#### 后端 → 前端

| 消息类型 | 说明 | Payload |
|---------|------|---------|
| `session-created` | 新会话已创建 | `{ sessionId }` |
| `claude-response` | Claude 响应消息 | `{ data: { type, content, ... } }` |
| `token-budget` | Token 预算更新 | `{ data: { used, total, percentage } }` |
| `claude-complete` | 会话完成 | `{ sessionId, exitCode, isNewSession }` |
| `claude-error` | 错误消息 | `{ error }` |
| `session-aborted` | 会话已中止 | `{ sessionId, provider, success }` |
| `session-status` | 会话状态 | `{ sessionId, isProcessing }` |
| `projects_updated` | 项目已更新 | `{ projects, changeType, ... }` |

---

### 4. 前端消息处理流程

```javascript
useEffect(() => {
  if (messages.length > 0) {
    const latestMessage = messages[messages.length - 1];
    
    // 会话过滤: 防止跨会话消息干扰
    const globalMessageTypes = ['projects_updated', 'session-created', 'claude-complete'];
    const isGlobalMessage = globalMessageTypes.includes(latestMessage.type);
    
    if (!isGlobalMessage && 
        latestMessage.sessionId && 
        currentSessionId && 
        latestMessage.sessionId !== currentSessionId) {
      // 消息属于其他会话,忽略
      return;
    }
    
    switch (latestMessage.type) {
      case 'session-created':
        // 新会话创建 - 保存真实会话 ID
        if (latestMessage.sessionId && !currentSessionId) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (onReplaceTemporarySession) {
            onReplaceTemporarySession(latestMessage.sessionId);
          }
        }
        break;
        
      case 'claude-response':
        const messageData = latestMessage.data.message || latestMessage.data;
        
        // 处理流式内容
        if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
          const decodedText = decodeHtmlEntities(messageData.delta.text);
          streamBufferRef.current += decodedText;
          
          // 100ms 防抖更新
          if (!streamTimerRef.current) {
            streamTimerRef.current = setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              
              setChatMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && last.isStreaming) {
                  last.content += chunk;
                } else {
                  updated.push({
                    type: 'assistant',
                    content: chunk,
                    timestamp: new Date(),
                    isStreaming: true
                  });
                }
                return updated;
              });
            }, 100);
          }
          return;
        }
        
        // 处理工具使用
        if (Array.isArray(messageData.content)) {
          for (const part of messageData.content) {
            if (part.type === 'tool_use') {
              setChatMessages(prev => [...prev, {
                type: 'assistant',
                content: '',
                timestamp: new Date(),
                isToolUse: true,
                toolName: part.name,
                toolInput: JSON.stringify(part.input, null, 2),
                toolId: part.id
              }]);
            }
          }
        }
        break;
        
      case 'claude-complete':
        setIsLoading(false);
        setCanAbortSession(false);
        
        // 标记会话为非处理状态
        if (onSessionNotProcessing && latestMessage.sessionId) {
          onSessionNotProcessing(latestMessage.sessionId);
        }
        
        // 如果是新会话,导航到会话页面
        if (latestMessage.isNewSession && latestMessage.sessionId) {
          if (onNavigateToSession) {
            onNavigateToSession(latestMessage.sessionId);
          }
        }
        break;
    }
  }
}, [messages]);
```

---

## WebSocket 通信协议

### 连接认证

#### OSS 模式
```javascript
// Token 通过 query 参数传递
const token = localStorage.getItem('auth-token');
const wsUrl = `ws://host/ws?token=${encodeURIComponent(token)}`;
```

#### 平台模式
```javascript
// 通过代理连接,无需传递 Token
const wsUrl = `ws://host/ws`;
```

### 消息格式

所有消息均为 JSON 格式:

```typescript
interface WebSocketMessage {
  type: string;           // 消息类型
  [key: string]: any;     // 其他字段
}
```

---

## 前端实现

### 1. 发送消息函数

```javascript
const handleSubmit = useCallback(async (e) => {
  e.preventDefault();
  
  // 1. 验证
  if (!input.trim() || isLoading || !selectedProject) return;
  
  // 2. 上传图片
  let uploadedImages = [];
  if (attachedImages.length > 0) {
    const formData = new FormData();
    attachedImages.forEach(file => formData.append('images', file));
    
    const response = await authenticatedFetch(
      `/api/projects/${selectedProject.name}/upload-images`, 
      { method: 'POST', body: formData }
    );
    uploadedImages = (await response.json()).images;
  }
  
  // 3. 添加用户消息到 UI
  const userMessage = {
    type: 'user',
    content: input,
    images: uploadedImages,
    timestamp: new Date()
  };
  setChatMessages(prev => [...prev, userMessage]);
  
  // 4. 设置加载状态
  setIsLoading(true);
  setCanAbortSession(true);
  
  // 5. 会话保护
  const effectiveSessionId = currentSessionId || selectedSession?.id;
  const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
  if (onSessionActive) {
    onSessionActive(sessionToActivate);
  }
  
  // 6. 获取工具设置
  const toolsSettings = getToolsSettings();
  
  // 7. 发送消息
  if (provider === 'claude') {
    sendMessage({
      type: 'claude-command',
      command: input,
      options: {
        projectPath: selectedProject.path,
        cwd: selectedProject.fullPath,
        sessionId: currentSessionId,
        resume: !!currentSessionId,
        toolsSettings: toolsSettings,
        permissionMode: permissionMode,
        images: uploadedImages
      }
    });
  }
  
  // 8. 清理输入
  setInput('');
  setAttachedImages([]);
  
}, [dependencies]);
```

---

### 2. 中止会话

```javascript
const handleAbortSession = useCallback(() => {
  if (!currentSessionId || !canAbortSession) return;
  
  console.log('Aborting session:', currentSessionId);
  
  sendMessage({
    type: 'abort-session',
    sessionId: currentSessionId,
    provider: provider
  });
  
  setCanAbortSession(false);
}, [currentSessionId, canAbortSession, provider]);
```

---

### 3. 流式内容渲染

使用 **防抖批量更新** 减少重渲染:

```javascript
const streamBufferRef = useRef('');
const streamTimerRef = useRef(null);

// 在 useEffect 中处理流式内容
if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
  const decodedText = decodeHtmlEntities(messageData.delta.text);
  streamBufferRef.current += decodedText;
  
  // 100ms 防抖
  if (!streamTimerRef.current) {
    streamTimerRef.current = setTimeout(() => {
      const chunk = streamBufferRef.current;
      streamBufferRef.current = '';
      streamTimerRef.current = null;
      
      setChatMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.type === 'assistant' && last.isStreaming) {
          last.content += chunk;
        } else {
          updated.push({
            type: 'assistant',
            content: chunk,
            timestamp: new Date(),
            isStreaming: true
          });
        }
        return updated;
      });
    }, 100);
  }
}
```

---

## 后端实现

### 1. Cursor CLI 集成

**路径**: `server/cursor-cli.js`

```javascript
export async function spawnCursor(command, options = {}, ws) {
  const { sessionId, cwd, model = 'claude-sonnet-4' } = options;
  let capturedSessionId = sessionId;
  
  try {
    // 构建参数
    const args = [];
    
    if (capturedSessionId) {
      args.push('--resume', capturedSessionId);
    }
    
    if (model) {
      args.push('--model', model);
    }
    
    // 添加工具权限
    const toolsSettings = options.toolsSettings || {};
    if (toolsSettings.skipPermissions) {
      args.push('--skip-permissions');
    }
    
    // 启动子进程
    const cursorProcess = spawn('cursor-agent', args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env }
    });
    
    // 跟踪会话
    if (capturedSessionId) {
      activeCursorSessions.set(capturedSessionId, {
        process: cursorProcess,
        startTime: Date.now(),
        status: 'active'
      });
    }
    
    // 处理输出
    cursorProcess.stdout.on('data', (data) => {
      const output = data.toString();
      
      // 解析会话 ID
      const sessionMatch = output.match(/Session ID: ([a-zA-Z0-9_-]+)/);
      if (sessionMatch && !capturedSessionId) {
        capturedSessionId = sessionMatch[1];
        activeCursorSessions.set(capturedSessionId, {
          process: cursorProcess,
          startTime: Date.now(),
          status: 'active'
        });
        
        ws.send(JSON.stringify({
          type: 'session-created',
          sessionId: capturedSessionId
        }));
      }
      
      // 发送输出到 WebSocket
      ws.send(JSON.stringify({
        type: 'claude-response',
        data: { type: 'content_block_delta', delta: { text: output } }
      }));
    });
    
    // 处理进程退出
    cursorProcess.on('close', (code) => {
      if (capturedSessionId) {
        activeCursorSessions.delete(capturedSessionId);
      }
      
      ws.send(JSON.stringify({
        type: 'claude-complete',
        sessionId: capturedSessionId,
        exitCode: code,
        isNewSession: !sessionId && !!command
      }));
    });
    
  } catch (error) {
    console.error('Cursor spawn error:', error);
    ws.send(JSON.stringify({
      type: 'claude-error',
      error: error.message
    }));
  }
}

// 中止 Cursor 会话
export function abortCursorSession(sessionId) {
  const session = activeCursorSessions.get(sessionId);
  if (!session) return false;
  
  try {
    session.process.kill('SIGTERM');
    session.status = 'aborted';
    activeCursorSessions.delete(sessionId);
    return true;
  } catch (error) {
    console.error(`Error aborting Cursor session ${sessionId}:`, error);
    return false;
  }
}
```

---

### 2. CodeBuddy SDK 集成

**路径**: `server/codebuddy-sdk.js`

实现方式与 Cursor CLI 类似,使用 `child_process` 执行 `codebuddy` CLI 命令。

---

## 多 Provider 支持

### Provider 切换

前端通过 `provider` state 控制:

```javascript
const [provider, setProvider] = useState('claude');

// 根据 provider 发送不同消息类型
if (provider === 'claude') {
  sendMessage({ type: 'claude-command', ... });
} else if (provider === 'cursor') {
  sendMessage({ type: 'cursor-command', ... });
} else if (provider === 'codebuddy') {
  sendMessage({ type: 'codebuddy-command', ... });
}
```

### Provider 特性对比

| 特性 | Claude SDK | Cursor CLI | CodeBuddy CLI |
|-----|-----------|-----------|--------------|
| **实现方式** | Node.js SDK | 子进程 | 子进程 |
| **会话管理** | SDK 内置 | 本地文件 | 本地文件 |
| **流式输出** | ✅ 原生支持 | ✅ stdout 解析 | ✅ stdout 解析 |
| **MCP 集成** | ✅ 支持 | ❌ | ❌ |
| **图片处理** | ✅ 临时文件 | ❌ | ❌ |
| **工具权限** | ✅ 细粒度控制 | ✅ skip-permissions | ✅ skip-permissions |
| **模型选择** | ✅ sonnet/opus | ✅ 多模型 | ✅ 多模型 |
| **会话中止** | ✅ interrupt() | ✅ SIGTERM | ✅ SIGTERM |

---

## 会话管理系统

### 1. 会话生命周期

```
[用户发送消息]
       │
       ▼
[生成临时会话 ID]
  `new-session-${Date.now()}`
       │
       ▼
[标记会话为活跃]
  onSessionActive(tempId)
       │
       ▼
[发送到后端]
       │
       ▼
[后端创建真实会话]
       │
       ▼
[返回真实会话 ID]
  session-created { sessionId }
       │
       ▼
[替换临时 ID]
  onReplaceTemporarySession(realId)
       │
       ▼
[会话进行中]
  isProcessing = true
       │
       ▼
[会话完成]
  claude-complete
       │
       ▼
[标记为非活跃]
  onSessionNotProcessing(sessionId)
```

---

### 2. 会话保护机制

**目的**: 防止项目更新中断活跃会话

**实现** (在 `App.jsx`):

```javascript
const [activeSessionIds, setActiveSessionIds] = useState(new Set());
const [sessionsBeingProcessed, setSessionsBeingProcessed] = useState(new Set());

// 标记会话为活跃
const handleSessionActive = useCallback((sessionId) => {
  setActiveSessionIds(prev => new Set(prev).add(sessionId));
  setSessionsBeingProcessed(prev => new Set(prev).add(sessionId));
}, []);

// 标记会话为非活跃
const handleSessionNotProcessing = useCallback((sessionId) => {
  setSessionsBeingProcessed(prev => {
    const newSet = new Set(prev);
    newSet.delete(sessionId);
    return newSet;
  });
}, []);

// 替换临时 ID
const handleReplaceTemporarySession = useCallback((realSessionId) => {
  setActiveSessionIds(prev => {
    const newSet = new Set();
    prev.forEach(id => {
      if (id.startsWith('new-session-')) {
        newSet.add(realSessionId);
      } else {
        newSet.add(id);
      }
    });
    return newSet;
  });
  
  // 同样更新 sessionsBeingProcessed
  setSessionsBeingProcessed(prev => {
    const newSet = new Set();
    prev.forEach(id => {
      if (id.startsWith('new-session-')) {
        newSet.add(realSessionId);
      } else {
        newSet.add(id);
      }
    });
    return newSet;
  });
}, []);

// 在 projects_updated 消息处理中
useEffect(() => {
  // 如果有会话正在处理,暂停侧边栏更新
  if (sessionsBeingProcessed.size > 0) {
    console.log('会话处理中,暂停侧边栏更新');
    return;
  }
  
  // 更新侧边栏项目列表
  if (latestMessage.type === 'projects_updated') {
    setProjects(latestMessage.projects);
  }
}, [messages, sessionsBeingProcessed]);
```

---

### 3. 会话恢复

**前端**:
```javascript
// 恢复会话时传递 sessionId
sendMessage({
  type: 'claude-command',
  command: '', // 空命令表示继续
  options: {
    sessionId: currentSessionId,
    resume: true,
    cwd: projectPath
  }
});
```

**后端 (Claude SDK)**:
```javascript
// 映射到 SDK 的 resume 选项
const sdkOptions = {
  resume: options.sessionId
};
```

**后端 (Cursor CLI)**:
```javascript
// 使用 --resume 参数
const args = ['--resume', sessionId];
const cursorProcess = spawn('cursor-agent', args, { cwd });
```

---

## 图片处理流程

### 1. 前端上传

```javascript
// 上传图片到服务器
const formData = new FormData();
attachedImages.forEach(file => formData.append('images', file));

const response = await authenticatedFetch(
  `/api/projects/${selectedProject.name}/upload-images`, 
  { method: 'POST', body: formData }
);

const uploadedImages = (await response.json()).images;
// [{ data: 'data:image/png;base64,...' }]
```

---

### 2. 后端处理 (Claude SDK)

```javascript
async function handleImages(command, images, cwd) {
  // 1. 创建临时目录
  const tempDir = path.join(cwd, '.tmp', 'images', Date.now().toString());
  await fs.mkdir(tempDir, { recursive: true });
  
  const tempImagePaths = [];
  
  // 2. 保存每张图片
  for (const [index, image] of images.entries()) {
    const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
    const [, mimeType, base64Data] = matches;
    const extension = mimeType.split('/')[1] || 'png';
    const filename = `image_${index}.${extension}`;
    const filepath = path.join(tempDir, filename);
    
    await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
    tempImagePaths.push(filepath);
  }
  
  // 3. 在提示词中添加图片路径
  const imageNote = `\n\n[Images provided at the following paths:]\n${
    tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')
  }`;
  const modifiedCommand = command + imageNote;
  
  return { modifiedCommand, tempImagePaths, tempDir };
}
```

---

### 3. 清理机制

```javascript
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) return;
  
  try {
    // 删除所有临时图片文件
    for (const imagePath of tempImagePaths) {
      try {
        await fs.unlink(imagePath);
      } catch (error) {
        // 忽略删除失败
      }
    }
    
    // 删除临时目录
    if (tempDir) {
      try {
        await fs.rmdir(tempDir, { recursive: true });
      } catch (error) {
        // 忽略删除失败
      }
    }
  } catch (error) {
    console.error('Error cleaning up temp files:', error);
  }
}

// 在会话完成或中止时调用
await cleanupTempFiles(tempImagePaths, tempDir);
```

---

## 工具权限管理

### 1. 前端工具设置

从 `localStorage` 读取:

```javascript
function getToolsSettings() {
  try {
    const stored = localStorage.getItem('tools-settings');
    if (!stored) return null;
    
    const settings = JSON.parse(stored);
    return {
      skipPermissions: settings.skipPermissions || false,
      allowedTools: settings.allowedTools || [],
      disallowedTools: settings.disallowedTools || []
    };
  } catch {
    return null;
  }
}
```

---

### 2. 后端权限映射

```javascript
function mapCliOptionsToSDK(options = {}) {
  const sdkOptions = {};
  const settings = options.toolsSettings || {};
  
  if (settings.skipPermissions) {
    // 跳过所有权限检查
    sdkOptions.permissionMode = 'bypassPermissions';
  } else {
    // 细粒度控制
    if (settings.allowedTools?.length > 0) {
      sdkOptions.allowedTools = settings.allowedTools;
    }
    if (settings.disallowedTools?.length > 0) {
      sdkOptions.disallowedTools = settings.disallowedTools;
    }
  }
  
  return sdkOptions;
}
```

---

### 3. Cursor/CodeBuddy 权限

```javascript
// Cursor CLI
if (toolsSettings.skipPermissions) {
  args.push('--skip-permissions');
}

// CodeBuddy CLI
if (toolsSettings.skipPermissions) {
  args.push('--skip-permissions');
}
```

---

## MCP 集成

### 1. MCP 配置文件

**路径**: `~/.claude.json`

```json
{
  "mcpServers": {
    "global-server": {
      "command": "node",
      "args": ["/path/to/server.js"]
    }
  },
  "claudeProjects": {
    "/path/to/project": {
      "mcpServers": {
        "project-specific-server": {
          "command": "python",
          "args": ["/path/to/server.py"]
        }
      }
    }
  }
}
```

---

### 2. 配置加载

```javascript
async function loadMcpConfig(cwd) {
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  
  try {
    await fs.access(claudeConfigPath);
  } catch {
    return null;
  }
  
  const configContent = await fs.readFile(claudeConfigPath, 'utf8');
  const claudeConfig = JSON.parse(configContent);
  
  let mcpServers = {};
  
  // 全局 MCP 服务器
  if (claudeConfig.mcpServers) {
    mcpServers = { ...claudeConfig.mcpServers };
  }
  
  // 项目特定 MCP 服务器 (覆盖全局配置)
  if (claudeConfig.claudeProjects && cwd) {
    const projectConfig = claudeConfig.claudeProjects[cwd];
    if (projectConfig?.mcpServers) {
      mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
    }
  }
  
  return Object.keys(mcpServers).length > 0 ? mcpServers : null;
}
```

---

### 3. 传递给 SDK

```javascript
const mcpServers = await loadMcpConfig(options.cwd);
if (mcpServers) {
  sdkOptions.mcpServers = mcpServers;
}

const queryInstance = query({
  prompt: command,
  options: sdkOptions
});
```

---

## 性能优化

### 1. WebSocket 连接复用

全局共享单个 WebSocket 连接,避免重复连接:

```javascript
// WebSocketContext.jsx
export const WebSocketProvider = ({ children }) => {
  const webSocketData = useWebSocket();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};
```

---

### 2. 消息防抖

流式更新使用 100ms 防抖,减少重渲染:

```javascript
// 缓冲流式内容
streamBufferRef.current += decodedText;

// 100ms 防抖
if (!streamTimerRef.current) {
  streamTimerRef.current = setTimeout(() => {
    const chunk = streamBufferRef.current;
    streamBufferRef.current = '';
    streamTimerRef.current = null;
    
    // 批量更新 UI
    setChatMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.isStreaming) {
        last.content += chunk;
      }
      return updated;
    });
  }, 100);
}
```

---

### 3. localStorage 配额管理

限制聊天历史数量:

```javascript
const MAX_MESSAGES = 50;

function saveChatHistory(projectName, messages) {
  try {
    // 只保留最近 50 条消息
    const limitedMessages = messages.slice(-MAX_MESSAGES);
    localStorage.setItem(
      `chat_${projectName}`,
      JSON.stringify(limitedMessages)
    );
  } catch (error) {
    console.error('Failed to save chat history:', error);
  }
}
```

---

### 4. 会话过滤

防止跨会话消息干扰:

```javascript
// 全局消息类型 (不受会话 ID 限制)
const globalMessageTypes = [
  'projects_updated', 
  'session-created', 
  'claude-complete'
];

const isGlobalMessage = globalMessageTypes.includes(latestMessage.type);

if (!isGlobalMessage && 
    latestMessage.sessionId && 
    currentSessionId && 
    latestMessage.sessionId !== currentSessionId) {
  // 消息属于其他会话,忽略
  return;
}
```

---

### 5. 消息记忆化

使用 `React.memo` 防止不必要的重渲染:

```javascript
const MessageComponent = React.memo(({ message, onEdit }) => {
  // 渲染逻辑
}, (prevProps, nextProps) => {
  // 自定义比较函数
  return prevProps.message.content === nextProps.message.content;
});
```

---

## 安全机制

### 1. WebSocket 认证

#### OSS 模式
```javascript
// 后端验证
const url = new URL(info.req.url, 'http://localhost');
const token = url.searchParams.get('token');
const user = authenticateWebSocket(token);
if (!user) {
  return false; // 拒绝连接
}
```

#### 平台模式
```javascript
// 后端验证
if (process.env.VITE_IS_PLATFORM === 'true') {
  const user = authenticateWebSocket(null);
  if (!user) {
    return false;
  }
  info.req.user = user;
  return true;
}
```

---

### 2. 路径安全

所有文件操作验证项目根目录:

```javascript
const projectRoot = await extractProjectDirectory(projectName);
const resolved = path.resolve(projectRoot, filePath);
const normalizedRoot = path.resolve(projectRoot) + path.sep;

if (!resolved.startsWith(normalizedRoot)) {
  throw new Error('Path must be under project root');
}
```

---

### 3. 输入验证

验证消息格式和必需字段:

```javascript
ws.on('message', async (message) => {
  try {
    const data = JSON.parse(message);
    
    // 验证消息类型
    if (!data.type) {
      throw new Error('Message type is required');
    }
    
    // 验证必需字段
    if (data.type === 'claude-command') {
      if (!data.options?.cwd) {
        throw new Error('Working directory is required');
      }
    }
    
    // 处理消息...
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      error: error.message
    }));
  }
});
```

---

### 4. 错误隔离

捕获并优雅处理所有错误:

```javascript
try {
  await queryClaudeSDK(data.command, data.options, ws);
} catch (error) {
  console.error('[ERROR] Chat WebSocket error:', error.message);
  ws.send(JSON.stringify({
    type: 'error',
    error: error.message
  }));
}
```

---

### 5. 资源清理

确保临时文件和会话被正确清理:

```javascript
try {
  // 执行操作...
} finally {
  // 清理会话
  if (capturedSessionId) {
    removeSession(capturedSessionId);
  }
  
  // 清理临时文件
  await cleanupTempFiles(tempImagePaths, tempDir);
}
```

---

## 错误处理

### 1. 前端错误处理

```javascript
// WebSocket 连接错误
websocket.onerror = (error) => {
  console.error('WebSocket error:', error);
  setConnectionError('Connection failed. Retrying...');
};

websocket.onclose = () => {
  setIsConnected(false);
  setTimeout(() => connect(), 3000); // 自动重连
};

// 消息发送错误
if (!ws || !isConnected) {
  setError('Not connected to server');
  return;
}
```

---

### 2. 后端错误处理

```javascript
// WebSocket 消息处理错误
ws.on('message', async (message) => {
  try {
    const data = JSON.parse(message);
    // 处理消息...
  } catch (error) {
    console.error('[ERROR] Chat WebSocket error:', error.message);
    ws.send(JSON.stringify({
      type: 'error',
      error: error.message
    }));
  }
});

// SDK 错误处理
try {
  await queryClaudeSDK(command, options, ws);
} catch (error) {
  console.error('SDK query error:', error);
  
  // 清理资源
  if (capturedSessionId) removeSession(capturedSessionId);
  await cleanupTempFiles(tempImagePaths, tempDir);
  
  // 通知前端
  ws.send(JSON.stringify({
    type: 'claude-error',
    error: error.message
  }));
}
```

---

### 3. 会话中止错误

```javascript
async function abortClaudeSDKSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) {
    console.warn(`Session ${sessionId} not found`);
    return false;
  }
  
  try {
    await session.instance.interrupt();
    session.status = 'aborted';
    
    // 清理临时文件
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);
    
    activeSessions.delete(sessionId);
    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}
```

---

## 总结

Chat 功能是一个**高性能、实时、多 Provider 支持的 AI 编程助手对话系统**,具有以下特点:

### 核心优势

1. **✅ 实时通信**: 基于 WebSocket 的双向流式通信
2. **✅ 多 Provider**: 支持 Claude SDK、Cursor CLI、CodeBuddy CLI
3. **✅ 会话管理**: 完善的会话创建、恢复、中止机制
4. **✅ 会话保护**: 防止项目更新中断活跃会话
5. **✅ 图片支持**: Base64 上传 → 临时文件 → 自动清理
6. **✅ 工具权限**: 细粒度的工具权限控制
7. **✅ MCP 集成**: 支持全局和项目特定的 MCP 服务器
8. **✅ 性能优化**: 连接复用、消息防抖、会话过滤
9. **✅ 安全机制**: 认证、路径验证、错误隔离
10. **✅ 错误处理**: 完善的错误捕获和恢复机制

### 关键技术

- **WebSocket**: 双向实时通信
- **流式响应**: 防抖批量更新
- **子进程管理**: Cursor/CodeBuddy CLI 集成
- **临时文件管理**: 图片上传和清理
- **会话持久化**: 本地文件或 SDK 内置
- **自动重连**: 3 秒延迟重连机制

### 适用场景

- AI 编程助手对话
- 代码生成和修改
- 项目管理和导航
- 多会话并行处理
- 团队协作和共享

---

**文档版本**: v1.0  
**最后更新**: 2025-12-11  
**维护者**: ClaudeCodeUI 团队
