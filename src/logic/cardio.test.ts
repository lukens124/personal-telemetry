import { describe, expect, it } from 'vitest';
import { createDB } from '../data/db';
import { migrateBikeToCardio } from '../data/migrate';
import { createContainer, createHabit, listEntries, listHabits, saveEntry } from '../data/repo';
import type { CardioPayload, HabitLog } from '../data/types';
import { cardioSummary, cardioWeek, classifyHealthWorkout, fmtPace, paceSec } from './cardio';

describe('有氧摘要與配速', () => {
  it('跑步顯示配速', () => {
    const p: CardioPayload = { duration_min: 27.5, distance_km: 5, avg_hr: 155, source: 'HEALTH' };
    expect(fmtPace(paceSec(p))).toBe(`5'30"`);
    expect(cardioSummary('RUN', null, p)).toBe(`跑步 · 28m · 5km · 5'30"/km · ♥155`);
  });
  it('室內台顯示功率、不顯示距離', () => {
    expect(cardioSummary('INDOOR', null, { duration_min: 60, power_w: 180, source: 'MANUAL' })).toBe('室內台 · 1h00m · 180W');
  });
  it('其他運動顯示健康 App 原名', () => {
    expect(cardioSummary('OTHER', null, { duration_min: 90, distance_km: 6.2, hk_type: '健行', source: 'HEALTH' })).toBe('健行 · 1h30m · 6.2km');
  });
});

describe('健康 App 運動分類 (中英文)', () => {
  it.each([
    ['Outdoor Cycling', 40, 'ROAD'],
    ['Cycling', 0, 'INDOOR'],
    ['Indoor Cycling', 0, 'INDOOR'],
    ['騎自行車', 25.3, 'ROAD'],
    ['室內騎自行車', 0, 'INDOOR'],
    ['Running', 5, 'RUN'],
    ['跑步', 10, 'RUN'],
    ['Traditional Strength Training', 0, 'STRENGTH'],
    ['傳統肌力訓練', 0, 'STRENGTH'],
    ['Functional Strength Training', 0, 'STRENGTH'],
    ['Hiking', 8, 'OTHER'],
  ] as const)('%s → %s', (name, km, want) => {
    expect(classifyHealthWorkout(name, km)).toBe(want);
  });
});

describe('本週累計', () => {
  it('只算本週 (週一起) 的有效紀錄', () => {
    const e = (d: string, p: Partial<CardioPayload>, deleted: 0 | 1 = 0) =>
      ({ kind: 'ENTRY', deleted, local_date: d, payload: { duration_min: 0, source: 'MANUAL', ...p } }) as unknown as HabitLog;
    const w = cardioWeek(
      [e('2026-11-23', { duration_min: 60, distance_km: 25.5, kcal: 500 }), e('2026-11-26', { duration_min: 30, kcal: 250 }),
        e('2026-11-22', { duration_min: 99 }), e('2026-11-24', { duration_min: 40 }, 1)],
      '2026-11-27',
    );
    expect(w).toEqual({ minutes: 90, km: 25.5, kcal: 750, count: 2 });
  });
});

describe('遷移：舊騎車 → 有氧', () => {
  it('習慣、紀錄、路線都保留，且可重複執行', async () => {
    const db = createDB('migrate-1');
    const now = new Date('2026-11-27T10:00:00+08:00');
    const bike = await createHabit(db, {
      name: '騎車', icon: '🚴', category_tab: 'TRACK', engine_type: 'GENERIC', schedule_days: [4, 6], weekly_target: 2,
      config: { fields: [{ key: 'distance_km', label: '距離', type: 'number' }, { key: 'duration_min', label: '時間', type: 'duration' }], has_text: true, container_label: '路線 / 主題' },
    }, now);
    const route = await createContainer(db, { habit_id: bike.habit_id, name: '巴拉卡公路' }, now);
    await saveEntry(db, bike, { container_id: route.container_id, payload: { values: { distance_km: 62.5, duration_min: 155 }, text: '風很大' } }, now);

    expect(await migrateBikeToCardio(db, now)).toBe(1);
    expect(await migrateBikeToCardio(db, now)).toBe(0);

    const h = (await listHabits(db))[0];
    expect([h.name, h.engine_type, h.schedule_days]).toEqual(['有氧', 'CARDIO', [4, 6]]);
    const [log] = await listEntries(db, h.habit_id);
    expect(log.sub_mode).toBe('ROAD');
    expect(log.payload).toEqual({ duration_min: 155, distance_km: 62.5, note: '風很大', source: 'MANUAL' });
    expect(log.summary_text).toBe('公路車 · 巴拉卡公路 · 2h35m · 62.5km');
    expect(log.dirty).toBe(1);
  });
});
