document.getElementById('fetchBtn').addEventListener('click', async () => {
  const platform = document.getElementById('platform').value;
  let server = document.getElementById('server').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = document.getElementById('token').value.trim();
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
      follows = await fetchMisskeyFollows(server, token);
    } else {
      follows = await fetchMastodonFollows(server, token);
    }

    if (follows.length === 0) {
      output.value = 'フォローが見つかりませんでした。';
      return;
    }

    // パターンA: JSON配列形式で整形して出力
    output.value = JSON.stringify(follows, null, 2);
    
    copyBtn.style.display = 'block';
    downloadBtn.style.display = 'block';
  } catch (err) {
    output.value = `エラーが発生しました:\n${err.message}`;
  }
});

// Misskey用API処理
async function fetchMisskeyFollows(server, token) {
  let follows = [];
  let untilId = null;
  let hasMore = true;

  while (hasMore) {
    const bodyData = { limit: 100 };
    if (token) bodyData.i = token;
    if (untilId) bodyData.untilId = untilId;

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
        const host = u.host || server;
        follows.push(`@${u.username}@${host}`);
      }
      untilId = data[data.length - 1].id;
    }
  }
  return follows;
}

// Mastodon用API処理
async function fetchMastodonFollows(server, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // 1. アカウントIDの取得
  const verifyRes = await fetch(`https://${server}/api/v1/accounts/verify_credentials`, { headers });
  if (!verifyRes.ok) throw new Error('アクセストークンの検証に失敗しました。');
  const me = await verifyRes.json();

  // 2. フォロー一覧を取得
  let follows = [];
  let url = `https://${server}/api/v1/accounts/${me.id}/following?limit=80`;

  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Mastodon API Error (${res.status})`);
    const data = await res.json();

    for (const u of data) {
      const fullAcct = u.acct.includes('@') ? u.acct : `${u.acct}@${server}`;
      follows.push(`@${fullAcct}`);
    }

    // ページネーション (Linkヘッダーの確認)
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
