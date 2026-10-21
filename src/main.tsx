import { render } from 'preact';
import './index.css';
import { App } from './app';
import { db, requestPersistence } from './data/db';
import { seedIfEmpty } from './data/seed';

async function boot() {
  await seedIfEmpty(db);
  void requestPersistence();
  render(<App />, document.getElementById('app')!);
}

void boot();
