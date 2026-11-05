import type { WorkoutExercise, WorkoutPayload, WorkoutSet } from '../data/types';

/** 舊紀錄沒有 done 欄位 → 視為完成 */
export const isDone = (s: WorkoutSet) => s.done !== false;

const plain = (s: WorkoutSet): WorkoutSet => ({ kg: s.kg, reps: s.reps });

/** 課表 → 本次訓練的起始狀態：全部未勾 */
export function toSession(template: WorkoutPayload | null | undefined): WorkoutExercise[] {
  return (template?.exercises ?? []).map((e) => ({ name: e.name, sets: e.sets.map((s) => ({ ...plain(s), done: false })) }));
}

/** 全部標記完成 (首頁極速打卡 = 照課表全部做完) */
export function markAllDone(p: WorkoutPayload): WorkoutPayload {
  return { exercises: p.exercises.map((e) => ({ name: e.name, sets: e.sets.map((s) => ({ ...plain(s), done: true })) })) };
}

export function countSets(p: WorkoutPayload): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const e of p.exercises) for (const s of e.sets) {
    total++;
    if (isDone(s)) done++;
  }
  return { done, total };
}

/**
 * 存檔後的下次課表：
 *  - 結構 (動作與組數) 照這次 → 這次移除或新增的動作會帶到下次
 *  - 有勾的組：用這次的重量與次數
 *  - 沒勾的組：沿用上次課表的數值 (沒做不代表要改)
 */
export function nextTemplate(prev: WorkoutPayload | null | undefined, session: WorkoutPayload): WorkoutPayload {
  const byName = new Map((prev?.exercises ?? []).map((e) => [e.name, e]));
  return {
    exercises: session.exercises.map((e) => {
      const old = byName.get(e.name);
      return {
        name: e.name,
        sets: e.sets.map((s, k) => (isDone(s) ? plain(s) : plain(old?.sets[k] ?? s))),
      };
    }),
  };
}
