const fetchBtn = document.getElementById('fetchBtn');
const cancelBtn = document.getElementById('cancelBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const output = document.getElementById('output');
const statusEl = document.getElementById('status');
const progressBarOuter = document.getElementById('progressBarOuter');
const progressBarInner = document.getElementById('progressBarInner');

const REQUEST_DELAY_MS = 250;
const MAX_PAGES = 2000;
const MAX_RETRIES = 3;

let currentAbortController = null;
let lastServerLabel = 'fediverse';
let lastListType = 'following';

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setProgress(count) {
  progressBarOuter.style.display = 'block';
  const pct = Math.min(95, Math.log2(count + 1) * 12);
  progressBarInner.style.width = pct + '%';
  setStatus(`[FETCHING] Count: ${count} entries loaded...`);
}

function resetUI() {
  copyBtn.style.display = 'none';
  downloadBtn.style.display = 'none';
  downloadCsvBtn.style.display = 'none';
  progressBarOuter.style.display = 'none';
  progressBarInner.style.width = '0%';
  setStatus('');
  output.value = '';
}

function finishUI() {
  fetchBtn.disabled = false;
  cancelBtn.style.display = 'none';
  progressBarOuter.style.display = 'none';
  currentAbortController = null;
}

async function fetchWithRetry(url, options, signal) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, { ...options, signal });
    if (res.status !== 429) return res;
    attempt++;
    if (attempt > MAX_RETRIES) return res;
    const retryAfterHeader = res.headers.get('Retry-After');
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1500 * attempt;
    setStatus(`[WARN] Rate limit hit. Retrying in ${Math.ceil(waitMs / 1000)}s (${attempt}/${MAX_RETRIES})...`, true);
    await sleep(waitMs, signal);
  }
}

fetchBtn.addEventListener('click', async () => {
  const platform = document.getElementById('platform').value;
  let server = document.getElementById('server').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^@/, '');
  const token = document.getElementById('token').value.trim();
  const targetUser = document.getElementById('username').value.trim();
  const listType = document.getElementById('listType').value;

  if (!server) {
    alert('[ERROR] Target Instance Host is required.');
    return;
  }

  resetUI();
  lastServerLabel = server;
  lastListType = listType;
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  fetchBtn.disabled = true;
  cancelBtn.style.display = 'block';
  setStatus('[INIT] Initializing fetch sequence...');

  try {
    let follows;
    if (platform === 'misskey') {
      follows = await fetchMisskeyList(server, token, targetUser, listType, signal);
    } else {
      follows = await fetchMastodonList(server, token, targetUser, listType, signal);
    }

    const uniqueSorted = Array.from(new Set(follows)).sort((a, b) => a.localeCompare(b));

    if (uniqueSorted.length === 0) {
      output.value = `// [RESULT]: No ${listType} records found.`;
      setStatus('[SUCCESS] Fetch completed (0 records).');
      return;
    }

    output.value = JSON.stringify(uniqueSorted, null, 2);
    setStatus(`[SUCCESS] Extracted ${uniqueSorted.length} entries.`);

    copyBtn.style.display = 'inline-block';
    downloadBtn.style.display = 'inline-block';
    downloadCsvBtn.style.display = 'inline-block';
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus('[ABORTED] Operation canceled by user.', true);
      output.value = '// Process terminated.';
    } else {
      setStatus(`[ERROR] ${err.message}`, true);
      output.value = `// Exception caught:\n${err.message}`;
    }
  } finally {
    finishUI();
  }
});

cancelBtn.addEventListener('click', () => {
  if (currentAbortController) currentAbortController.abort();
});

// Misskey API Integration
async function fetchMisskeyList(server, token, targetUser, listType, signal) {
  let follows = [];
  let untilId = null;
  let hasMore = true;
  let userId = null;
  let page = 0;

  const userKey = listType === 'followers' ? 'follower' : 'followee';
  const endpoint = listType === 'followers' ? 'followers' : 'following';

  if (targetUser) {
    const cleanUser = targetUser.replace(/^@/, '');
    const parts = cleanUser.split('@');
    const userShowBody = { username: parts[0], host: parts[1] || null };
    if (token) userShowBody.i = token;

    const userRes = await fetchWithRetry(`https://${server}/api/users/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userShowBody)
    }, signal);

    if (!userRes.ok) throw new Error('Target Misskey user not found.');
    const userData = await userRes.json();
    userId = userData.id;
  }

  while (hasMore) {
    page++;
    if (page > MAX_PAGES) throw new Error('Maximum page threshold exceeded.');

    const bodyData = { limit: 100 };
    if (token) bodyData.i = token;
    if (untilId) bodyData.untilId = untilId;
    if (userId) bodyData.userId = userId;

    const res = await fetchWithRetry(`https://${server}/api/users/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }, signal);

    if (!res.ok) throw new Error(`Misskey API Exception (${res.status})`);
    const data = await res.json();

    if (data.length === 0) {
      hasMore = false;
    } else {
      for (const item of data) {
        const u = item[userKey] || item.followee || item.follower;
        if (u) {
          follows.push(`${u.username}@${u.host || server}`);
        }
      }
      untilId = data[data.length - 1].id;
      setProgress(follows.length);
      await sleep(REQUEST_DELAY_MS, signal);
    }
  }
  return follows;
}

// Mastodon API Integration
async function fetchMastodonList(server, token, targetUser, listType, signal) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const endpoint = listType === 'followers' ? 'followers' : 'following';
  let accountId = null;

  if (targetUser) {
    const cleanUser = targetUser.replace(/^@/, '');
    const lookupRes = await fetchWithRetry(`https://${server}/api/v1/accounts/lookup?acct=${encodeURIComponent(cleanUser)}`, { headers }, signal);
    if (!lookupRes.ok) throw new Error('Target account lookup failed.');
    const targetAccount = await lookupRes.json();
    accountId = targetAccount.id;
  } else {
    if (!token) throw new Error('Access token required for own account fetch.');
    const verifyRes = await fetchWithRetry(`https://${server}/api/v1/accounts/verify_credentials`, { headers }, signal);
    if (!verifyRes.ok) throw new Error('Invalid credentials.');
    const me = await verifyRes.json();
    accountId = me.id;
  }

  let follows = [];
  let url = `https://${server}/api/v1/accounts/${accountId}/${endpoint}?limit=80`;
  let page = 0;

  while (url) {
    page++;
    if (page > MAX_PAGES) throw new Error('Maximum page threshold exceeded.');

    const res = await fetchWithRetry(url, { headers }, signal);
    if (!res.ok) throw new Error(`Mastodon API Exception (${res.status})`);
    const data = await res.json();

    for (const u of data) {
      follows.push(u.acct.includes('@') ? u.acct : `${u.acct}@${server}`);
    }
    setProgress(follows.length);

    const linkHeader = res.headers.get('Link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = match ? match[1] : null;
    } else {
      url = null;
    }

    if (url) await sleep(REQUEST_DELAY_MS, signal);
  }
  return follows;
}

function triggerDownload(content, mimeType, extension) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${lastListType}_${lastServerLabel}_${today}.${extension}`;
  a.click();
  URL.revokeObjectURL(url);
}

downloadBtn.addEventListener('click', () => triggerDownload(output.value, 'application/json', 'json'));
downloadCsvBtn.addEventListener('click', () => {
  try {
    const list = JSON.parse(output.value);
    const cleaned = list.map(row => String(row).replace(/^@/, ''));
    const csv = ['acct'].concat(cleaned).map(row => `"${row.replace(/"/g, '""')}"`).join('\n');
    triggerDownload(csv, 'text/csv', 'csv');
  } catch (e) {
    alert('[ERROR] CSV conversion failed.');
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    const original = copyBtn.textContent;
    copyBtn.textContent = '[COPIED_TO_CLIPBOARD]';
    setTimeout(() => { copyBtn.textContent = original; }, 1500);
  } catch (e) {
    alert('[ERROR] Clipboard write failed.');
  }
});

// PWA Support & Install Event Prompt
const offlineBanner = document.getElementById('offlineBanner');
const pwaStatus = document.getElementById('pwaStatus');
const pwaInstallBtn = document.getElementById('pwaInstallBtn');
let deferredPrompt = null;

window.addEventListener('online', () => { if (offlineBanner) offlineBanner.hidden = true; });
window.addEventListener('offline', () => { if (offlineBanner) offlineBanner.hidden = false; });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(() => {
      if (pwaStatus) pwaStatus.textContent = 'SYSTEM: ONLINE (SERVICE_WORKER_ACTIVE)';
    });
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (pwaInstallBtn) {
    pwaInstallBtn.style.display = 'inline-block';
    pwaInstallBtn.addEventListener('click', () => {
      pwaInstallBtn.style.display = 'none';
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
    });
  }
});
