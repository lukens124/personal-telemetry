import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday, toIsoWithOffset, toLocalDate, weekDates } from '../data/dates';
import type { Habit, HabitLog } from '../data/types';
import { cycleStatus } from './cycle';
import { computeWeekRow } from './grid';

describe('dates', () => {
  it('ISO 星期：2026-10-19 是週一、10-25 是週日', () => {
    expect(isoWeekday('2026-10-19')).toBe(1);
    expect(isoWeekday('2026-10-20')).toBe(2);
    expect(isoWeekday('2026-10-25')).toBe(7);
  });
  it('週從週一開始，跨月正確', () => {
    expect(weekDates('2026-10-21')).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(weekDates('2026-11-01')[0]).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('本地日期與時區偏移 (Asia/Taipei)', () => {
    const d = new Date('2026-10-20T16:30:00Z'); // 台北 10/21 00:30
    expect(toLocalDate(d)).toBe('2026-10-21');
    expect(toIsoWithOffset(d)).toBe('2026-10-21T00:30:00+08:00');
  });
});

describe('N:M 週期 (3 主訓 + 1 減載)', () => {
  const cfg = { main: 3, deload: 1 };
  it('從零開始建議主訓 1/3', () => {
    expect(cycleStatus([], cfg)).toEqual({ suggested: 'MAIN', position: 1, of: 3 });
  });
  it('主訓 3 次後建議減載', () => {
    expect(cycleStatus(['MAIN', 'MAIN'], cfg)).toEqual({ suggested: 'MAIN', position: 3, of: 3 });
    expect(cycleStatus(['MAIN', 'MAIN', 'MAIN'], cfg)).toEqual({ suggested: 'DELOAD', position: 1, of: 1 });
  });
  it('減載完回到主訓 1/3', () => {
    expect(cycleStatus(['MAIN', 'MAIN', 'MAIN', 'DELOAD'], cfg)).toEqual({ suggested: 'MAIN', position: 1, of: 3 });
  });
  it('減載 2 次的設定', () => {
    expect(cycleStatus(['MAIN', 'DELOAD'], { main: 1, deload: 2 })).toEqual({ suggested: 'DELOAD', position: 2, of: 2 });
  });
  it('不設減載時一直主訓', () => {
    expect(cycleStatus(['MAIN', 'MAIN', 'MAIN'], { main: 3, deload: 0 }).suggested).toBe('MAIN');
  });
});

describe('週網格', () => {
  const habit = {
    habit_id: 'h1', schedule_days: [1, 2, 3], weekly_target: 3,
  } as unknown as Habit;
  const ck = (date: string, flag: 1 | 3): HabitLog =>
    ({ habit_id: 'h1', kind: 'CHECKIN', local_date: date, visual_flag: flag, deleted: 0 }) as HabitLog;

  it('週三：一完成、二錯過、三待執行、其他非排程', () => {
    const row = computeWeekRow(habit, [ck('2026-10-19', 1)], '2026-10-21');
    expect(row.cells.map((c) => c.state)).toEqual(['DONE', 'MISSED', 'PENDING_TODAY', 'OFF', 'OFF', 'OFF', 'OFF']);
    expect(row.done).toBe(1);
  });
  it('略過不算失敗，並從目標扣除', () => {
    const row = computeWeekRow(habit, [ck('2026-10-19', 1), ck('2026-10-20', 3)], '2026-10-21');
    expect(row.cells[1].state).toBe('SKIP');
    expect(row.effective_target).toBe(2);
  });
  it('非排程日完成也會亮', () => {
    const row = computeWeekRow(habit, [ck('2026-10-24', 1)], '2026-10-24');
    expect(row.cells[5].state).toBe('DONE');
  });
  it('週一當天：二三為即將到來', () => {
    const row = computeWeekRow(habit, [], '2026-10-19');
    expect(row.cells.slice(0, 3).map((c) => c.state)).toEqual(['PENDING_TODAY', 'UPCOMING', 'UPCOMING']);
  });
});
