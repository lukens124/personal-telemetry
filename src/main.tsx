import { render } from 'preact';
import { useState } from 'preact/hooks';
import './index.css';
import { App } from './app';
import { db, requestPersistence } from './data/db';
import { migrateBikeToCardio } from './data/migrate';
import { Onboarding } from './pages/Onboarding';
import { setupPwaUpdates } from './pwa';
import { refreshSyncState, startAutoSync } from './sync/auto';
import { takePairingFromUrl } from './sync/pair';
import { getCloudMember, getConfig, getMeta, setConfig, setMeta, syncNow, type CloudMember } from './sync/sync';

function Root(props: { onboarded: boolean; connected: CloudMember | null; notice: string | null }) {
  const [onboarded, setOnboarded] = useState(props.onboarded);
  if (!onboarded) {
    return (
      <Onboarding
        connected={props.connected}
        onDone={() => {
          void refreshSyncState();
          setOnboarded(true);
        }}
      />
    );
  }
  return <App notice={props.notice} />;
}

async function boot() {
  await migrateBikeToCardio(db).catch(() => 0);
  void requestPersistence();

  // 透過配對 / 邀請連結開啟：自動連線
  const paired = takePairingFromUrl();
  if (paired) await setConfig(db, paired);

  // 已有資料的裝置 (舊版使用者) 視為已完成引導
  let onboarded = !!(await getMeta<boolean>(db, 'onboarded')) || (await db.habits.count()) > 0;
  let connected: CloudMember | null = null;
  let notice: string | null = paired ? '已連線，正在從雲端同步…' : null;

  // 新裝置但已連線 → 先從雲端還原；雲端沒有自己的資料才進入「選項目」
  if (!onboarded && (await getConfig(db))) {
    const r = await syncNow(db);
    if (r.status === 'OK') {
      connected = await getCloudMember(db);
      if (r.restored || (await db.habits.count()) > 0) {
        onboarded = true;
        notice = `已從雲端還原 ${r.pulled} 筆資料`;
      }
    } else if (r.status === 'ERROR') {
      await setConfig(db, null); // 連結無效或已停用：回到選擇存放位置
      notice = null;
    }
  }
  if (onboarded) await setMeta(db, 'onboarded', true);

  render(<Root onboarded={onboarded} connected={connected} notice={notice} />, document.getElementById('app')!);
  startAutoSync(db);
  setupPwaUpdates();
}

void boot();
