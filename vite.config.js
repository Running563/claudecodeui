import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 自动更新 Service Worker 版本号的插件
// 在构建完成后处理 dist/sw.js，不修改源文件
function updateSwVersion() {
  return {
    name: 'update-sw-version',
    closeBundle() {
      const swPath = path.resolve(process.cwd(), 'dist/sw.js')
      if (fs.existsSync(swPath)) {
        let content = fs.readFileSync(swPath, 'utf-8')
        // 使用时间戳作为版本号
        const newVersion = `v${Date.now()}`
        content = content.replace('__SW_VERSION__', newVersion)
        fs.writeFileSync(swPath, content)
        console.log(`\n[SW] Updated CACHE_VERSION to ${newVersion}`)
      }
    }
  }
}

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  // HTTPS configuration - check for certificate files
  const keyPath = path.resolve(process.cwd(), 'waderli-mb1.local-key.pem')
  const certPath = path.resolve(process.cwd(), 'waderli-mb1.local.pem')
  const httpsConfig = fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : false
  
  return {
    plugins: [
      react(),
      // 仅在 build 时更新 SW 版本号
      command === 'build' && updateSwVersion()
    ].filter(Boolean),
    optimizeDeps: {
      // 强制预打包 react-syntax-highlighter 相关依赖，避免开发时加载大量小文件
      include: [
        'react-syntax-highlighter/dist/esm/prism-light',
        'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus',
        'react-syntax-highlighter/dist/esm/languages/prism/javascript',
        'react-syntax-highlighter/dist/esm/languages/prism/typescript',
        'react-syntax-highlighter/dist/esm/languages/prism/jsx',
        'react-syntax-highlighter/dist/esm/languages/prism/tsx',
        'react-syntax-highlighter/dist/esm/languages/prism/css',
        'react-syntax-highlighter/dist/esm/languages/prism/json',
        'react-syntax-highlighter/dist/esm/languages/prism/python',
        'react-syntax-highlighter/dist/esm/languages/prism/bash',
        'react-syntax-highlighter/dist/esm/languages/prism/markdown',
        'react-syntax-highlighter/dist/esm/languages/prism/yaml',
        'react-syntax-highlighter/dist/esm/languages/prism/sql',
        'react-syntax-highlighter/dist/esm/languages/prism/java',
        'react-syntax-highlighter/dist/esm/languages/prism/c',
        'react-syntax-highlighter/dist/esm/languages/prism/cpp',
        'react-syntax-highlighter/dist/esm/languages/prism/go',
        'react-syntax-highlighter/dist/esm/languages/prism/rust',
        'react-syntax-highlighter/dist/esm/languages/prism/diff',
      ],
    },
    server: {
      host: true,  // 监听所有网络接口，允许通过 IP 或域名访问
      allowedHosts: ['localhost', 'waderli-mb1.local', 'dev.piecenote.cn'],
      port: parseInt(env.VITE_PORT) || 5173,
      https: httpsConfig,
      proxy: {
        '/api': `http://localhost:${env.PORT || 3001}`,
        '/ws': {
          target: `ws://localhost:${env.PORT || 3001}`,
          ws: true
        },
        '/shell': {
          target: `ws://localhost:${env.PORT || 3002}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})