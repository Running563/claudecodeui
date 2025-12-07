import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

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
    plugins: [react()],
    server: {
      host: true,  // 监听所有网络接口，允许通过 IP 或域名访问
      allowedHosts: ['localhost', 'waderli-mb1.local'],
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