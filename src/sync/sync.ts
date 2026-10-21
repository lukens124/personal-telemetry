/**
 * 與 Google Apps Script 端點同步 (增量、last-write-wins)
 *
 * 流程：
 *  1. 收集本地 dirty 列推上去，並帶上次的 server_time (since)
 *  2. 伺服器合併後回傳 since 之後有變動的所有列
 *  3. 本地套用：若本地仍有更新的未推送修改則保留本地
 *  4. 推送成功且期間沒再修改的列 → dirty = 0
 *
 * 新裝置首次同步：若本地沒有任何紀錄、雲端已有資料 → 直接以雲端資料還原 (避免預設樣板重複)。
 */
import type { TelemetryDB } from '../data/db';
import type { Container, Habit, HabitLog } from '../data/types';

export type TableName = 'habits' | 'containers' | 'logs';
const TABLES: TableName[] = ['habits', 'containers', 'logs'];
const KEYS: Record<TableName, string> = { habits: 'habit_id', containers: 'container_id', logs: 'log_id' };

type Row = Habit | Container | HabitLog;
type Rows = Record<TableName, Record<string, unknown>[]>;

export interface SyncConfig {
  url: string;
  token: string;
}

export interface ServerResponse {
  ok: boolean;
  error?: string;
  server_time: number;
  changes: Rows;
  counts: Record<TableName, number>;
}

export type SyncOutcome =
  | { status: 'NOT_CONFIGURED' }
  | { status: 'OK'; pushed: number; pulled: number; restored: boolean }
  | { status: 'ERROR'; error: string };

export type Transport = (url: string, body: string) => Promise<ServerResponse>;

/** 預設傳輸：text/plain 避免 CORS preflight (GAS 不支援 OPTIONS) */
export const fetchTransport: Transport = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as ServerResponse;
  } catch {
    throw new Error('回應不是 JSON，請確認網址是「網頁應用程式」部署網址，且存取權為「所有人」');
  }
};

// ---------------------------------------------------------------- meta

export async function getMeta<T>(db: TelemetryDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(db: TelemetryDB, key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export async function getConfig(db: TelemetryDB): Promise<SyncConfig | null> {
  const cfg = await getMeta<SyncConfig>(db, 'sync_config');
  return cfg?.url && cfg?.token ? cfg : null;
}

/** 設定變更時重置游標，下次同步會做一次完整比對 */
export async function setConfig(db: TelemetryDB, cfg: SyncConfig | null) {
  await setMeta(db, 'sync_config', cfg);
  await setMeta(db, 'last_server_ts', 0);
}

export async function pendingCount(db: TelemetryDB): Promise<number> {
  let n = 0;
  for (const t of TABLES) n += await db.table(t).where('dirty').equals(1).count();
  return n;
}

// ---------------------------------------------------------------- core

const strip = (r: Row): Record<string, unknown> => {
  const { dirty: _dirty, ...rest } = r as Row & { dirty: number };
  return rest;
};

async function post(transport: Transport, cfg: SyncConfig, since: number, changes: Rows): Promise<ServerResponse> {
  const res = await transport(cfg.url, JSON.stringify({ token: cfg.token, since, changes }));
  if (!res.ok) {
    throw new Error(res.error === 'UNAUTHORIZED' ? 'Token 不正確' : (res.error ?? '同步失敗'));
  }
  return res;
}

const emptyRows = (): Rows => ({ habits: [], containers: [], logs: [] });

export async function syncNow(db: TelemetryDB, transport: Transport = fetchTransport): Promise<SyncOutcome> {
  const cfg = await getConfig(db);
  if (!cfg) return { status: 'NOT_CONFIGURED' };

  try {
    const since = (await getMeta<number>(db, 'last_server_ts')) ?? 0;

    // 新裝置：本地沒有紀錄 → 先看雲端有沒有資料可以還原
    if (since === 0) {
      const localLogs = await db.logs.count();
      if (localLogs === 0) {
        const probe = await post(transport, cfg, 0, emptyRows());
        if ((probe.counts?.habits ?? 0) > 0) {
          await db.transaction('rw', db.habits, db.containers, db.logs, async () => {
            for (const t of TABLES) {
              await db.table(t).clear();
              await db.table(t).bulkPut(probe.changes[t].map((r) => ({ ...r, dirty: 0 })));
            }
          });
          await setMeta(db, 'last_server_ts', probe.server_time);
          await setMeta(db, 'last_sync_at', Date.now());
          const pulled = TABLES.reduce((n, t) => n + probe.changes[t].length, 0);
          return { status: 'OK', pushed: 0, pulled, restored: true };
        }
      }
    }

    // 收集本地修改
    const outgoing = emptyRows();
    const sent = new Map<string, number>(); // table:id → updated_at
    for (const t of TABLES) {
      const rows = (await db.table(t).where('dirty').equals(1).toArray()) as Row[];
      outgoing[t] = rows.map(strip);
      for (const r of rows) sent.set(`${t}:${(r as unknown as Record<string, string>)[KEYS[t]]}`, r.updated_at);
    }

    const res = await post(transport, cfg, since, outgoing);

    let pulled = 0;
    await db.transaction('rw', db.habits, db.containers, db.logs, async () => {
      for (const t of TABLES) {
        const table = db.table(t);
        for (const incoming of res.changes[t] ?? []) {
          const id = incoming[KEYS[t]] as string;
          const local = (await table.get(id)) as Row | undefined;
          // 本地有更新且尚未推送的修改 → 保留本地
          if (local && local.dirty === 1 && local.updated_at > Number(incoming.updated_at)) continue;
          await table.put({ ...incoming, dirty: 0 });
          pulled++;
        }
        // 已送出、且送出後沒再改過的列 → 清除 dirty
        for (const r of outgoing[t]) {
          const id = r[KEYS[t]] as string;
          const local = (await table.get(id)) as Row | undefined;
          if (local?.dirty === 1 && local.updated_at === sent.get(`${t}:${id}`)) await table.update(id, { dirty: 0 });
        }
      }
    });

    await setMeta(db, 'last_server_ts', res.server_time);
    await setMeta(db, 'last_sync_at', Date.now());
    await setMeta(db, 'last_error', null);
    const pushed = TABLES.reduce((n, t) => n + outgoing[t].length, 0);
    return { status: 'OK', pushed, pulled, restored: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await setMeta(db, 'last_error', error);
    return { status: 'ERROR', error };
  }
}

// ---------------------------------------------------------------- 匯出

export async function exportJson(db: TelemetryDB): Promise<string> {
  const data: Record<string, unknown> = { app: 'personal-telemetry', schema: '4.1', exported_at: new Date().toISOString() };
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return JSON.stringify(data, null, 1);
}
