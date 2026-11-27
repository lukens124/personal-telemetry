/**
 * 新使用者的通用項目範本 (首次開啟時勾選)。全部都能在 App 內修改、刪除。
 */
import type { TelemetryDB } from './db';
import { createContainer, createHabit } from './repo';
import type { CardioConfig, CoffeeConfig, GenericConfig, ReadingConfig, WorkoutConfig, WorkoutPayload } from './types';

export type TemplateKey = 'workout' | 'reading' | 'english' | 'cardio' | 'coffee' | 'diary';

export const TEMPLATES: { key: TemplateKey; icon: string; name: string; hint: string }[] = [
  { key: 'workout', icon: '🏋️', name: '重訓', hint: '推 / 拉 / 腿三份課表，週一三五' },
  { key: 'reading', icon: '📚', name: '閱讀與筆記', hint: '一句話書摘，隨機喚醒複習' },
  { key: 'english', icon: '🗣️', name: '英文語塊', hint: '記下想學的句子' },
  { key: 'cardio', icon: '🚴', name: '有氧', hint: '騎車、跑步；可由 Apple 健康自動匯入' },
  { key: 'coffee', icon: '☕', name: '咖啡', hint: '手沖 / 義式參數與風味' },
  { key: 'diary', icon: '📝', name: '日記', hint: '自由文字，沿用上次格式' },
];

const ex = (name: string, kg: number, reps: number, n = 3) => ({ name, sets: Array.from({ length: n }, () => ({ kg, reps })) });
const plan = (p: WorkoutPayload) => p as unknown as Record<string, unknown>;

export async function seedTemplates(db: TelemetryDB, keys: TemplateKey[], now = new Date()): Promise<void> {
  const want = new Set(keys);
  await db.transaction('rw', db.habits, db.containers, async () => {
    if (want.has('workout')) {
      const h = await createHabit(db, {
        name: '重訓', icon: '🏋️', category_tab: 'TRACK', engine_type: 'WORKOUT',
        schedule_days: [1, 3, 5], weekly_target: 3,
        config: { cycle: { main: 3, deload: 1 } } satisfies WorkoutConfig,
      }, now);
      await createContainer(db, { habit_id: h.habit_id, name: '推（胸肩三頭）', bound_weekdays: [1], default_payload: plan({ exercises: [ex('臥推', 40, 8), ex('肩推', 20, 10)] }) }, now);
      await createContainer(db, { habit_id: h.habit_id, name: '拉（背二頭）', bound_weekdays: [3], default_payload: plan({ exercises: [ex('划船', 40, 10), ex('滑輪下拉', 35, 10)] }) }, now);
      await createContainer(db, { habit_id: h.habit_id, name: '腿', bound_weekdays: [5], default_payload: plan({ exercises: [ex('深蹲', 40, 8), ex('羅馬尼亞硬舉', 40, 8)] }) }, now);
    }
    if (want.has('reading')) {
      const h = await createHabit(db, {
        name: '閱讀與筆記', icon: '📚', category_tab: 'TRACK', engine_type: 'READING',
        schedule_days: [1, 2, 3, 4, 5], weekly_target: 5, config: { max_chars: 100 } satisfies ReadingConfig,
      }, now);
      await createContainer(db, { habit_id: h.habit_id, name: '我正在讀的書' }, now);
    }
    if (want.has('english')) {
      const h = await createHabit(db, {
        name: '英文語塊', icon: '🗣️', category_tab: 'TRACK', engine_type: 'READING',
        schedule_days: [2, 4, 6], weekly_target: 3, config: { max_chars: 100 } satisfies ReadingConfig,
      }, now);
      await createContainer(db, { habit_id: h.habit_id, name: '日常語塊' }, now);
    }
    if (want.has('cardio')) {
      await createHabit(db, {
        name: '有氧', icon: '🚴', category_tab: 'TRACK', engine_type: 'CARDIO',
        schedule_days: [2, 6], weekly_target: 2, config: { container_label: '路線 / 主題' } satisfies CardioConfig,
      }, now);
    }
    if (want.has('coffee')) {
      await createHabit(db, {
        name: '咖啡', icon: '☕', category_tab: 'LOG', engine_type: 'COFFEE', schedule_days: [], weekly_target: 0,
        config: { grinders: [], default_grinder: {} } satisfies CoffeeConfig,
      }, now);
    }
    if (want.has('diary')) {
      await createHabit(db, {
        name: '日記', icon: '📝', category_tab: 'LOG', engine_type: 'GENERIC', schedule_days: [], weekly_target: 0,
        config: { fields: [], has_text: true } satisfies GenericConfig,
        last_state: { template: '【今日狀態】\n\n【想法 / 筆記】\n' },
      }, now);
    }
  });
}
