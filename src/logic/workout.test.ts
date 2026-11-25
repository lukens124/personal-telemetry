import { beforeEach, describe, expect, it } from 'vitest';
import { createDB, type TelemetryDB } from '../data/db';
import { findBoundContainer, listHabits, quickCheckin, saveEntry } from '../data/repo';
import { seedIfEmpty } from '../data/seed';
import type { Habit, WorkoutPayload } from '../data/types';
import { countSets, editSet, nextTemplate, toSession } from './workout';

const TUE = new Date('2026-10-20T07:00:00+08:00');
const NEXT_TUE = new Date('2026-10-27T07:00:00+08:00');
let db: TelemetryDB;
let gym: Habit;
let n = 0;

beforeEach(async () => {
  db = createDB(`wo-${n++}`);
  await seedIfEmpty(db, TUE);
  gym = (await listHabits(db)).find((h) => h.engine_type === 'WORKOUT')!;
});

const prev: WorkoutPayload = {
  exercises: [
    { name: '深蹲', sets: [{ kg: 100, reps: 5 }, { kg: 110, reps: 5 }, { kg: 110, reps: 5 }] },
    { name: 'RDL', sets: [{ kg: 120, reps: 6 }] },
  ],
};

describe('課表與實際分離', () => {
  it('進入工作台時全部未勾', () => {
    expect(countSets({ exercises: toSession(prev) })).toEqual({ done: 0, total: 4 });
  });

  it('有勾的組更新數值，沒勾的組沿用上次', () => {
    const session = toSession(prev);
    session[0].sets[0] = { kg: 105, reps: 5, done: true };
    session[0].sets[1] = { kg: 115, reps: 5, done: true };
    session[0].sets[2] = { kg: 999, reps: 1, done: false }; // 調了但沒做
    session[1].sets[0].kg = 130; // RDL 沒做
    expect(nextTemplate(prev, { exercises: session })).toEqual({
      exercises: [
        { name: '深蹲', sets: [{ kg: 105, reps: 5 }, { kg: 115, reps: 5 }, { kg: 110, reps: 5 }] },
        { name: 'RDL', sets: [{ kg: 120, reps: 6 }] },
      ],
    });
  });

  it('移除的動作不帶到下次，新增的動作會帶到下次', () => {
    const session = toSession(prev).slice(0, 1);
    session[0].sets.forEach((s) => (s.done = true));
    session.push({ name: '弓箭步', sets: [{ kg: 20, reps: 10, done: true }] });
    expect(nextTemplate(prev, { exercises: session }).exercises.map((e) => e.name)).toEqual(['深蹲', '弓箭步']);
  });
});

describe('存檔流程', () => {
  it('部分完成：摘要標示略過與組數，下次仍保留略過的動作', async () => {
    const legs = (await findBoundContainer(db, gym.habit_id, 2))!;
    const session = toSession(legs.default_payload as unknown as WorkoutPayload);
    session[0].sets[0].done = true; // 深蹲只做第 1 組
    const e = await saveEntry(db, gym, { container_id: legs.container_id, sub_mode: 'MAIN', payload: { exercises: session } }, TUE);
    expect(e.summary_text).toBe('深蹲100(1/2) / RDL(略)');

    const r = await quickCheckin(db, gym, NEXT_TUE);
    expect(r.status === 'CHECKED' && r.entry?.summary_text).toBe('深蹲110 / RDL120');
  });

  it('首頁極速打卡 = 全部完成', async () => {
    const r = await quickCheckin(db, gym, TUE);
    const p = (r.status === 'CHECKED' ? r.entry?.payload : null) as unknown as WorkoutPayload;
    expect(countSets(p)).toEqual({ done: 3, total: 3 });
  });
});

describe('修改即打勾', () => {
  const ex = () => toSession(prev)[0]; // 深蹲 3 組，全未勾
  it('改第 3 組重量：第 1~3 組都打勾', () => {
    const r = editSet(ex(), 2, { kg: 115 });
    expect(r.sets.map((s) => s.done)).toEqual([true, true, true]);
    expect(r.sets[2].kg).toBe(115);
  });
  it('改第 2 組次數：第 1~2 組打勾，第 3 組不動', () => {
    expect(editSet(ex(), 1, { reps: 6 }).sets.map((s) => s.done)).toEqual([true, true, false]);
  });
  it('數值沒變 (例如只是點進去再離開) 不打勾', () => {
    expect(editSet(ex(), 2, { kg: 110 }).sets.map((s) => s.done)).toEqual([false, false, false]);
  });
  it('已手動取消的後面組不受影響', () => {
    const e = ex();
    e.sets[2].done = false;
    expect(editSet(e, 0, { kg: 101 }).sets.map((s) => s.done)).toEqual([true, false, false]);
  });
});
