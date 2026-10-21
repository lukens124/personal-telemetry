import { useSyncState } from '../sync/auto';
import { useNav } from './kit';

/** 首頁右上角：同步狀態 + 設定 */
export function TopActions() {
  const nav = useNav();
  const s = useSyncState();
  const cloud = !s.configured ? null : s.syncing ? '⏳' : s.error ? '⚠️' : '☁️';
  const label = !s.configured ? '' : s.syncing ? '同步中' : s.error ? `同步錯誤：${s.error}` : s.pending > 0 ? `待上傳 ${s.pending} 筆` : '已同步';
  return (
    <span style={{ display: 'flex', alignItems: 'center' }}>
      {cloud && (
        <button class="icon-btn" aria-label={label} title={label} onClick={() => nav.go({ name: 'settings' })}>
          {cloud}
        </button>
      )}
      <button class="icon-btn" aria-label="設定" onClick={() => nav.go({ name: 'settings' })}>
        ⚙️
      </button>
    </span>
  );
}
