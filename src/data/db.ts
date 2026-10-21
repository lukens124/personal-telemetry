import Dexie, { type EntityTable } from 'dexie';
import type { Container, Habit, HabitLog } from './types';

export type TelemetryDB = Dexie & {
  habits: EntityTable<Habit, 'habit_id'>;
  containers: EntityTable<Container, 'container_id'>;
  logs: EntityTable<HabitLog, 'log_id'>;
};

export function createDB(name = 'Personal_Telemetry_DB'): TelemetryDB {
  const db = new Dexie(name) as TelemetryDB;
  db.version(1).stores({
    habits: 'habit_id, category_tab, sort_order, dirty',
    containers: 'container_id, habit_id, status, dirty',
    logs: 'log_id, habit_id, kind, local_date, timestamp, container_id, dirty, [habit_id+local_date], [habit_id+kind]',
  });
  return db;
}

/** App 執行期的單例 */
export const db = createDB();

/** 要求瀏覽器不要自動清除 IndexedDB (iOS 主畫面 PWA 必做) */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}
