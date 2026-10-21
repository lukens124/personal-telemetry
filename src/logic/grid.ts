import { isoWeekday, weekDates } from '../data/dates';
import { FLAG_DONE, FLAG_SKIP, type Habit, type HabitLog, type LocalDate } from '../data/types';

/**
 * 網格格子狀態 (1.0-A 頂部唯讀網格)
 *  DONE           [X]  已完成 (非排程日完成也算)
 *  SKIP           [-]  合理略過
 *  PENDING_TODAY  [•]  今天是排程日、尚未完成
 *  MISSED         [ ]  排程日已過、未完成 → 刻意保留空白框
 *  UPCOMING       [ ]  排程日、還沒到
 *  OFF             -   非排程日
 */
export type CellState = 'DONE' | 'SKIP' | 'PENDING_TODAY' | 'MISSED' | 'UPCOMING' | 'OFF';

export interface WeekCell {
  date: LocalDate;
  state: CellState;
}

export interface WeekRow {
  habit_id: string;
  cells: WeekCell[];
  done: number;
  skipped: number;
  /** 原始每週目標 */
  target: number;
  /** 扣掉合理略過後的目標：略過不算失敗，也不拉低達成率 */
  effective_target: number;
}

export function computeWeekRow(habit: Habit, checkins: HabitLog[], today: LocalDate): WeekRow {
  const byDate = new Map<LocalDate, HabitLog>();
  for (const c of checkins) {
    if (c.kind === 'CHECKIN' && c.deleted === 0 && c.habit_id === habit.habit_id) byDate.set(c.local_date, c);
  }

  let done = 0;
  let skipped = 0;
  const cells = weekDates(today).map<WeekCell>((date) => {
    const ck = byDate.get(date);
    if (ck?.visual_flag === FLAG_DONE) {
      done++;
      return { date, state: 'DONE' };
    }
    if (ck?.visual_flag === FLAG_SKIP) {
      skipped++;
      return { date, state: 'SKIP' };
    }
    const scheduled = habit.schedule_days.includes(isoWeekday(date));
    if (!scheduled) return { date, state: 'OFF' };
    if (date === today) return { date, state: 'PENDING_TODAY' };
    return { date, state: date < today ? 'MISSED' : 'UPCOMING' };
  });

  return {
    habit_id: habit.habit_id,
    cells,
    done,
    skipped,
    target: habit.weekly_target,
    effective_target: Math.max(0, habit.weekly_target - skipped),
  };
}

/** 今日清單是否應列出此習慣：今天是排程日，或今天已有打卡紀錄 */
export function isOnTodayList(habit: Habit, todayCheckin: HabitLog | undefined, today: LocalDate): boolean {
  return habit.schedule_days.includes(isoWeekday(today)) || !!(todayCheckin && todayCheckin.deleted === 0);
}
