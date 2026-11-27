import { render } from 'preact';
import './index.css';
import { App } from './app';
import { db, requestPersistence } from './data/db';
import { migrateBikeToCardio } from './data/migrate';
import { seedIfEmpty } from './data/seed';
import { setupPwaUpdates } from './pwa';
import { startAutoSync } from './sync/auto';
import { takePairingFromUrl } from './sync/pair';
import { setConfig } from './sync/sync';

async function boot() {
  await seedIfEmpty(db);
  await migrateBikeToCardio(db).catch(() => 0);
  void requestPersistence();
  // 透過配對連結開啟：自動連線，接下來的同步會從雲端還原 (或與本機資料合併)
  const paired = takePairingFromUrl();
  if (paired) await setConfig(db, paired);
  render(<App notice={paired ? '已連線，正在從雲端同步…' : null} />, document.getElementById('app')!);
  startAutoSync(db);
  setupPwaUpdates();
}

void boot();
