const CACHE_NAME = 'sec-link-v1';
const NETWORK_TIMEOUT_MS = 4000;
const urlsToCache = [
  '/',
  '/index.html',
  '/404.html',
  '/style.css',
  '/pwa.js',
  '/manifest.json',
  '/image/favicon.png',
  '/image/bg.png'
];

// インストール時にアセットをキャッシュ（1件失敗しても全体は失敗させない）
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(urlsToCache.map((url) => cache.add(url)))
    )
  );
});

// 古いキャッシュの削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

const fetchWithTimeout = (request) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // GET 以外・外部ドメインは対象外
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetchWithTimeout(request);
      // 200 のみ保存する。/<base64> が返す 404 はキャッシュしない
      if (response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    } catch (_) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;

      if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
        // トップはindex.html、それ以外（変換リンク /<base64>）は404.htmlが解読して確認画面を出す
        const isHome = url.pathname === '/' || url.pathname === '/index.html';
        const fallback = await caches.match(isHome ? '/index.html' : '/404.html');
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
