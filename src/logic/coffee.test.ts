import { beforeEach, describe, expect, it } from 'vitest';
import { createDB, type TelemetryDB } from '../data/db';
import { createContainer, createHabit, deleteHabit, duplicateEntry, listContainers, listEntries, listHabits, saveEntry, timeline } from '../data/repo';
import { seedIfEmpty } from '../data/seed';
import type { CoffeeConfig, Habit } from '../data/types';
import { coffeeDefaults } from './coffee';

const TUE = new Date('2026-10-20T08:00:00+08:00');
const THU = new Date('2026-10-22T08:00:00+08:00');
let db: TelemetryDB;
let n = 0;
let coffee: Habit;

beforeEach(async () => {
  db = createDB(`coffee-${n++}`);
  await seedIfEmpty(db, TUE);
  coffee = (await listHabits(db)).find((h) => h.engine_type === 'COFFEE')!;
});

describe('咖啡預填', () => {
  it('沒有紀錄：使用豆子預設值與手沖預設磨豆機', async () => {
    const bean = (await listContainers(db, coffee.habit_id))[0];
    const p = coffeeDefaults([], bean, 'POUR_OVER', coffee.config as CoffeeConfig);
    expect(p).toEqual({ grinder: '1Zpresso J', temp_c: 92, grind: 24, ratio: 15 });
  });

  it('義式模式不帶入手沖的粉水比', async () => {
    const bean = (await listContainers(db, coffee.habit_id))[0];
    const p = coffeeDefaults([], bean, 'ESPRESSO', coffee.config as CoffeeConfig);
    expect(p.ratio).toBeUndefined();
    expect(p.dose_g).toBe(18);
    expect(p.grind).toBe(10); // 手沖豆子的 24 格不套用到義式
    expect(p.grinder).toBe('1Zpresso J'); // 沒設義式預設 → 第一台
  });

  it('同豆同模式沿用上一筆參數，但不沿用評分與風味', async () => {
    const bean = (await listContainers(db, coffee.habit_id))[0];
    await saveEntry(db, coffee, {
      container_id: bean.container_id,
      sub_mode: 'POUR_OVER',
      payload: { grinder: '1Zpresso J', temp_c: 90, grind: 22, ratio: 16, rating: 4.5, flavors: ['花香'] },
    }, TUE);
    const p = coffeeDefaults(await listEntries(db, coffee.habit_id), bean, 'POUR_OVER', coffee.config as CoffeeConfig);
    expect(p).toEqual({ grinder: '1Zpresso J', temp_c: 90, grind: 22, ratio: 16 });
  });

  it('換新豆時沿用同模式上一筆的沖煮參數', async () => {
    const bean = (await listContainers(db, coffee.habit_id))[0];
    await saveEntry(db, coffee, { container_id: bean.container_id, sub_mode: 'POUR_OVER', payload: { grinder: 'X', temp_c: 89, grind: 20, ratio: 15 } }, TUE);
    const kenya = await createContainer(db, { habit_id: coffee.habit_id, name: '肯亞 AA' }, TUE);
    const p = coffeeDefaults(await listEntries(db, coffee.habit_id), kenya, 'POUR_OVER', coffee.config as CoffeeConfig);
    expect(p.temp_c).toBe(89);
  });

  it('義式摘要', async () => {
    const bean = (await listContainers(db, coffee.habit_id))[0];
    const e = await saveEntry(db, coffee, {
      container_id: bean.container_id, sub_mode: 'ESPRESSO',
      payload: { grinder: 'DF64', temp_c: 93, grind: 10, dose_g: 18, yield_g: 36, time_s: 28 },
    }, TUE);
    expect(e.summary_text).toBe('衣索比亞 水洗 耶加雪菲 · DF64 · 93°C · 10格 · 18g→36g · 28s');
  });
});

describe('紀錄視角', () => {
  it('右滑複製咖啡：保留模式與豆子，日期為今天', async () => {
    const bean = (await listContainers(db, coffee.habit_id))[0];
    const src = await saveEntry(db, coffee, { container_id: bean.container_id, sub_mode: 'ESPRESSO', payload: { grinder: 'X', temp_c: 93, grind: 10, dose_g: 18, yield_g: 36, time_s: 28 } }, TUE);
    const copy = await duplicateEntry(db, src.log_id, THU);
    expect(copy.sub_mode).toBe('ESPRESSO');
    expect(copy.container_id).toBe(bean.container_id);
    expect(copy.local_date).toBe('2026-10-22');
  });

  it('自建分類出現在時間軸；刪除後隱藏', async () => {
    const wine = await createHabit(db, {
      name: '品酒', icon: '🍷', category_tab: 'LOG', engine_type: 'GENERIC',
      schedule_days: [], weekly_target: 0, config: { fields: [], has_text: true },
      last_state: { template: '【酒款】\n' },
    }, TUE);
    await saveEntry(db, wine, { container_id: null, payload: { values: {}, text: '【酒款】Barolo' } }, TUE);
    expect((await timeline(db)).some((l) => l.habit_id === wine.habit_id)).toBe(true);
    await deleteHabit(db, wine.habit_id, THU);
    expect((await listHabits(db)).some((h) => h.habit_id === wine.habit_id)).toBe(false);
    expect((await timeline(db)).some((l) => l.habit_id === wine.habit_id)).toBe(false);
  });
});
