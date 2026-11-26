import { render } from 'preact';
import './index.css';
import { App } from './app';
import { db, requestPersistence } from './data/db';
import { seedIfEmpty } from './data/seed';
import { setupPwaUpdates } from './pwa';
import { startAutoSync } from './sync/auto';

async function boot() {
  await seedIfEmpty(db);
  void requestPersistence();
  render(<App />, document.getElementById('app')!);
  startAutoSync(db);
  setupPwaUpdates();
}

void boot();
