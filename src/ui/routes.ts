import type { Habit } from '../data/types';
import type { Route } from './kit';

/** 依引擎決定工作台頁面 */
export function benchRoute(habit: Pick<Habit, 'habit_id' | 'engine_type'>, entryId?: string): Route {
  const name = habit.engine_type === 'WORKOUT' ? 'workout' : habit.engine_type === 'COFFEE' ? 'coffee' : 'simple';
  return { name, habitId: habit.habit_id, entryId };
}
