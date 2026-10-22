/**
 * Repository：所有寫入都經過這裡，負責
 *  - 同步欄位 (updated_at / dirty / deleted)
 *  - TRACK 習慣的每日打卡 (CHECKIN) 一致性
 *  - 容器的 last_payload / GENERIC 的上次模板
 * 每個函式都接受 db 與 now，方便測試。
 */
import { isoWeekday, toIsoWithOffset, toLocalDate, weekDates } from './dates';
import type { TelemetryDB } from './db';
import {
  FLAG_DONE,
  FLAG_SKIP,
  type Container,
  type Habit,
  type HabitLog,
  type IsoWeekday,
  type LocalDate,
  type SyncFields,
  type WorkoutConfig,
  type WorkoutMode,
} from './types';
import { cycleStatus, type CycleStatus } from '../logic/cycle';
import { computeWeekRow, isOnTodayList, type WeekRow } from '../logic/grid';
import { summarize } from '../logic/summary';

export const uid = () => crypto.randomUUID();

export function newSync(now: Date): SyncFields {
  const t = now.getTime();
  return { created_at: t, updated_at: t, deleted: 0, dirty: 1 };
}
const touch = (now: Date) => ({ updated_at: now.getTime(), dirty: 1 as const });

/** CHECKIN 使用確定性 ID：同一習慣同一天只會有一筆，跨裝置同步也不會重複 */
export const checkinId = (habit_id: string, date: LocalDate) => `ck_${habit_id}_${date}`;

const alive = <T extends { deleted: 0 | 1 }>(x: T | undefined): x is T => !!x && x.deleted === 0;

// ---------------------------------------------------------------- 讀取

export async function listHabits(db: TelemetryDB, tab?: Habit['category_tab']): Promise<Habit[]> {
  const all = await db.habits.orderBy('sort_order').toArray();
  return all.filter((h) => h.deleted === 0 && (!tab || h.category_tab === tab));
}

export async function listContainers(
  db: TelemetryDB,
  habit_id: string,
  opts: { includeArchived?: boolean; sub_mode?: string | null } = {},
): Promise<Container[]> {
  const list = await db.containers.where('habit_id').equals(habit_id).toArray();
  return list
    .filter((c) => c.deleted === 0)
    .filter((c) => opts.includeArchived || c.status === 'ACTIVE')
    .filter((c) => opts.sub_mode === undefined || c.sub_mode === opts.sub_mode)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** 星期綁定：回傳當天綁定的課表；沒有綁定則回傳 null (UI 應開啟工作台讓使用者手選) */
export async function findBoundContainer(db: TelemetryDB, habit_id: string, weekday: IsoWeekday): Promise<Container | null> {
  const list = await listContainers(db, habit_id);
  return list.find((c) => c.bound_weekdays.includes(weekday)) ?? null;
}

export async function getCheckin(db: TelemetryDB, habit_id: string, date: LocalDate): Promise<HabitLog | undefined> {
  const ck = await db.logs.get(checkinId(habit_id, date));
  return alive(ck) ? ck : undefined;
}

export async function listEntries(db: TelemetryDB, habit_id: string): Promise<HabitLog[]> {
  const list = await db.logs.where('[habit_id+kind]').equals([habit_id, 'ENTRY']).toArray();
  return list.filter((l) => l.deleted === 0).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ---------------------------------------------------------------- 1.0-A 追蹤首頁

export interface TodayItem {
  habit: Habit;
  checkin: HabitLog | undefined;
  row: WeekRow;
}

export async function trackDashboard(db: TelemetryDB, now: Date): Promise<{ rows: WeekRow[]; today: TodayItem[] }> {
  const today = toLocalDate(now);
  const days = weekDates(today);
  const habits = await listHabits(db, 'TRACK');
  const checkins = (await db.logs.where('local_date').between(days[0], days[6], true, true).toArray()).filter(
    (l) => l.kind === 'CHECKIN' && l.deleted === 0,
  );

  const rows: WeekRow[] = [];
  const items: TodayItem[] = [];
  for (const h of habits) {
    const mine = checkins.filter((c) => c.habit_id === h.habit_id);
    const row = computeWeekRow(h, mine, today);
    rows.push(row);
    const ck = mine.find((c) => c.local_date === today);
    if (isOnTodayList(h, ck, today)) items.push({ habit: h, checkin: ck, row });
  }
  return { rows, today: items };
}

// ---------------------------------------------------------------- 打卡 / 略過

async function upsertCheckin(
  db: TelemetryDB,
  habit: Habit,
  date: LocalDate,
  flag: HabitLog['visual_flag'],
  now: Date,
  payload: HabitLog['payload'] = null,
): Promise<HabitLog> {
  const id = checkinId(habit.habit_id, date);
  const existing = await db.logs.get(id);
  const log: HabitLog = {
    ...(existing ?? newSync(now)),
    ...touch(now),
    log_id: id,
    habit_id: habit.habit_id,
    kind: 'CHECKIN',
    sub_mode: null,
    container_id: null,
    timestamp: toIsoWithOffset(now),
    local_date: date,
    visual_flag: flag,
    summary_text: '',
    payload: payload ?? (existing && existing.deleted === 0 ? existing.payload : null),
    deleted: 0,
  };
  await db.logs.put(log);
  return log;
}

export type QuickCheckinResult =
  | { status: 'CHECKED'; checkin: HabitLog; entry?: HabitLog }
  | { status: 'UNCHECKED' }
  /** 重訓當天沒有綁定課表 → UI 應開啟 2.0-A 讓使用者手選 */
  | { status: 'NEEDS_WORKBENCH' };

/**
 * 1.0-A 左側 20% 熱區：極速打卡 (再點一次 = 取消)
 *  - WORKOUT：依今日星期載入綁定課表的上次 payload 寫成一筆 ENTRY
 *  - 其他：只寫 CHECKIN (今日有做、但沒有新增內容)
 */
export async function quickCheckin(db: TelemetryDB, habit: Habit, now: Date): Promise<QuickCheckinResult> {
  const today = toLocalDate(now);
  const existing = await getCheckin(db, habit.habit_id, today);

  if (existing?.visual_flag === FLAG_DONE) {
    await db.transaction('rw', db.logs, async () => {
      await db.logs.update(existing.log_id, { deleted: 1, ...touch(now) });
      const autoId = existing.payload?.auto_entry_id as string | undefined;
      if (autoId) await db.logs.update(autoId, { deleted: 1, ...touch(now) });
    });
    return { status: 'UNCHECKED' };
  }

  if (habit.engine_type === 'WORKOUT') {
    const container = await findBoundContainer(db, habit.habit_id, isoWeekday(today));
    if (!container) return { status: 'NEEDS_WORKBENCH' };
    const payload = container.last_payload ?? container.default_payload;
    const mode = (await workoutCycle(db, habit)).suggested;
    return db.transaction('rw', db.logs, db.containers, db.habits, async () => {
      const entry = await saveEntry(db, habit, { container_id: container.container_id, sub_mode: mode, payload }, now);
      const checkin = await upsertCheckin(db, habit, today, FLAG_DONE, now, { auto_entry_id: entry.log_id });
      return { status: 'CHECKED' as const, checkin, entry };
    });
  }

  const checkin = await upsertCheckin(db, habit, today, FLAG_DONE, now);
  return { status: 'CHECKED', checkin };
}

/** 1.0-A 左滑：合理略過 (再滑一次 = 取消)。已完成的項目不可略過。 */
export async function toggleSkip(db: TelemetryDB, habit: Habit, now: Date): Promise<'SKIPPED' | 'UNSKIPPED' | 'ALREADY_DONE'> {
  const today = toLocalDate(now);
  const existing = await getCheckin(db, habit.habit_id, today);
  if (existing?.visual_flag === FLAG_DONE) return 'ALREADY_DONE';
  if (existing?.visual_flag === FLAG_SKIP) {
    await db.logs.update(existing.log_id, { deleted: 1, ...touch(now) });
    return 'UNSKIPPED';
  }
  await upsertCheckin(db, habit, today, FLAG_SKIP, now);
  return 'SKIPPED';
}

// ---------------------------------------------------------------- 紀錄 (ENTRY)

export interface EntryInput {
  container_id: string | null;
  sub_mode?: string | null;
  payload: Record<string, unknown> | null;
  /** 預設為 now；工作台的 [🕒現在▾] 可改成補登時間 */
  at?: Date;
}

/**
 * 儲存一筆紀錄，並自動：
 *  - 更新容器的 last_payload (下次預填)
 *  - GENERIC：記住這次的文字當作下次模板
 *  - TRACK 習慣：當天打卡設為完成 (會覆蓋略過)
 */
export async function saveEntry(db: TelemetryDB, habit: Habit, input: EntryInput, now: Date): Promise<HabitLog> {
  const at = input.at ?? now;
  const container = input.container_id ? ((await db.containers.get(input.container_id)) ?? null) : null;

  const entry: HabitLog = {
    ...newSync(now),
    log_id: uid(),
    habit_id: habit.habit_id,
    kind: 'ENTRY',
    sub_mode: input.sub_mode ?? container?.sub_mode ?? null,
    container_id: input.container_id,
    timestamp: toIsoWithOffset(at),
    local_date: toLocalDate(at),
    visual_flag: null,
    summary_text: summarize(habit, container, input.payload),
    payload: input.payload,
  };

  await db.transaction('rw', db.logs, db.containers, db.habits, async () => {
    await db.logs.add(entry);
    if (container) await db.containers.update(container.container_id, { last_payload: input.payload, ...touch(now) });
    if (habit.engine_type === 'GENERIC' && typeof input.payload?.text === 'string') {
      await db.habits.update(habit.habit_id, { last_state: { template: input.payload.text }, ...touch(now) });
    }
    if (habit.category_tab === 'TRACK') {
      const ck = await getCheckin(db, habit.habit_id, entry.local_date);
      if (ck?.visual_flag !== FLAG_DONE) await upsertCheckin(db, habit, entry.local_date, FLAG_DONE, now);
    }
  });
  return entry;
}

export async function updateEntry(
  db: TelemetryDB,
  habit: Habit,
  log_id: string,
  patch: Partial<Pick<HabitLog, 'payload' | 'container_id' | 'sub_mode'>>,
  now: Date,
): Promise<void> {
  const cur = await db.logs.get(log_id);
  if (!alive(cur)) throw new Error(`entry ${log_id} not found`);
  const next = { ...cur, ...patch };
  const container = next.container_id ? ((await db.containers.get(next.container_id)) ?? null) : null;
  await db.logs.update(log_id, { ...patch, summary_text: summarize(habit, container, next.payload), ...touch(now) });
}

export async function deleteEntry(db: TelemetryDB, log_id: string, now: Date): Promise<void> {
  await db.logs.update(log_id, { deleted: 1, ...touch(now) });
}

/** 1.0-B 右滑：以現在時間複製一筆歷史紀錄 */
export async function duplicateEntry(db: TelemetryDB, log_id: string, now: Date): Promise<HabitLog> {
  const src = await db.logs.get(log_id);
  if (!alive(src) || src.kind !== 'ENTRY') throw new Error(`entry ${log_id} not found`);
  const habit = await db.habits.get(src.habit_id);
  if (!alive(habit)) throw new Error(`habit ${src.habit_id} not found`);
  return saveEntry(
    db,
    habit,
    { container_id: src.container_id, sub_mode: src.sub_mode, payload: structuredClone(src.payload) },
    now,
  );
}

// ---------------------------------------------------------------- 重訓 N:M

export async function workoutCycle(db: TelemetryDB, habit: Habit): Promise<CycleStatus> {
  const entries = await listEntries(db, habit.habit_id);
  const history = entries
    .slice()
    .reverse()
    .map((e) => (e.sub_mode === 'DELOAD' ? 'DELOAD' : 'MAIN') as WorkoutMode);
  return cycleStatus(history, (habit.config as WorkoutConfig).cycle);
}

// ---------------------------------------------------------------- 1.0-B 紀錄首頁

/** 時間軸：LOG 分頁的紀錄 + 閱讀/語言筆記 (新到舊) */
export async function timeline(db: TelemetryDB, filterHabitId?: string): Promise<HabitLog[]> {
  const habits = await listHabits(db);
  const visible = new Set(
    habits
      .filter((h) => h.category_tab === 'LOG' || h.engine_type === 'READING')
      .filter((h) => !filterHabitId || h.habit_id === filterHabitId)
      .map((h) => h.habit_id),
  );
  const logs = await db.logs.where('kind').equals('ENTRY').toArray();
  return logs
    .filter((l) => l.deleted === 0 && visible.has(l.habit_id))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** 隨機知識喚醒：從所有閱讀/語言筆記中隨機抽一則 */
export async function randomRecall(db: TelemetryDB, rand: () => number = Math.random): Promise<HabitLog | null> {
  const readingIds = new Set((await listHabits(db)).filter((h) => h.engine_type === 'READING').map((h) => h.habit_id));
  const pool = (await db.logs.where('kind').equals('ENTRY').toArray()).filter(
    (l) => l.deleted === 0 && readingIds.has(l.habit_id),
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(rand() * pool.length)];
}

// ---------------------------------------------------------------- 管理 (Modal 2.5)

export async function createHabit(
  db: TelemetryDB,
  h: Omit<Habit, keyof SyncFields | 'habit_id' | 'sort_order' | 'last_state'> &
    Partial<Pick<Habit, 'sort_order' | 'last_state'>>,
  now: Date,
): Promise<Habit> {
  const count = await db.habits.count();
  const habit: Habit = { ...newSync(now), habit_id: uid(), sort_order: count, last_state: null, ...h };
  await db.habits.add(habit);
  return habit;
}

export async function updateHabit(
  db: TelemetryDB,
  habit_id: string,
  patch: Partial<Omit<Habit, keyof SyncFields | 'habit_id'>>,
  now: Date,
) {
  await db.habits.update(habit_id, { ...patch, ...touch(now) });
}

export async function createContainer(
  db: TelemetryDB,
  c: Pick<Container, 'habit_id' | 'name'> & Partial<Omit<Container, keyof SyncFields | 'container_id'>>,
  now: Date,
): Promise<Container> {
  const siblings = await listContainers(db, c.habit_id, { includeArchived: true });
  const container: Container = {
    ...newSync(now),
    container_id: uid(),
    sub_mode: null,
    bound_weekdays: [],
    status: 'ACTIVE',
    sort_order: siblings.length,
    default_payload: null,
    last_payload: null,
    ...c,
  };
  await db.containers.add(container);
  return container;
}

export async function updateContainer(
  db: TelemetryDB,
  container_id: string,
  patch: Partial<Omit<Container, keyof SyncFields | 'container_id'>>,
  now: Date,
) {
  await db.containers.update(container_id, { ...patch, ...touch(now) });
}

/**
 * 星期綁定：把某天綁到指定課表，並自動從同習慣的其他課表移除該天
 * (同一天只會有一份課表)。傳 null 則清空該天的綁定。
 */
export async function bindWeekday(
  db: TelemetryDB,
  habit_id: string,
  weekday: IsoWeekday,
  container_id: string | null,
  now: Date,
) {
  const list = await listContainers(db, habit_id, { includeArchived: true });
  await db.transaction('rw', db.containers, async () => {
    for (const c of list) {
      const has = c.bound_weekdays.includes(weekday);
      const want = c.container_id === container_id;
      if (has === want) continue;
      const days = want
        ? [...c.bound_weekdays, weekday].sort((a, b) => a - b)
        : c.bound_weekdays.filter((d) => d !== weekday);
      await db.containers.update(c.container_id, { bound_weekdays: days, ...touch(now) });
    }
  });
}

/** 刪除習慣 (軟刪除；紀錄保留在資料庫與雲端試算表，只是不再顯示) */
export async function deleteHabit(db: TelemetryDB, habit_id: string, now: Date) {
  await db.habits.update(habit_id, { deleted: 1, ...touch(now) });
}
