/**
 * 自動同步：開啟 App、回到前景、恢復連線、以及有本地修改後 (延遲數秒合併) 觸發。
 * iOS PWA 沒有背景同步，因此只在 App 開著時同步。
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import type { TelemetryDB } from '../data/db';
import { getConfig, getMeta, pendingCount, syncNow, type SyncOutcome } from './sync';

export interface SyncState {
  configured: boolean;
  syncing: boolean;
  pending: number;
  lastSyncAt: number | null;
  error: string | null;
}

let state: SyncState = { configured: false, syncing: false, pending: 0, lastSyncAt: null, error: null };
const listeners = new Set<(s: SyncState) => void>();
const emit = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
};

export function useSyncState(): SyncState {
  const [s, set] = useState(state);
  useEffect(() => {
    listeners.add(set);
    set(state);
    return () => void listeners.delete(set);
  }, []);
  return s;
}

let dbRef: TelemetryDB | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<SyncOutcome> | null = null;
let again = false;

export async function refreshSyncState() {
  if (!dbRef) return;
  emit({
    configured: !!(await getConfig(dbRef)),
    pending: await pendingCount(dbRef),
    lastSyncAt: (await getMeta<number>(dbRef, 'last_sync_at')) ?? null,
    error: (await getMeta<string | null>(dbRef, 'last_error')) ?? null,
  });
}

/** 立即同步 (同時只跑一個；進行中又被要求時，結束後再跑一次) */
export async function runSync(): Promise<SyncOutcome> {
  if (!dbRef) return { status: 'NOT_CONFIGURED' };
  if (running) {
    again = true;
    return running;
  }
  clearTimeout(timer);
  emit({ syncing: true });
  running = syncNow(dbRef);
  try {
    return await running;
  } finally {
    running = null;
    emit({ syncing: false });
    await refreshSyncState();
    if (again) {
      again = false;
      schedule(500);
    }
  }
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (navigator.onLine !== false && state.configured) void runSync();
  }, ms);
}

export function startAutoSync(db: TelemetryDB) {
  dbRef = db;
  void refreshSyncState().then(() => schedule(300));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(300);
  });
  window.addEventListener('online', () => schedule(300));

  // 有新的本地修改 → 4 秒後合併送出
  liveQuery(() => pendingCount(db)).subscribe((n) => {
    emit({ pending: n });
    if (n > 0) schedule(4000);
  });
}
