import type { WorkoutMode } from '../data/types';

export interface CycleStatus {
  /** 下一次建議的檔位 */
  suggested: WorkoutMode;
  /** 建議檔位在本段中的第幾次 (1-based) */
  position: number;
  /** 本段總次數 (N 或 M) */
  of: number;
}

/**
 * N:M 週期推算 (主訓 N 次 + 減載 M 次)
 * 只看實際訓練紀錄 (ENTRY)；合理略過不會產生 ENTRY，因此不推進計數。
 * @param history 依時間排序 (舊 → 新) 的訓練檔位
 */
export function cycleStatus(history: WorkoutMode[], cfg: { main: number; deload: number }): CycleStatus {
  const N = Math.max(1, cfg.main);
  const M = Math.max(0, cfg.deload);
  if (history.length === 0) return { suggested: 'MAIN', position: 1, of: N };

  const last = history[history.length - 1];
  let run = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === last; i--) run++;

  if (last === 'MAIN') {
    if (M === 0) return { suggested: 'MAIN', position: (run % N) + 1, of: N };
    if (run < N) return { suggested: 'MAIN', position: run + 1, of: N };
    return { suggested: 'DELOAD', position: 1, of: M };
  }
  // last === 'DELOAD'
  if (run < M) return { suggested: 'DELOAD', position: run + 1, of: M };
  return { suggested: 'MAIN', position: 1, of: N };
}
