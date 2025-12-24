// Service Worker for Claude Code UI PWA
// 更新此版本号会触发缓存清理
const CACHE_VERSION = 'v3';
const CACHE_NAME = `claude-ui-${CACHE_VERSION}`;

// 需要缓存的静态资源扩展名（带 hash 的文件可以长期缓存）
const CACHEABLE_EXTENSIONS = [
  '.js', '.css', '.woff', '.woff2', '.ttf', '.eot',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'
];

// 不缓存的路径前缀（API 请求等）
const EXCLUDED_PATHS = [
  '/api/',
  '/ws',
  '/socket',
  '/pty'
];

// 需要 Network First 的路径（HTML 入口等关键文件）
const NETWORK_FIRST_PATHS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// 判断是否需要 Network First 策略
function isNetworkFirst(url) {
  const pathname = url.pathname;
  return NETWORK_FIRST_PATHS.some(path => pathname === path);
}

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
  
  return true;
}

// 判断是否为带 hash 的静态资源（Vite 打包的文件如 index-abc123.js）
function isHashedAsset(url) {
  const pathname = url.pathname;
  // 匹配 Vite 打包的文件名模式: name-hash.ext 或 name.hash.ext
  return /[-\.][a-f0-9]{8,}\.(js|css|woff2?|ttf|eot|png|jpg|jpeg|gif|svg|ico|webp)$/i.test(pathname);
}

// Install event
self.addEventListener('install', event => {
  console.log(`[SW] Installing ${CACHE_NAME}`);
  // 跳过等待，立即激活
  self.skipWaiting();
});

// Fetch event
self.addEventListener('fetch', event => {
  const request = event.request;
  
  // 非可缓存请求直接走网络
  if (!isCacheableRequest(request)) {
    return;
  }
  
  const url = new URL(request.url);
  
  // HTML 和关键文件使用 Network First 策略
  if (isNetworkFirst(url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // 带 hash 的静态资源使用 Cache First（因为 hash 变化意味着新文件）
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // 其他静态资源使用 Stale-While-Revalidate
  if (CACHEABLE_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});

// Network First 策略：优先网络，失败时用缓存
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Cache First 策略：优先缓存，没有则网络获取
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  const response = await fetch(request);
  if (response && response.status === 200 && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

// Stale-While-Revalidate 策略：返回缓存同时后台更新
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await caches.match(request);
  
  // 后台更新缓存
  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  
  // 有缓存就先返回缓存
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // 没有缓存则等待网络
  return fetchPromise;
}

// Activate event - 清理旧缓存
self.addEventListener('activate', event => {
  console.log(`[SW] Activating ${CACHE_NAME}`);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // 删除所有不是当前版本的缓存
          if (cacheName !== CACHE_NAME && cacheName.startsWith('claude-ui-')) {
            console.log(`[SW] Deleting old cache: ${cacheName}`);
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

// 监听来自页面的消息
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
    });
  }
});