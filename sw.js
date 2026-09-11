const CACHE_NAME = 'fedi-list-v2';
const APP_SHELL = [
  '/',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/image/icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET かつ 同一オリジン以外は無視
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // HTMLリクエスト（ルート含む）は必ず Network-First（常に最新を取得）
  const isHtmlRequest = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');

  if (isHtmlRequest) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
            );
          }
          return response;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // その他のアセット（CSS, JS, 画像など）は Stale-While-Revalidate
  // 即座にキャッシュを返しつつ、バックグラウンドで最新を取得して更新
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
          );
        }
        return networkResponse;
      }).catch(() => {/* オフライン時のエラー無視 */});

      // キャッシュがあれば即返却、なければネットワーク完了を待つ
      return cachedResponse || fetchPromise;
    })
  );
});
