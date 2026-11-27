import { render } from 'preact';
import './index.css';
import { App } from './app';
import { db, requestPersistence } from './data/db';
import { migrateBikeToCardio } from './data/migrate';
import { seedIfEmpty } from './data/seed';
import { setupPwaUpdates } from './pwa';
import { startAutoSync } from './sync/auto';

async function boot() {
  await seedIfEmpty(db);
  await migrateBikeToCardio(db).catch(() => 0);
  void requestPersistence();
  render(<App />, document.getElementById('app')!);
  startAutoSync(db);
  setupPwaUpdates();
}

void boot();
