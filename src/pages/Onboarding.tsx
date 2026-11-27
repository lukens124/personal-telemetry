/**
 * 首次開啟：選擇資料存放位置 → 選擇要記錄的項目
 */
import { useState } from 'preact/hooks';
import { db } from '../data/db';
import { seedTemplates, TEMPLATES, type TemplateKey } from '../data/templates';
import { setMeta, setConfig, syncNow, getCloudMember, type CloudMember } from '../sync/sync';
import { parsePairing } from '../sync/pair';

export const SELF_HOST_GUIDE = 'https://github.com/lukens124/personal-telemetry/blob/main/docs/SELF_HOST.md';

type Mode = 'club' | 'self' | 'local';
type Step = 'storage' | 'items';

export function Onboarding({ connected, onDone }: { connected: CloudMember | null; onDone: () => void }) {
  const [step, setStep] = useState<Step>(connected ? 'items' : 'storage');
  const [mode, setMode] = useState<Mode | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [member, setMember] = useState<CloudMember | null>(connected);
  const [picked, setPicked] = useState<Set<TemplateKey>>(new Set(TEMPLATES.map((t) => t.key)));

  const finish = async () => {
    await setMeta(db, 'onboarded', true);
    onDone();
  };

  const connect = async () => {
    setError('');
    const cfg = parsePairing(link);
    if (!cfg) return setError(mode === 'club' ? '邀請連結無效，請向管理者重新索取' : '配對連結無效，請重新複製');
    setBusy(true);
    await setConfig(db, cfg);
    const r = await syncNow(db);
    setBusy(false);
    if (r.status === 'ERROR') {
      await setConfig(db, null);
      return setError(r.error);
    }
    setMember(await getCloudMember(db));
    // 雲端已有自己的資料 (換手機) → 直接完成
    if (r.status === 'OK' && r.restored) return finish();
    setStep('items');
  };

  const start = async () => {
    setBusy(true);
    await seedTemplates(db, [...picked]);
    setBusy(false);
    await finish();
  };

  if (step === 'items') {
    return (
      <main class="screen no-tabs onboarding">
        <h1 class="ob-title">要記錄哪些項目？</h1>
        <p class="ob-lead">
          {member?.role === 'member'
            ? `已加入${member.space ? `「${member.space}」` : '社團雲端'}${member.name ? `，${member.name}` : ''}。`
            : member
              ? '已連上你的 Google 雲端。'
              : ''}
          之後都能在 App 裡新增、修改或刪除。
        </p>
        <div class="ob-list">
          {TEMPLATES.map((t) => (
            <button type="button" class="ob-option" aria-pressed={picked.has(t.key)}
              onClick={() => setPicked((s) => { const n = new Set(s); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; })}>
              <span class="ob-check">{picked.has(t.key) ? '✓' : ''}</span>
              <span>
                <strong>{t.icon} {t.name}</strong>
                <span>{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <button class="icon-btn primary ob-cta" disabled={busy} onClick={() => void start()}>
          {picked.size ? '開始使用' : '先不建立，直接開始'}
        </button>
      </main>
    );
  }

  return (
    <main class="screen no-tabs onboarding">
      <h1 class="ob-title">資料要存在哪裡？</h1>
      <p class="ob-lead">紀錄會先存在這支手機，再自動備份到你選的地方。之後可以在設定頁更改。</p>

      <div class="ob-list">
        <button type="button" class="ob-option" aria-pressed={mode === 'club'} onClick={() => setMode('club')}>
          <span class="ob-check">{mode === 'club' ? '✓' : ''}</span>
          <span>
            <strong>加入社團雲端</strong>
            <span>有邀請連結就能用，不用任何設定。</span>
          </span>
        </button>
        {mode === 'club' && (
          <div class="ob-detail">
            <p class="ob-privacy">
              你的紀錄會存在<b>社團管理者</b>的 Google 試算表：<b>管理者看得到你的全部紀錄</b>，其他成員看不到。
              你可以隨時在設定頁停用同步，或請管理者刪除你的資料。
            </p>
            <textarea class="text-input" style={{ minHeight: '72px' }} autoCapitalize="off" autoCorrect="off"
              placeholder="貼上管理者給你的邀請連結" value={link} onInput={(e) => setLink((e.currentTarget as HTMLTextAreaElement).value)} />
            {error && <p class="ob-error">{error}</p>}
            <button class="icon-btn primary" disabled={busy || !link.trim()} onClick={() => void connect()}>
              {busy ? '連線中…' : '我了解，加入'}
            </button>
          </div>
        )}

        <button type="button" class="ob-option" aria-pressed={mode === 'self'} onClick={() => setMode('self')}>
          <span class="ob-check">{mode === 'self' ? '✓' : ''}</span>
          <span>
            <strong>存在我自己的 Google 雲端</strong>
            <span>只有你看得到。需要跟著說明書設定一次，約 5 分鐘。</span>
          </span>
        </button>
        {mode === 'self' && (
          <div class="ob-detail">
            <a class="link-btn" href={SELF_HOST_GUIDE} target="_blank" rel="noopener">📖 打開設定說明書</a>
            <textarea class="text-input" style={{ minHeight: '72px' }} autoCapitalize="off" autoCorrect="off"
              placeholder="設定完成後，貼上說明書最後產生的配對連結" value={link} onInput={(e) => setLink((e.currentTarget as HTMLTextAreaElement).value)} />
            {error && <p class="ob-error">{error}</p>}
            <div class="btn-row">
              <button class="icon-btn primary" disabled={busy || !link.trim()} onClick={() => void connect()}>
                {busy ? '連線中…' : '連線'}
              </button>
              <button class="link-btn" onClick={() => setStep('items')}>還沒設定好，先開始用</button>
            </div>
          </div>
        )}

        <button type="button" class="ob-option" aria-pressed={mode === 'local'} onClick={() => setMode('local')}>
          <span class="ob-check">{mode === 'local' ? '✓' : ''}</span>
          <span>
            <strong>先只存在這支手機</strong>
            <span>馬上開始；沒有備份，換手機資料不會跟著走。</span>
          </span>
        </button>
        {mode === 'local' && (
          <div class="ob-detail">
            <button class="icon-btn primary" onClick={() => setStep('items')}>下一步</button>
          </div>
        )}
      </div>
    </main>
  );
}
