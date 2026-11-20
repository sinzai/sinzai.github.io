// SecureLink — PWA 補助: Service Worker 登録 / オフライン表示 / インストール案内
(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  const badge = document.getElementById('offlineBadge');
  if (badge) {
    const sync = () => badge.classList.toggle('hidden', navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
  }

  const btn = document.getElementById('installBtn');
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (btn) btn.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    if (btn) btn.classList.add('hidden');
  });
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      btn.classList.add('hidden');
    });
  }
})();
