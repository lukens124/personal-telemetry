import { beforeEach, describe, expect, it } from 'vitest';
import { createDB, type TelemetryDB } from './db';
import {
  bindWeekday,
  checkinId,
  duplicateEntry,
  findBoundContainer,
  getCheckin,
  listContainers,
  listEntries,
  listHabits,
  quickCheckin,
  randomRecall,
  saveEntry,
  timeline,
  toggleSkip,
  trackDashboard,
  workoutCycle,
} from './repo';
import { DIARY_DEFAULT_TEMPLATE, seedIfEmpty } from './seed';
import type { Habit } from './types';

// 台北時間
const TUE = new Date('2026-10-20T07:00:00+08:00'); // 週二 → 腿日
const WED = new Date('2026-10-21T07:00:00+08:00'); // 週三 → 胸肩腹
const THU = new Date('2026-10-22T19:00:00+08:00'); // 週四 → 騎車，無重訓綁定

let db: TelemetryDB;
let n = 0;
const habit = async (name: string) => (await listHabits(db)).find((h) => h.name === name) as Habit;

beforeEach(async () => {
  db = createDB(`test-${n++}`);
  await seedIfEmpty(db, TUE);
});

describe('seed', () => {
  it('建立 4 個追蹤 + 2 個紀錄項目，且不重複 seed', async () => {
    expect((await listHabits(db, 'TRACK')).map((h) => h.name)).toEqual(['重訓', '閱讀與筆記', '英文語塊', '騎車']);
    expect((await listHabits(db, 'LOG')).map((h) => h.name)).toEqual(['咖啡', '日記']);
    expect(await seedIfEmpty(db)).toBe(false);
  });
  it('騎車排在週四、週六，有兩條路線', async () => {
    const bike = await habit('騎車');
    expect(bike.schedule_days).toEqual([4, 6]);
    expect((await listContainers(db, bike.habit_id)).map((c) => c.name)).toEqual(['環台北', '巴拉卡公路']);
  });
});

describe('星期綁定', () => {
  it('週一二三分別對應三份課表，其他天沒有', async () => {
    const gym = await habit('重訓');
    expect((await findBoundContainer(db, gym.habit_id, 1))?.name).toBe('背腹菜單');
    expect((await findBoundContainer(db, gym.habit_id, 2))?.name).toBe('腿日菜單');
    expect((await findBoundContainer(db, gym.habit_id, 3))?.name).toBe('胸肩腹菜單');
    expect(await findBoundContainer(db, gym.habit_id, 4)).toBeNull();
  });
  it('重新綁定會從原課表移除該天', async () => {
    const gym = await habit('重訓');
    const back = (await listContainers(db, gym.habit_id))[0];
    await bindWeekday(db, gym.habit_id, 2, back.container_id, TUE);
    expect((await findBoundContainer(db, gym.habit_id, 2))?.name).toBe('背腹菜單');
    const legs = (await listContainers(db, gym.habit_id)).find((c) => c.name === '腿日菜單')!;
    expect(legs.bound_weekdays).toEqual([]);
  });
});

describe('極速打卡 (1.0-A 左側)', () => {
  it('週二重訓：自動帶入腿日菜單、建立紀錄、網格亮起', async () => {
    const gym = await habit('重訓');
    const r = await quickCheckin(db, gym, TUE);
    expect(r.status).toBe('CHECKED');
    if (r.status !== 'CHECKED') return;
    expect(r.entry?.summary_text).toBe('深蹲110 / RDL120');
    expect(r.entry?.sub_mode).toBe('MAIN');
    const { rows } = await trackDashboard(db, TUE);
    expect(rows.find((x) => x.habit_id === gym.habit_id)!.cells[1].state).toBe('DONE');
  });
  it('週四重訓沒有綁定 → 要求開啟工作台，不寫入資料', async () => {
    const gym = await habit('重訓');
    expect((await quickCheckin(db, gym, THU)).status).toBe('NEEDS_WORKBENCH');
    expect(await listEntries(db, gym.habit_id)).toHaveLength(0);
  });
  it('再點一次取消，連同自動建立的紀錄一起移除', async () => {
    const gym = await habit('重訓');
    await quickCheckin(db, gym, TUE);
    expect((await quickCheckin(db, gym, TUE)).status).toBe('UNCHECKED');
    expect(await getCheckin(db, gym.habit_id, '2026-10-20')).toBeUndefined();
    expect(await listEntries(db, gym.habit_id)).toHaveLength(0);
  });
  it('閱讀左點只打卡，不建立筆記', async () => {
    const reading = await habit('閱讀與筆記');
    await quickCheckin(db, reading, TUE);
    expect((await getCheckin(db, reading.habit_id, '2026-10-20'))?.visual_flag).toBe(1);
    expect(await listEntries(db, reading.habit_id)).toHaveLength(0);
  });
});

describe('同日打卡 + 書摘 (規則 5)', () => {
  it('先左點打卡、再新增書摘：仍只有一筆打卡，書摘獨立存在', async () => {
    const reading = await habit('閱讀與筆記');
    const book = (await listContainers(db, reading.habit_id))[0];
    await quickCheckin(db, reading, TUE);
    await saveEntry(db, reading, { container_id: book.container_id, payload: { nature: 'INSIGHT', text: '錯誤歸因往往來自忽略基礎機率' } }, TUE);
    const checkins = (await db.logs.toArray()).filter((l) => l.kind === 'CHECKIN' && l.habit_id === reading.habit_id);
    expect(checkins).toHaveLength(1);
    expect(checkins[0].log_id).toBe(checkinId(reading.habit_id, '2026-10-20'));
    expect(await listEntries(db, reading.habit_id)).toHaveLength(1);
  });
  it('書摘會出現在紀錄時間軸與隨機喚醒池', async () => {
    const reading = await habit('閱讀與筆記');
    const book = (await listContainers(db, reading.habit_id))[0];
    await saveEntry(db, reading, { container_id: book.container_id, payload: { nature: 'INSIGHT', text: '基礎機率' } }, TUE);
    expect((await timeline(db)).map((l) => l.summary_text)).toContain('基礎機率');
    expect((await randomRecall(db, () => 0))?.summary_text).toBe('基礎機率');
  });
});

describe('合理略過 (左滑)', () => {
  it('略過後網格顯示 [-]，再滑一次取消', async () => {
    const gym = await habit('重訓');
    expect(await toggleSkip(db, gym, TUE)).toBe('SKIPPED');
    let { rows } = await trackDashboard(db, TUE);
    expect(rows[0].cells[1].state).toBe('SKIP');
    expect(await toggleSkip(db, gym, TUE)).toBe('UNSKIPPED');
    ({ rows } = await trackDashboard(db, TUE));
    expect(rows[0].cells[1].state).toBe('PENDING_TODAY');
  });
  it('略過不推進 N:M 週期', async () => {
    const gym = await habit('重訓');
    await toggleSkip(db, gym, TUE);
    expect(await workoutCycle(db, gym)).toEqual({ suggested: 'MAIN', position: 1, of: 3 });
  });
  it('已完成的不能略過', async () => {
    const gym = await habit('重訓');
    await quickCheckin(db, gym, TUE);
    expect(await toggleSkip(db, gym, TUE)).toBe('ALREADY_DONE');
  });
});

describe('重訓工作台與 N:M', () => {
  it('儲存後更新課表的 last_payload，下次打卡帶入新重量', async () => {
    const gym = await habit('重訓');
    const legs = (await findBoundContainer(db, gym.habit_id, 2))!;
    await saveEntry(db, gym, {
      container_id: legs.container_id,
      sub_mode: 'MAIN',
      payload: { exercises: [{ name: '深蹲', sets: [{ kg: 115, reps: 5 }] }] },
    }, TUE);
    const nextTue = new Date('2026-10-27T07:00:00+08:00');
    const r = await quickCheckin(db, gym, nextTue);
    expect(r.status === 'CHECKED' && r.entry?.summary_text).toBe('深蹲115');
  });
  it('3 次主訓後建議減載', async () => {
    const gym = await habit('重訓');
    for (const d of ['2026-10-19', '2026-10-20', '2026-10-21']) {
      await quickCheckin(db, gym, new Date(`${d}T07:00:00+08:00`));
    }
    expect((await workoutCycle(db, gym)).suggested).toBe('DELOAD');
  });
});

describe('騎車 (GENERIC + 路線)', () => {
  it('週四出現在今日清單；儲存後摘要含路線/距離/時間並完成打卡', async () => {
    const bike = await habit('騎車');
    const { today } = await trackDashboard(db, THU);
    expect(today.map((t) => t.habit.name)).toContain('騎車');
    const route = (await listContainers(db, bike.habit_id)).find((c) => c.name === '巴拉卡公路')!;
    const e = await saveEntry(db, bike, {
      container_id: route.container_id,
      payload: { values: { distance_km: 62.5, duration_min: 155 }, text: '' },
    }, THU);
    expect(e.summary_text).toBe('巴拉卡公路 · 62.5km · 2h35m');
    expect((await getCheckin(db, bike.habit_id, '2026-10-22'))?.visual_flag).toBe(1);
  });
});

describe('紀錄視角 (1.0-B)', () => {
  it('右滑複製：以現在時間生成新紀錄', async () => {
    const coffee = await habit('咖啡');
    const bean = (await listContainers(db, coffee.habit_id))[0];
    const src = await saveEntry(db, coffee, {
      container_id: bean.container_id,
      payload: { grinder: '1Zpresso J', temp_c: 92, grind: 24, ratio: 15, rating: 4.5 },
    }, TUE);
    expect(src.summary_text).toBe('衣索比亞 水洗 耶加雪菲 · 1Zpresso J · 92°C · 24格 · 1:15 (★4.5)');
    const copy = await duplicateEntry(db, src.log_id, THU);
    expect(copy.log_id).not.toBe(src.log_id);
    expect(copy.local_date).toBe('2026-10-22');
    expect(copy.payload).toEqual(src.payload);
    expect(await timeline(db, coffee.habit_id)).toHaveLength(2);
  });
  it('日記沿用上次的文字模板', async () => {
    const diary = await habit('日記');
    expect(diary.last_state?.template).toBe(DIARY_DEFAULT_TEMPLATE);
    await saveEntry(db, diary, { container_id: null, payload: { values: {}, text: '【今日狀態】\nA\n【決策】\nB' } }, WED);
    expect((await habit('日記')).last_state?.template).toBe('【今日狀態】\nA\n【決策】\nB');
  });
  it('紀錄類不產生打卡', async () => {
    const diary = await habit('日記');
    await saveEntry(db, diary, { container_id: null, payload: { values: {}, text: 'x' } }, WED);
    expect(await getCheckin(db, diary.habit_id, '2026-10-21')).toBeUndefined();
  });
});

describe('同步欄位', () => {
  it('所有寫入都標記 dirty 並更新 updated_at', async () => {
    const gym = await habit('重訓');
    await quickCheckin(db, gym, WED);
    const ck = await getCheckin(db, gym.habit_id, '2026-10-21');
    expect(ck?.dirty).toBe(1);
    expect(ck?.updated_at).toBe(WED.getTime());
    expect(ck?.timestamp).toBe('2026-10-21T07:00:00+08:00');
  });
});
