import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Service Worker 更新检测
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => {
    // 检查更新
    registration.update().catch(err => {
      console.warn('SW update check failed:', err);
    });
    
    // 监听新 SW 安装完成
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // 新版本已安装，通知用户刷新（可选：自动刷新）
            console.log('[SW] New version available, refresh to update');
            // 自动激活新 SW
            newWorker.postMessage('skipWaiting');
          }
        });
      }
    });
  });
  
  // 当新 SW 接管后刷新页面
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      console.log('[SW] Controller changed, reloading...');
      window.location.reload();
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
