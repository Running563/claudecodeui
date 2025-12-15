# Claude Code UI

基于 Web 的跨平台桌面和移动端界面，用于管理 Claude Code、Cursor CLI 和 CodeBuddy Code 等 AI 编程助手。提供统一的界面来查看项目、管理会话、编辑文件、与 AI 对话以及执行 Shell 命令。

## 技术栈

- **前端**: React 18, Vite 7, Tailwind CSS, CodeMirror 6, xterm.js
- **后端**: Node.js (v20+), Express 4, WebSocket, node-pty
- **数据库**: SQLite3 (认证/会话管理)
- **AI 集成**: Claude Agents SDK, Cursor CLI, CodeBuddy SDK

## 项目结构

```
src/                    # 前端 React 应用
├── components/         # React 组件 (ChatInterface, FileTree, CodeEditor 等)
├── contexts/           # React Context 提供者 (Auth, Theme, WebSocket)
├── hooks/              # 自定义 React Hooks
├── utils/              # 工具函数 (api.js, websocket.js)
└── lib/                # 库工具

server/                 # 后端 Node.js/Express 应用
├── index.js            # 主 Express 服务器 (含 WebSocket 和 PTY)
├── routes/             # Express 路由处理器
├── middleware/         # 认证中间件
├── database/           # SQLite 数据库层
└── utils/              # 后端工具
```

## 开发命令

```bash
npm install             # 安装依赖
npm run dev             # 启动开发服务器 (后端 + Vite 热更新)
npm run build           # 生产环境构建
npm run start           # 构建并启动生产服务器
npm run server          # 仅启动后端
npm run client          # 仅启动 Vite 开发服务器
```

## 编码规范

### 前端
- 使用函数式 React 组件配合 Hooks
- 使用 Context API 管理全局状态 (AuthContext, ThemeContext, WebSocketContext)
- 使用 Tailwind CSS 工具类进行样式设计
- 使用 CSS 变量定义主题颜色 (--border, --foreground 等)
- 自定义 Hooks 以 `use` 为前缀，回调处理函数以 `on` 为前缀
- 使用 useLocalStorage Hook 进行客户端持久化存储

### 后端
- 在 `/server/routes/` 目录中组织路由模块
- 使用中间件进行 JWT 认证验证
- 使用 try-catch 处理错误并返回适当的 HTTP 状态码
- 文件操作使用 async/await 配合 fs.promises
- 验证路径以防止目录遍历攻击
- 退出时清理子进程

### 通用
- 当前未配置专用测试框架
- 使用描述性的组件/函数命名
- 常量使用 UPPER_SNAKE_CASE 命名
- 统一使用 2 空格缩进
