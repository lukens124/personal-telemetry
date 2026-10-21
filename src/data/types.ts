/**
 * Schema v4.1 — 個人日常遙測 App
 *
 * 相對 v4.0 的修訂：
 *  - 所有表加入同步欄位 (created_at / updated_at / deleted / dirty)
 *  - Habit_Logs 加入 kind (CHECKIN / ENTRY) 與 local_date
 *  - visual_flag 0 (待執行) 不實體存檔，由 schedule_days 推算
 *  - 星期一律使用 ISO weekday：1 = 週一 … 7 = 週日
 */

export type CategoryTab = 'TRACK' | 'LOG';
export type EngineType = 'WORKOUT' | 'COFFEE' | 'READING' | 'GENERIC';
/** ISO weekday: 1 = 週一 … 7 = 週日 */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** YYYY-MM-DD (使用者本地日期) */
export type LocalDate = string;

/** 1 = 已完成 [X]；3 = 合理略過 [-]。0 不存檔；2 保留。 */
export type VisualFlag = 1 | 3;
export const FLAG_DONE: VisualFlag = 1;
export const FLAG_SKIP: VisualFlag = 3;

/** 同步欄位：每張表共用 */
export interface SyncFields {
  created_at: number; // epoch ms
  updated_at: number; // epoch ms，last-write-wins 依據
  deleted: 0 | 1; // 軟刪除 (tombstone)，同步後才可實體清除
  dirty: 0 | 1; // 1 = 本地有變更尚未推送
}

// ---------- 引擎設定 (Habit.config) ----------

export interface WorkoutConfig {
  /** N:M 週期：主訓 N 次 + 減載 M 次 */
  cycle: { main: number; deload: number };
}

export interface CoffeeConfig {
  grinders: string[];
  /** 各模式的預設磨豆機 */
  default_grinder: Partial<Record<CoffeeMode, string>>;
}
export type CoffeeMode = 'POUR_OVER' | 'ESPRESSO';

export interface ReadingConfig {
  max_chars: number; // 微筆記字數上限
}

/** GENERIC 引擎可選的結構化欄位 (例如騎車的距離、時間) */
export interface GenericField {
  key: string;
  label: string;
  type: 'number' | 'duration'; // duration 以分鐘儲存
  unit?: string;
  step?: number;
}
export interface GenericConfig {
  fields: GenericField[];
  /** 是否有文字內容區塊 (日記 = true；騎車可選備註) */
  has_text: boolean;
  /** 容器 (下拉) 的顯示名稱，例如騎車的「路線 / 主題」 */
  container_label?: string;
}

export type HabitConfig = WorkoutConfig | CoffeeConfig | ReadingConfig | GenericConfig;

// ---------- 主表 ----------

export interface Habit extends SyncFields {
  habit_id: string;
  name: string;
  icon: string;
  category_tab: CategoryTab;
  engine_type: EngineType;
  /** 排程日 (僅 TRACK 使用) */
  schedule_days: IsoWeekday[];
  /** 每週目標次數；預設 = schedule_days.length */
  weekly_target: number;
  sort_order: number;
  config: HabitConfig;
  /** 引擎的上次狀態 (例如 GENERIC 的上次文字模板) */
  last_state: Record<string, unknown> | null;
}

export type ContainerStatus = 'ACTIVE' | 'ARCHIVED';

export interface Container extends SyncFields {
  container_id: string;
  habit_id: string;
  /** 子模式：咖啡 POUR_OVER / ESPRESSO；其他引擎可為 null */
  sub_mode: string | null;
  name: string;
  /** 星期綁定 (重訓課表使用) */
  bound_weekdays: IsoWeekday[];
  status: ContainerStatus;
  sort_order: number;
  /** 預設樣板 (首次使用時帶入) */
  default_payload: Record<string, unknown> | null;
  /** 上次使用此容器存下的 payload，供下次預填 */
  last_payload: Record<string, unknown> | null;
}

export type LogKind = 'CHECKIN' | 'ENTRY';

export interface HabitLog extends SyncFields {
  log_id: string;
  habit_id: string;
  /**
   * CHECKIN：TRACK 習慣每日至多一筆，承載 visual_flag (網格用)
   * ENTRY：實際紀錄內容 (重訓菜單、書摘、咖啡配方、日記…)
   */
  kind: LogKind;
  sub_mode: string | null;
  container_id: string | null;
  /** ISO 8601，帶時區偏移，例如 2026-10-21T15:20:00+08:00 */
  timestamp: string;
  local_date: LocalDate;
  /** 僅 CHECKIN 有值 */
  visual_flag: VisualFlag | null;
  summary_text: string;
  payload: Record<string, unknown> | null;
}

// ---------- Payload 形狀 (引擎專屬) ----------

export interface WorkoutSet {
  kg: number;
  reps: number;
}
export interface WorkoutExercise {
  name: string;
  sets: WorkoutSet[];
}
export type WorkoutMode = 'MAIN' | 'DELOAD';
export interface WorkoutPayload {
  exercises: WorkoutExercise[];
}

export interface CoffeePayload {
  grinder: string;
  temp_c: number;
  grind: number;
  /** 粉水比 1:x 的 x；義式模式可改用 dose/yield */
  ratio: number;
  rating?: number;
  flavors?: string[];
  note?: string;
}

export type NoteNature = 'INSIGHT' | 'STATUS' | 'CHUNK'; // 💡洞察 / 📌狀態 / 🗣️語塊
export interface ReadingPayload {
  nature: NoteNature;
  text: string;
  example?: string;
  page?: string;
  tags?: string[];
}

export interface GenericPayload {
  values: Record<string, number>;
  text?: string;
}
