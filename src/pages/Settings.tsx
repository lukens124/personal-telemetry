import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'preact/hooks';
import { db } from '../data/db';
import { refreshSyncState, runSync, useSyncState } from '../sync/auto';
import { pairingLink, parsePairing } from '../sync/pair';
import { exportJson, getConfig, setConfig } from '../sync/sync';
import { ConfirmButton, useNav } from '../ui/kit';

function ago(ts: number | null): string {
  if (!ts) return '尚未同步';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  return new Date(ts).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' });
}

/** Page 3.0 系統設定 */
export function Settings() {
  const nav = useNav();
  const sync = useSyncState();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [pairText, setPairText] = useState('');
  const [manual, setManual] = useState(false);
  const [share, setShare] = useState<{ link: string; svg: string } | null>(null);

  useEffect(() => {
    void getConfig(db).then((c) => {
      setUrl(c?.url ?? '');
      setToken(c?.token ?? '');
      setEditing(!c);
    });
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then((e) => setUsage(e.usage != null ? `${(e.usage / 1024 / 1024).toFixed(2)} MB` : ''));
  }, []);

  const counts = useLiveQuery(async () => ({
    habits: await db.habits.count(),
    containers: await db.containers.count(),
    logs: await db.logs.count(),
  }));

  const saveConfig = async () => {
    let u = url.trim();
    let t = token.trim();
    if (pairText.trim()) {
      const cfg = parsePairing(pairText);
      if (!cfg) return nav.toast('配對連結無效，請重新複製');
      u = cfg.url;
      t = cfg.token;
    }
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) return nav.toast('網址應以 https://script.google.com/ 開頭、/exec 結尾');
    if (!t) return nav.toast('請貼上 Token');
    await setConfig(db, { url: u, token: t });
    await refreshSyncState();
    const r = await runSync();
    if (r.status === 'OK') {
      setEditing(false);
      setPairText('');
      setUrl(u);
      setToken(t);
      nav.toast(r.restored ? `已從雲端還原 ${r.pulled} 筆` : '連線成功，已同步');
    } else if (r.status === 'ERROR') nav.toast(r.error);
  };

  const toggleShare = async () => {
    if (share) return setShare(null);
    const cfg = await getConfig(db);
    if (!cfg) return;
    const link = pairingLink(cfg);
    const QRCode = (await import('qrcode')).default; // 用到才載入，不拖慢開啟速度
    const svg = await QRCode.toString(link, { type: 'svg', margin: 0, errorCorrectionLevel: 'L', color: { dark: '#1f2923', light: '#ffffff' } });
    setShare({ link, svg });
  };
  const copyLink = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
      nav.toast('已複製配對連結');
    } catch {
      nav.toast('無法複製，請長按連結手動複製');
    }
  };
  const shareLink = async () => {
    if (!share) return;
    try {
      await navigator.share({ title: '遙測 App 配對連結', url: share.link });
    } catch {
      /* 取消 */
    }
  };

  const disconnect = async () => {
    await setConfig(db, null);
    await refreshSyncState();
    setUrl('');
    setToken('');
    setEditing(true);
  };

  const doExport = async () => {
    const json = await exportJson(db);
    const name = `telemetry-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch {
      return; // 使用者取消分享
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const syncNowClick = async () => {
    const r = await runSync();
    if (r.status === 'OK') nav.toast(r.pushed + r.pulled > 0 ? `已同步 (上傳 ${r.pushed}、下載 ${r.pulled})` : '已是最新');
    else if (r.status === 'ERROR') nav.toast(r.error);
  };

  const statusText = !sync.configured
    ? '未連線'
    : sync.syncing
      ? '同步中…'
      : sync.error
        ? `錯誤：${sync.error}`
        : `已連線 · ${ago(sync.lastSyncAt)}`;

  return (
    <main class="screen no-tabs">
      <header class="topbar">
        <button class="icon-btn" onClick={nav.back}>‹ 返回</button>
        <h1 style={{ fontSize: '18px' }}>設定</h1>
        <span class="icon-btn" />
      </header>

      <div class="section-title"><span>☁️ Google 雲端同步</span></div>
      <div class="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
          <span style={{ color: sync.error ? 'var(--miss)' : undefined }}>{statusText}</span>
          {sync.configured && <span class="field-label" style={{ margin: 0 }}>待上傳 {sync.pending} 筆</span>}
        </div>

        {editing ? (
          <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
            <label>
              <span class="field-label">配對連結</span>
              <textarea class="text-input" style={{ minHeight: '72px' }} autoCapitalize="off" autoCorrect="off"
                placeholder="在已連線的裝置：設定 → 新增裝置 → 複製連結，貼到這裡"
                value={pairText} onInput={(e) => setPairText((e.currentTarget as HTMLTextAreaElement).value)} />
            </label>
            <button class="link-btn muted" style={{ justifySelf: 'start' }} onClick={() => setManual((v) => !v)}>
              {manual ? '▾' : '▸'} 改用網址與 Token（第一次設定）
            </button>
            {manual && (
              <>
                <label>
                  <span class="field-label">網頁應用程式網址</span>
                  <input class="text-input" inputMode="url" autoCapitalize="off" autoCorrect="off"
                    placeholder="https://script.google.com/macros/s/…/exec" value={url}
                    onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label>
                  <span class="field-label">Token</span>
                  <input class="text-input" autoCapitalize="off" autoCorrect="off" value={token}
                    onInput={(e) => setToken((e.currentTarget as HTMLInputElement).value)} />
                </label>
              </>
            )}
            <div class="btn-row">
              <button class="icon-btn primary" onClick={saveConfig} disabled={sync.syncing}>連線並同步</button>
            </div>
          </div>
        ) : (
          <div class="btn-row" style={{ marginTop: '10px' }}>
            <button class="link-btn" onClick={syncNowClick} disabled={sync.syncing}>立即同步</button>
            <button class="link-btn" onClick={() => setEditing(true)}>修改設定</button>
            <ConfirmButton onConfirm={disconnect} confirmText="再按一次停用（本機資料保留）">停用同步</ConfirmButton>
          </div>
        )}
      </div>

      {sync.configured && !editing && (
        <>
          <div class="section-title"><span>📱 新增裝置</span></div>
          <div class="card">
            <p class="field-label" style={{ margin: 0 }}>
              讓另一台裝置 (電腦、iPad…) 連到同一份資料：在那台裝置打開下面的連結，或用相機掃 QR Code。
              iPhone 主畫面的 App 則是把連結貼到它的設定頁。
            </p>
            <div class="btn-row">
              <button class="link-btn" onClick={() => void toggleShare()}>{share ? '隱藏配對連結' : '顯示配對連結'}</button>
            </div>
            {share && (
              <>
                <span class="qr" dangerouslySetInnerHTML={{ __html: share.svg }} />
                <div class="mono">{share.link}</div>
                <div class="btn-row">
                  <button class="link-btn" onClick={() => void copyLink()}>複製連結</button>
                  {typeof navigator.share === 'function' && <button class="link-btn" onClick={() => void shareLink()}>分享…</button>}
                </div>
                <p class="field-label" style={{ color: 'var(--miss)' }}>這個連結等同雲端鑰匙，只傳給自己的裝置。</p>
              </>
            )}
          </div>
        </>
      )}

      <div class="section-title"><span>💾 本機資料</span></div>
      <div class="card">
        <div>
          習慣 {counts?.habits ?? '–'}　清單項目 {counts?.containers ?? '–'}　紀錄 {counts?.logs ?? '–'}
          {usage && <span class="field-label" style={{ display: 'inline', marginLeft: '8px' }}>({usage})</span>}
        </div>
        <div class="field-label" style={{ marginTop: '6px' }}>
          {persisted === true
            ? '已設定為永久儲存，系統不會自動清除。'
            : persisted === false
              ? '尚未取得永久儲存權限。請從主畫面圖示開啟 App，並開啟雲端同步作為備份。'
              : ''}
        </div>
        <div class="btn-row">
          <button class="link-btn" onClick={doExport}>📤 匯出 JSON 備份</button>
        </div>
      </div>
      <p class="hint">版本 {__APP_VERSION__}</p>
    </main>
  );
}
