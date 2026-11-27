import { useSyncState } from '../sync/auto';
import { useNav } from './kit';

/** 這台裝置還沒連上雲端：首頁常駐提醒，避免資料默默分家 */
export function SyncBanner() {
  const s = useSyncState();
  const nav = useNav();
  if (s.configured) return null;
  return (
    <button class="sync-banner" onClick={() => nav.go({ name: 'settings' })}>
      <span>
        <strong>這台裝置還沒連上雲端</strong>
        <span>資料只存在這裡，其他裝置看不到，也沒有備份。</span>
      </span>
      <span class="go">連線 ›</span>
    </button>
  );
}
