// Service Worker for Claude Code UI PWA
const CACHE_NAME = 'claude-ui-v2';

// 需要缓存的静态资源扩展名
const CACHEABLE_EXTENSIONS = [
  '.js', '.css', '.woff', '.woff2', '.ttf', '.eot',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.json', '.html'
];

// 不缓存的路径前缀（API 请求等）
const EXCLUDED_PATHS = [
  '/api/',
  '/ws',
  '/socket',
  '/pty'
];

// 判断是否为可缓存的静态资源
function isCacheableRequest(request) {
  const url = new URL(request.url);
  
  // 只缓存 http/https 协议
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  
  // 只缓存 GET 请求
  if (request.method !== 'GET') {
    return false;
  }
  
  // 排除 API 和 WebSocket 请求
  for (const path of EXCLUDED_PATHS) {
    if (url.pathname.startsWith(path)) {
      return false;
    }
  }
  
  // 排除带查询参数的动态请求（通常是 API）
  // 但允许带 hash 的资源文件（如 Vite 打包的文件）
  if (url.search && !url.pathname.match(/\.[a-z0-9]+$/i)) {
    return false;
  }
  
  // 检查是否为静态资源
  const pathname = url.pathname.toLowerCase();
  
  // 允许根路径
  if (pathname === '/' || pathname === '/index.html') {
    return true;
  }
  
  // 检查扩展名
  return CACHEABLE_EXTENSIONS.some(ext => pathname.endsWith(ext));
}

// Install event
self.addEventListener('install', event => {
  // 跳过等待，立即激活
  self.skipWaiting();
});

// Fetch event - 仅缓存静态资源
self.addEventListener('fetch', event => {
  const request = event.request;
  
  // 非可缓存请求直接走网络
  if (!isCacheableRequest(request)) {
    return;
  }
  
  // 静态资源使用 Cache First 策略
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // 从网络获取并缓存
      return fetch(request).then(response => {
        // 只缓存成功的响应
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        
        // 克隆响应用于缓存
        const responseToCache = response.clone();
        
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });
        
        return response;
      });
    })
  );
});

// Activate event - 清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 立即接管所有页面
      return self.clients.claim();
    })
  );
});