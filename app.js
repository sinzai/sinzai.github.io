document.getElementById('fetchBtn').addEventListener('click', async () => {
  const platform = document.getElementById('platform').value;
  let server = document.getElementById('server').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = document.getElementById('token').value.trim();
  const targetUser = document.getElementById('username').value.trim();
  const output = document.getElementById('output');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');

  if (!server) {
    alert('サーバーのドメインを入力してください。');
    return;
  }

  output.value = '取得中... (人数が多い場合は少し時間がかかります)';
  copyBtn.style.display = 'none';
  downloadBtn.style.display = 'none';

  try {
    let follows = [];
    if (platform === 'misskey') {
      follows = await fetchMisskeyFollows(server, token, targetUser);
    } else {
      follows = await fetchMastodonFollows(server, token, targetUser);
    }

    if (follows.length === 0) {
      output.value = 'フォローが見つかりませんでした。';
      return;
    }

    output.value = JSON.stringify(follows, null, 2);
    
    copyBtn.style.display = 'block';
    downloadBtn.style.display = 'block';
  } catch (err) {
    output.value = `エラーが発生しました:\n${err.message}`;
  }
});

// Misskey用API処理
async function fetchMisskeyFollows(server, token, targetUser) {
  let follows = [];
  let untilId = null;
  let hasMore = true;

  let username = null;
  let host = null;
  if (targetUser) {
    const cleanUser = targetUser.replace(/^@/, '');
    const parts = cleanUser.split('@');
    username = parts[0];
    if (parts.length > 1) {
      host = parts[1];
    }
  }

  while (hasMore) {
    const bodyData = { limit: 100 };
    if (token) bodyData.i = token;
    if (untilId) bodyData.untilId = untilId;

    if (username) {
      bodyData.username = username;
      if (host) bodyData.host = host;
    }

    const res = await fetch(`https://${server}/api/users/following`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });

    if (!res.ok) throw new Error(`Misskey API Error (${res.status})`);
    const data = await res.json();

    if (data.length === 0) {
      hasMore = false;
    } else {
      for (const item of data) {
        const u = item.followee;
        const uHost = u.host || server;
        follows.push(`@${u.username}@${uHost}`);
      }
      untilId = data[data.length - 1].id;
    }
  }
  return follows;
}

// Mastodon用API処理
async function fetchMastodonFollows(server, token, targetUser) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let accountId = null;

  if (targetUser) {
    const cleanUser = targetUser.replace(/^@/, '');
    const lookupRes = await fetch(`https://${server}/api/v1/accounts/lookup?acct=${encodeURIComponent(cleanUser)}`, { headers });
    if (!lookupRes.ok) throw new Error('指定されたユーザーが見つかりませんでした。');
    const targetAccount = await lookupRes.json();
    accountId = targetAccount.id;
  } else {
    const verifyRes = await fetch(`https://${server}/api/v1/accounts/verify_credentials`, { headers });
    if (!verifyRes.ok) throw new Error('アクセストークンの検証に失敗しました。トークンを確認してください。');
    const me = await verifyRes.json();
    accountId = me.id;
  }

  let follows = [];
  let url = `https://${server}/api/v1/accounts/${accountId}/following?limit=80`;

  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Mastodon API Error (${res.status})`);
    const data = await res.json();

    for (const u of data) {
      const fullAcct = u.acct.includes('@') ? u.acct : `${u.acct}@${server}`;
      follows.push(`@${fullAcct}`);
    }

    const linkHeader = res.headers.get('Link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = match ? match[1] : null;
    } else {
      url = null;
    }
  }
  return follows;
}

// クリップボードへコピー
document.getElementById('copyBtn').addEventListener('click', () => {
  const output = document.getElementById('output');
  output.select();
  navigator.clipboard.writeText(output.value);
  alert('JSONテキストをクリップボードにコピーしました！');
});

// JSONファイルのダウンロード
document.getElementById('downloadBtn').addEventListener('click', () => {
  const content = document.getElementById('output').value;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const server = document.getElementById('server').value.trim() || 'fediverse';
  const today = new Date().toISOString().slice(0, 10);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `follows_${server}_${today}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
});
