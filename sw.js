// Fediverse リスト取得ツール — Service Worker
// 戦略: ネットワークファースト（まずネットワークを試し、失敗時のみキャッシュを使う）
// これにより、オフライン時でもアプリの起動自体は可能にしつつ、
// 通常時は常に最新のファイルが使われるようにする。

const CACHE_VERSION = 'v1';
const CACHE_NAME = `fedi-list-shell-${CACHE_VERSION}`;

// 起動に必要な最小限のアプリシェルのみ事前キャッシュする
// (API通信先は外部の様々なインスタンドなので、ここではキャッシュしない)
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
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
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET以外や外部API(Mastodon/Misskeyサーバーへの通信)はSWを介さず素通しする
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(networkFirst(req));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    // 成功したレスポンスは常にキャッシュを更新しておく
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // ネットワーク失敗時はキャッシュにフォールバック
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    // ナビゲーション要求でキャッシュも無ければ、せめてアプリシェルを返す
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
