启动 HTTP 服务
codebuddy --serve [--port PORT] [--host HOST]
--port: 指定服务端口，默认为随机可用端口
--host: 指定服务主机，默认为 127.0.0.1
服务启动后会在控制台显示服务端点地址，例如：http://127.0.0.1:3000

注意：这是 CodeBuddy CLI 自己启动的 HTTP 服务，不是 Node.js Web 服务器。
需要单独运行 `codebuddy --serve` 命令来启动此服务。

API 基础信息
Base URL: http://127.0.0.1:{PORT}
Content-Type: application/json
HTTP Method: 主要使用 POST 方法，OAuth 回调使用 GET
响应格式: JSON 或 HTML（OAuth 回调）
自定义请求头: 在 HTTP 请求中添加自定义请求头（非标准 HTTP 头）将被转发到模型服务，用于扩展功能和集成
API 端点列表
1. Agent 接口
运行 Agent
POST /agent
请求体:

{
  "prompt": "string",
  "debug": "boolean | string",
  "verbose": "boolean",
  "print": "boolean",
  "outputFormat": "text | json | stream-json",
  "inputFormat": "text | stream-json",
  "dangerouslySkipPermissions": "boolean",
  "permissionMode": "acceptEdits | bypassPermissions | default | plan",
  "allowedTools": ["string"],
  "disallowedTools": ["string"],
  "mcpConfig": "string",
  "continue": "boolean",
  "resume": "string",
  "model": "string",
  "fallbackModel": "string",
  "addDir": ["string"],
  "ide": "boolean",
  "strictMcpConfig": "boolean",
  "sessionId": "string"
}
响应: 根据 outputFormat 参数返回不同格式：

text (默认): 返回纯文本响应

Content-Type: text/plain

Here is the generated code for your Express.js server:

const express = require('express');
const app = express();
// ... 其他代码
json: 返回 JSON 格式的完整结果

{
  "output": "Here is the generated code for your Express.js server:\n\nconst express = require('express');\nconst app = express();\n// ... 其他代码",
  "usage": {
    "inputTokens": 100,
    "outputTokens": 200,
    "totalTokens": 300
  },
  "model": "gpt-5"
}
stream-json: 返回 Server-Sent Events 流式响应

Content-Type: text/event-stream

event: next
data: {"type": "system", "subtype": "init", "session_id": "abc123", ...}

event: next  
data: {"type": "assistant", "message": {"content": [{"type": "text", "text": "I'll help you create..."}]}}

event: done
data: {}
描述: 执行 AI Agent 请求，支持所有 CLI 参数作为请求参数

自定义请求头处理:

在 HTTP 请求中传递的任何非标准 HTTP 头都会被保留
标准 HTTP 头（如 Host, User-Agent, Content-Type 等）会被过滤出去
保留的自定义头会优先级最高地转发给模型服务请求
示例：
curl -X POST http://127.0.0.1:3000/agent \
  -H "Content-Type: application/json" \
  -H "X-Custom-Header: custom-value" \
  -H "X-API-Version: v2" \
  -d '{"prompt": "Say hello"}'
在上述请求中，X-Custom-Header 和 X-API-Version 会被转发到模型服务。