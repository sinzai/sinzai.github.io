const fetchBtn = document.getElementById('fetchBtn');
const cancelBtn = document.getElementById('cancelBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const output = document.getElementById('output');
const statusEl = document.getElementById('status');
const progressBarOuter = document.getElementById('progressBarOuter');
const progressBarInner = document.getElementById('progressBarInner');

const REQUEST_DELAY_MS = 250;   // ページ間の待機（レート制限対策）
const MAX_PAGES = 2000;         // 無限ループ防止用の安全上限
const MAX_RETRIES = 3;          // 429発生時の再試行回数

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
  // 総数が不明なので、対数的に伸びる疑似プログレスバーにする
  const pct = Math.min(95, Math.log2(count + 1) * 12);
  progressBarInner.style.width = pct + '%';
  setStatus(`取得中... 現在 ${count} 件取得済み`);
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

// fetchをラップし、429（レート制限）発生時は待機して自動リトライする
async function fetchWithRetry(url, options, signal) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, { ...options, signal });
    if (res.status !== 429) return res;
    attempt++;
    if (attempt > MAX_RETRIES) return res; // これ以上は諦めて呼び出し元にエラー処理を任せる
    const retryAfterHeader = res.headers.get('Retry-After');
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1500 * attempt;
    setStatus(`レート制限を検知しました。${Math.ceil(waitMs / 1000)}秒待機して再試行します (${attempt}/${MAX_RETRIES})...`);
    await sleep(waitMs, signal);
  }
}

const LIST_TYPE_LABEL = { following: 'フォロー中', followers: 'フォロワー' };

fetchBtn.addEventListener('click', async () => {
  const platform = document.getElementById('platform').value;
  let server = document.getElementById('server').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^@/, '');
  const token = document.getElementById('token').value.trim();
  const targetUser = document.getElementById('username').value.trim();
  const listType = document.getElementById('listType').value; // 'following' または 'followers'

  if (!server) {
    alert('サーバーのドメインを入力してください。');
    return;
  }

  resetUI();
  lastServerLabel = server;
  lastListType = listType;
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  fetchBtn.disabled = true;
  cancelBtn.style.display = 'block';
  setStatus('取得を開始しています...');

  try {
    let follows;
    if (platform === 'misskey') {
      follows = await fetchMisskeyList(server, token, targetUser, listType, signal);
    } else {
      follows = await fetchMastodonList(server, token, targetUser, listType, signal);
    }

    // 重複除去 + アルファベット順ソート
    const uniqueSorted = Array.from(new Set(follows)).sort((a, b) => a.localeCompare(b));
    const label = LIST_TYPE_LABEL[listType];

    if (uniqueSorted.length === 0) {
      output.value = `${label}が見つかりませんでした。`;
      setStatus('完了: 0件');
      return;
    }

    output.value = JSON.stringify(uniqueSorted, null, 2);
    setStatus(`完了: ${label}を ${uniqueSorted.length} 件取得しました。`);

    copyBtn.style.display = 'block';
    downloadBtn.style.display = 'block';
    downloadCsvBtn.style.display = 'block';
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus('ユーザーによりキャンセルされました。', true);
      output.value = output.value || 'キャンセルされました。';
    } else if (err instanceof TypeError) {
      // fetch自体が失敗する典型パターン: CORS制限 or ネットワークエラー
      setStatus('通信エラーが発生しました。', true);
      output.value = `エラーが発生しました:\n${err.message}\n\n` +
        'サーバー側のCORS設定によりブラウザから直接アクセスできない場合や、ドメイン名の誤り、ネットワーク接続の問題が考えられます。';
    } else {
      setStatus('エラーが発生しました。', true);
      output.value = `エラーが発生しました:\n${err.message}`;
    }
  } finally {
    finishUI();
  }
});

cancelBtn.addEventListener('click', () => {
  if (currentAbortController) {
    currentAbortController.abort();
  }
});

// Misskey用API処理（listType: 'following' または 'followers'）
async function fetchMisskeyList(server, token, targetUser, listType, signal) {
  let follows = [];
  let untilId = null;
  let hasMore = true;
  let userId = null;
  let page = 0;

  // フォロー中は相手(followee)、フォロワーは相手(follower)のオブジェクトを見る
  const userKey = listType === 'followers' ? 'follower' : 'followee';
  const endpoint = listType === 'followers' ? 'followers' : 'following';

  if (targetUser) {
    const cleanUser = targetUser.replace(/^@/, '');
    const parts = cleanUser.split('@');
    const username = parts[0];
    const host = parts[1] || null;

    const userShowBody = { username, host };
    if (token) userShowBody.i = token;

    const userRes = await fetchWithRetry(`https://${server}/api/users/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userShowBody)
    }, signal);

    if (!userRes.ok) throw new Error('指定されたMisskeyユーザーが見つかりませんでした。');
    const userData = await userRes.json();
    userId = userData.id;
  }

  while (hasMore) {
    page++;
    if (page > MAX_PAGES) {
      throw new Error(`取得ページ数が上限(${MAX_PAGES})に達しました。処理を中断します。`);
    }

    const bodyData = { limit: 100 };
    if (token) bodyData.i = token;
    if (untilId) bodyData.untilId = untilId;
    if (userId) bodyData.userId = userId;

    const res = await fetchWithRetry(`https://${server}/api/users/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }, signal);

    if (!res.ok) {
      if (res.status === 400) throw new Error('APIエラー: パラメータが不正か、非公開アカウントです。');
      if (res.status === 429) throw new Error('レート制限が解除されませんでした。しばらく待ってから再度お試しください。');
      throw new Error(`Misskey API Error (${res.status})`);
    }

    const data = await res.json();

    if (data.length === 0) {
      hasMore = false;
    } else {
      for (const item of data) {
        const u = item[userKey] || item.followee || item.follower;
        if (u) {
          const uHost = u.host || server;
          follows.push(`@${u.username}@${uHost}`);
        }
      }
      untilId = data[data.length - 1].id;
      setProgress(follows.length);
      await sleep(REQUEST_DELAY_MS, signal);
    }
  }
  return follows;
}

// Mastodon用API処理（listType: 'following' または 'followers'）
async function fetchMastodonList(server, token, targetUser, listType, signal) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const endpoint = listType === 'followers' ? 'followers' : 'following';
  let accountId = null;

  if (targetUser) {
    const cleanUser = targetUser.replace(/^@/, '');
    const lookupRes = await fetchWithRetry(`https://${server}/api/v1/accounts/lookup?acct=${encodeURIComponent(cleanUser)}`, { headers }, signal);
    if (!lookupRes.ok) throw new Error('指定されたユーザーが見つかりませんでした。');
    const targetAccount = await lookupRes.json();
    accountId = targetAccount.id;
  } else {
    if (!token) throw new Error('ユーザー名が未入力の場合、自分自身の情報を取得するためにアクセストークンが必要です。');
    const verifyRes = await fetchWithRetry(`https://${server}/api/v1/accounts/verify_credentials`, { headers }, signal);
    if (!verifyRes.ok) throw new Error('アクセストークンの検証に失敗しました。トークンを確認してください。');
    const me = await verifyRes.json();
    accountId = me.id;
  }

  let follows = [];
  let url = `https://${server}/api/v1/accounts/${accountId}/${endpoint}?limit=80`;
  let page = 0;

  while (url) {
    page++;
    if (page > MAX_PAGES) {
      throw new Error(`取得ページ数が上限(${MAX_PAGES})に達しました。処理を中断します。`);
    }

    const res = await fetchWithRetry(url, { headers }, signal);
    if (!res.ok) {
      if (res.status === 429) throw new Error('レート制限が解除されませんでした。しばらく待ってから再度お試しください。');
      throw new Error(`Mastodon API Error (${res.status})`);
    }
    const data = await res.json();

    for (const u of data) {
      const fullAcct = u.acct.includes('@') ? u.acct : `${u.acct}@${server}`;
      follows.push(`@${fullAcct}`);
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

// クリップボードへコピー
copyBtn.addEventListener('click', () => {
  output.select();
  navigator.clipboard.writeText(output.value)
    .then(() => setStatus('JSONテキストをクリップボードにコピーしました。'))
    .catch(() => alert('コピーに失敗しました。'));
});

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

// JSONファイルのダウンロード
downloadBtn.addEventListener('click', () => {
  triggerDownload(output.value, 'application/json', 'json');
});

// CSVファイルのダウンロード
downloadCsvBtn.addEventListener('click', () => {
  try {
    const list = JSON.parse(output.value);
    if (!Array.isArray(list)) throw new Error('not an array');
    const csv = ['acct'].concat(list).map(row => `"${String(row).replace(/"/g, '""')}"`).join('\n');
    triggerDownload(csv, 'text/csv', 'csv');
  } catch (e) {
    alert('CSVへの変換に失敗しました。');
  }
});
