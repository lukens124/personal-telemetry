/**
 * 首次啟動的預設樣板。全部都可以在 App 內修改、封存或刪除。
 * 重量 / 次數為佔位值，之後以實際紀錄覆蓋。
 */
import type { TelemetryDB } from './db';
import { createContainer, createHabit } from './repo';
import type { CoffeeConfig, GenericConfig, ReadingConfig, WorkoutConfig, WorkoutPayload } from './types';

/** GENERIC 日記的首次模板 (之後自動沿用上一次的文字結構) */
export const DIARY_DEFAULT_TEMPLATE = '【今日狀態】\n\n【關鍵決策 / 思維筆記】\n';

const sets = (kg: number, reps: number, n: number) => Array.from({ length: n }, () => ({ kg, reps }));
const workout = (p: WorkoutPayload) => p as unknown as Record<string, unknown>;

export async function seedIfEmpty(db: TelemetryDB, now = new Date()): Promise<boolean> {
  if ((await db.habits.count()) > 0) return false;

  await db.transaction('rw', db.habits, db.containers, async () => {
    // ---------------- TRACK ----------------
    const gym = await createHabit(
      db,
      {
        name: '重訓',
        icon: '🏋️',
        category_tab: 'TRACK',
        engine_type: 'WORKOUT',
        schedule_days: [1, 2, 3],
        weekly_target: 3,
        config: { cycle: { main: 3, deload: 1 } } satisfies WorkoutConfig,
      },
      now,
    );
    await createContainer(
      db,
      {
        habit_id: gym.habit_id,
        name: '背腹菜單',
        bound_weekdays: [1],
        default_payload: workout({
          exercises: [
            { name: '引體向上', sets: sets(0, 8, 3) },
            { name: '划船', sets: sets(60, 8, 3) },
          ],
        }),
      },
      now,
    );
    await createContainer(
      db,
      {
        habit_id: gym.habit_id,
        name: '腿日菜單',
        bound_weekdays: [2],
        default_payload: workout({
          exercises: [
            { name: '深蹲', sets: [{ kg: 100, reps: 5 }, { kg: 110, reps: 5 }] },
            { name: '六角槓 RDL', sets: [{ kg: 120, reps: 6 }] },
          ],
        }),
      },
      now,
    );
    await createContainer(
      db,
      {
        habit_id: gym.habit_id,
        name: '胸肩腹菜單',
        bound_weekdays: [3],
        default_payload: workout({
          exercises: [
            { name: '臥推', sets: sets(80, 5, 3) },
            { name: '肩推', sets: sets(40, 8, 3) },
          ],
        }),
      },
      now,
    );

    const reading = await createHabit(
      db,
      {
        name: '閱讀與筆記',
        icon: '📚',
        category_tab: 'TRACK',
        engine_type: 'READING',
        schedule_days: [1, 2, 3, 4, 5],
        weekly_target: 5,
        config: { max_chars: 100 } satisfies ReadingConfig,
      },
      now,
    );
    await createContainer(db, { habit_id: reading.habit_id, name: '《超級思維》' }, now);
    await createContainer(db, { habit_id: reading.habit_id, name: '《雜訊》', status: 'ARCHIVED' }, now);

    const english = await createHabit(
      db,
      {
        name: '英文語塊',
        icon: '🗣️',
        category_tab: 'TRACK',
        engine_type: 'READING',
        schedule_days: [2, 4, 6],
        weekly_target: 3,
        config: { max_chars: 100 } satisfies ReadingConfig,
      },
      now,
    );
    await createContainer(db, { habit_id: english.habit_id, name: '日常語塊' }, now);

    const bike = await createHabit(
      db,
      {
        name: '騎車',
        icon: '🚴',
        category_tab: 'TRACK',
        engine_type: 'GENERIC',
        schedule_days: [4, 6],
        weekly_target: 2,
        config: {
          fields: [
            { key: 'distance_km', label: '距離', type: 'number', unit: 'km', step: 0.1 },
            { key: 'duration_min', label: '時間', type: 'duration' },
          ],
          has_text: true,
          container_label: '路線 / 主題',
        } satisfies GenericConfig,
      },
      now,
    );
    await createContainer(db, { habit_id: bike.habit_id, name: '環台北' }, now);
    await createContainer(db, { habit_id: bike.habit_id, name: '巴拉卡公路' }, now);

    // ---------------- LOG ----------------
    const coffee = await createHabit(
      db,
      {
        name: '咖啡',
        icon: '☕',
        category_tab: 'LOG',
        engine_type: 'COFFEE',
        schedule_days: [],
        weekly_target: 0,
        config: {
          grinders: ['1Zpresso J'],
          default_grinder: { POUR_OVER: '1Zpresso J' },
        } satisfies CoffeeConfig,
      },
      now,
    );
    await createContainer(
      db,
      {
        habit_id: coffee.habit_id,
        sub_mode: 'POUR_OVER',
        name: '衣索比亞 水洗 耶加雪菲',
        default_payload: { grinder: '1Zpresso J', temp_c: 92, grind: 24, ratio: 15 },
      },
      now,
    );

    await createHabit(
      db,
      {
        name: '日記',
        icon: '📝',
        category_tab: 'LOG',
        engine_type: 'GENERIC',
        schedule_days: [],
        weekly_target: 0,
        config: { fields: [], has_text: true } satisfies GenericConfig,
        last_state: { template: DIARY_DEFAULT_TEMPLATE },
      },
      now,
    );
  });
  return true;
}

