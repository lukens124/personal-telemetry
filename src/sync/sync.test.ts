/**
 * 端對端：真的執行 gas/Code.gs (以模擬的 SpreadsheetApp 等服務)，兩台裝置透過它同步。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDB, type TelemetryDB } from '../data/db';
import { listContainers, listHabits, quickCheckin, saveEntry, updateHabit } from '../data/repo';
import { seedIfEmpty } from '../data/seed';
import type { Habit } from '../data/types';
import { exportJson, pendingCount, setConfig, syncNow, type ServerResponse, type Transport } from './sync';

// ---------------------------------------------------------------- 模擬 Google 服務

class FakeSheet {
  data: unknown[][] = [];
  maxRows = 1000;
  frozen = 0;
  constructor(public name: string) {}
  getLastRow() {
    return this.data.length;
  }
  getMaxRows() {
    return this.maxRows;
  }
  insertRowsAfter(_after: number, n: number) {
    this.maxRows += n;
  }
  setFrozenRows(n: number) {
    this.frozen = n;
  }
  getRange(r: number, c: number, nr: number, nc: number) {
    const self = this;
    if (r + nr - 1 > this.maxRows) throw new Error('range outside sheet');
    return {
      getValues: () =>
        Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => self.data[r - 1 + i]?.[c - 1 + j] ?? ''),
        ),
      setValues: (m: unknown[][]) => {
        m.forEach((row, i) => {
          const rr = (self.data[r - 1 + i] ??= []);
          row.forEach((v, j) => {
            // 模擬 Sheets：以 ' 開頭的文字存成去掉 ' 的字串
            rr[c - 1 + j] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
          });
        });
        for (let i = 0; i < self.data.length; i++) self.data[i] ??= [];
      },
      setNumberFormat: () => undefined,
    };
  }
}

function loadGas() {
  const sheets = new Map<string, FakeSheet>();
  const props = new Map<string, string>();
  const globals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n: string) => sheets.get(n) ?? null,
        insertSheet: (n: string) => {
          const s = new FakeSheet(n);
          sheets.set(n, s);
          return s;
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => props.set(k, v),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => undefined, releaseLock: () => undefined }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s: string) => ({ setMimeType: () => ({ content: s }) }),
    },
    Utilities: { getUuid: () => '1234-abcd-5678-ef90' },
    Logger: { log: () => undefined },
  };
  const src = readFileSync(resolve(__dirname, '../../gas/Code.gs'), 'utf8');
  const factory = new Function(...Object.keys(globals), `${src}\nreturn { setup, doPost };`);
  const gas = factory(...Object.values(globals)) as {
    setup: () => string;
    doPost: (e: { postData: { contents: string } }) => { content: string };
  };
  const token = gas.setup();
  let clock = 1_000_000;
  const transport: Transport = async (_url, body) => {
    const realNow = Date.now;
    Date.now = () => (clock += 1000); // 伺服器時間遞增
    try {
      return JSON.parse(gas.doPost({ postData: { contents: body } }).content) as ServerResponse;
    } finally {
      Date.now = realNow;
    }
  };
  return { token, transport, sheets };
}

// ---------------------------------------------------------------- 測試

let n = 0;
const newDb = () => createDB(`sync-${n++}`);
const habitBy = async (db: TelemetryDB, name: string) => (await listHabits(db)).find((h) => h.name === name) as Habit;
const TUE = new Date('2026-10-20T07:00:00+08:00');
const WED = new Date('2026-10-21T07:00:00+08:00');

let server: ReturnType<typeof loadGas>;
let phone: TelemetryDB;

beforeEach(async () => {
  server = loadGas();
  phone = newDb();
  await seedIfEmpty(phone, TUE);
  await setConfig(phone, { url: 'https://script.example/exec', token: server.token });
});

describe('同步', () => {
  it('未設定時不動作', async () => {
    const db = newDb();
    expect((await syncNow(db, server.transport)).status).toBe('NOT_CONFIGURED');
  });

  it('Token 錯誤會回報錯誤', async () => {
    await setConfig(phone, { url: 'x', token: 'wrong' });
    const r = await syncNow(phone, server.transport);
    expect(r).toEqual({ status: 'ERROR', error: 'Token 不正確' });
  });

  it('首次同步把全部資料推上雲端，並清除 dirty', async () => {
    const gym = await habitBy(phone, '重訓');
    await quickCheckin(phone, gym, TUE);
    const r = await syncNow(phone, server.transport);
    expect(r.status).toBe('OK');
    expect(await pendingCount(phone)).toBe(0);
    expect(server.sheets.get('Habits')!.data.length - 1).toBe(6);
    expect(server.sheets.get('Habit_Logs')!.data.length - 1).toBe(2); // 打卡 + 自動建立的重訓紀錄
    // 試算表可讀：local_date 為文字欄、payload 為 JSON 文字
    const header = server.sheets.get('Habit_Logs')!.data[0] as string[];
    const row = server.sheets.get('Habit_Logs')!.data[1];
    expect(row[header.indexOf('local_date')]).toBe('2026-10-20');
  });

  it('新裝置首次同步：以雲端資料還原，不會重複預設樣板', async () => {
    const gym = await habitBy(phone, '重訓');
    await quickCheckin(phone, gym, TUE);
    await syncNow(phone, server.transport);

    const ipad = newDb();
    await seedIfEmpty(ipad, WED); // 新裝置也會先建立自己的樣板
    await setConfig(ipad, { url: 'x', token: server.token });
    const r = await syncNow(ipad, server.transport);
    expect(r.status === 'OK' && r.restored).toBe(true);
    expect((await listHabits(ipad)).length).toBe(6);
    expect((await ipad.logs.toArray()).length).toBe(2);
    expect(await pendingCount(ipad)).toBe(0);
  });

  it('兩台裝置雙向同步，並以較新的修改為準', async () => {
    await syncNow(phone, server.transport);
    const ipad = newDb();
    await setConfig(ipad, { url: 'x', token: server.token });
    await syncNow(ipad, server.transport);

    // iPad 記一筆騎車
    const bike = await habitBy(ipad, '有氧');
    const route = (await listContainers(ipad, bike.habit_id))[1];
    await saveEntry(ipad, bike, { container_id: route.container_id, sub_mode: 'ROAD', payload: { duration_min: 150, distance_km: 60, source: 'MANUAL' } }, WED);
    // 手機改了重訓名稱 (較早)，iPad 也改 (較晚)
    const gymP = await habitBy(phone, '重訓');
    await updateHabit(phone, gymP.habit_id, { name: '重訓-手機' }, new Date('2026-10-21T08:00:00+08:00'));
    await updateHabit(ipad, gymP.habit_id, { name: '重訓-iPad' }, new Date('2026-10-21T09:00:00+08:00'));

    await syncNow(ipad, server.transport);
    await syncNow(phone, server.transport);

    // 手機收到 iPad 的騎車紀錄
    const phoneBikeLogs = (await phone.logs.toArray()).filter((l) => l.habit_id === bike.habit_id);
    expect(phoneBikeLogs.map((l) => l.summary_text)).toContain('公路車 · 巴拉卡公路 · 2h30m · 60km');
    // 名稱以較晚的 iPad 為準
    expect((await phone.habits.get(gymP.habit_id))?.name).toBe('重訓-iPad');
    await syncNow(ipad, server.transport);
    expect((await ipad.habits.get(gymP.habit_id))?.name).toBe('重訓-iPad');
    expect(await pendingCount(phone)).toBe(0);
  });

  it('增量同步：沒有變動時不重複下載', async () => {
    await syncNow(phone, server.transport);
    const r = await syncNow(phone, server.transport);
    expect(r).toEqual({ status: 'OK', pushed: 0, pulled: 0, restored: false });
  });

  it('JSON、以 = 開頭的文字與 null 欄位來回不失真', async () => {
    const diary = await habitBy(phone, '日記');
    const e = await saveEntry(phone, diary, { container_id: null, payload: { values: {}, text: '=今天\n第二行' } }, WED);
    await syncNow(phone, server.transport);
    const ipad = newDb();
    await setConfig(ipad, { url: 'x', token: server.token });
    await syncNow(ipad, server.transport);
    const got = await ipad.logs.get(e.log_id);
    expect(got?.payload).toEqual({ values: {}, text: '=今天\n第二行' });
    expect(got?.summary_text).toBe('=今天');
    expect(got?.container_id).toBeNull();
    expect(got?.visual_flag).toBeNull();
  });

  it('匯出 JSON 包含三張表', async () => {
    const data = JSON.parse(await exportJson(phone));
    expect(data.habits).toHaveLength(6);
    expect(data.schema).toBe('4.1');
  });

  describe('Apple 健康匯入', () => {
    const post = async (body: Record<string, unknown>) =>
      (await server.transport('x', JSON.stringify({ token: server.token, action: 'health_workout', ...body }))) as unknown as Record<string, unknown>;

    it('騎車：寫入有氧紀錄、自動打卡、同步到手機；重送不重複', async () => {
      await syncNow(phone, server.transport); // 雲端要先有「有氧」項目
      const ride = { type: '騎自行車', start: '2026-11-26T07:05:12+08:00', end: '2026-11-26T08:53:12+08:00', distance_km: '45.36 km', kcal: '1,012', avg_hr: '138.6', max_hr: 171 };
      const r = await post(ride);
      expect(r).toMatchObject({ ok: true, status: 'IMPORTED', category: 'ROAD', summary: '公路車 · 1h48m · 45.4km · ♥139' });
      expect(await post(ride)).toMatchObject({ ok: true, status: 'DUPLICATE' });

      await syncNow(phone, server.transport);
      const cardio = await habitBy(phone, '有氧');
      const logs = (await phone.logs.toArray()).filter((l) => l.habit_id === cardio.habit_id && l.deleted === 0);
      const entry = logs.find((l) => l.kind === 'ENTRY')!;
      expect(entry).toMatchObject({ sub_mode: 'ROAD', local_date: '2026-11-26', timestamp: '2026-11-26T07:05:12+08:00', dirty: 0 });
      expect(entry.payload).toEqual({ duration_min: 108, distance_km: 45.36, kcal: 1012, avg_hr: 139, max_hr: 171, source: 'HEALTH' });
      // App 端的摘要格式與雲端一致
      const { cardioSummary } = await import('../logic/cardio');
      expect(entry.summary_text).toBe(cardioSummary('ROAD', null, entry.payload as never));
      expect(logs.find((l) => l.kind === 'CHECKIN')?.visual_flag).toBe(1);
    });

    it('室內台沒有距離；肌力訓練掛在重訓並打卡', async () => {
      await syncNow(phone, server.transport);
      expect(await post({ type: 'Indoor Cycling', start: '2026-11-25T20:00:00+08:00', end: '2026-11-25T21:00:00+08:00', kcal: 600 }))
        .toMatchObject({ category: 'INDOOR', summary: '室內台 · 1h00m' });
      expect(await post({ type: 'Traditional Strength Training', start: '2026-11-24T19:00:00+08:00', end: '2026-11-24T19:52:00+08:00', kcal: 310, avg_hr: 128 }))
        .toMatchObject({ category: 'STRENGTH', summary: '⌚ 52m · 310 kcal · ♥128' });

      await syncNow(phone, server.transport);
      const gym = await habitBy(phone, '重訓');
      const health = (await phone.logs.toArray()).find((l) => l.habit_id === gym.habit_id && l.kind === 'HEALTH')!;
      expect(health.payload).toMatchObject({ duration_min: 52, kcal: 310, avg_hr: 128 });
      const ck = (await phone.logs.toArray()).find((l) => l.log_id === `ck_${gym.habit_id}_2026-11-24`);
      expect(ck?.visual_flag).toBe(1);
      // 肌力數據不算重訓紀錄 (不推進 N:M)
      expect((await phone.logs.toArray()).filter((l) => l.habit_id === gym.habit_id && l.kind === 'ENTRY')).toHaveLength(0);
    });

    it('格式錯誤與未同步時回報清楚的錯誤', async () => {
      expect(await post({ type: 'Running', start: '昨天', end: '' })).toMatchObject({ ok: false, error: 'BAD_START' });
      expect(await post({ type: 'Running', start: '2026-11-26T07:00:00+08:00' })).toMatchObject({ ok: false, error: 'BAD_DURATION' });
      expect(await post({ type: 'Running', start: '2026-11-26T07:00:00+08:00', duration_min: 30 })).toMatchObject({ ok: false, error: 'NO_HABIT' });
    });
  });

  describe('兩台裝置各自建立過預設項目 (首次連線合併)', () => {
    it('合併同名項目、保留兩邊紀錄、舊騎車轉有氧，其他裝置也一致', async () => {
      // 電腦：舊版 (騎車為 GENERIC) + 一筆英文語塊，先連上雲端
      const pc = newDb();
      await seedIfEmpty(pc, TUE);
      const pcCardio = await habitBy(pc, '有氧');
      await pc.habits.update(pcCardio.habit_id, {
        name: '騎車', engine_type: 'GENERIC',
        config: { fields: [{ key: 'distance_km', label: '距離', type: 'number' }, { key: 'duration_min', label: '時間', type: 'duration' }], has_text: true, container_label: '路線 / 主題' },
      });
      const pcEng = await habitBy(pc, '英文語塊');
      const chunk = (await listContainers(pc, pcEng.habit_id))[0];
      const note = await saveEntry(pc, pcEng, { container_id: chunk.container_id, payload: { nature: 'CHUNK', text: 'I have an apple' } }, TUE);
      const fresh = loadGas();
      await setConfig(pc, { url: 'x', token: fresh.token });
      await syncNow(pc, fresh.transport);

      // 手機：另一套預設項目 + 自己的紀錄，從沒連過
      const ph = newDb();
      await seedIfEmpty(ph, WED);
      const phGym = await habitBy(ph, '重訓');
      await quickCheckin(ph, phGym, WED);
      const phEng = await habitBy(ph, '英文語塊');
      await quickCheckin(ph, phEng, TUE); // 同一天兩邊都有英文打卡
      await setConfig(ph, { url: 'x', token: fresh.token });
      expect((await syncNow(ph, fresh.transport)).status).toBe('OK');

      const alive = async (db: TelemetryDB) => (await db.habits.toArray()).filter((h) => h.deleted === 0).map((h) => h.name).sort();
      const SIX = ['咖啡', '日記', '有氧', '英文語塊', '重訓', '閱讀與筆記'].sort();
      expect(await alive(ph)).toEqual(SIX);

      // 英文筆記掛在合併後唯一的英文語塊、唯一的「日常語塊」底下
      const eng = await habitBy(ph, '英文語塊');
      const moved = await ph.logs.get(note.log_id);
      expect(moved?.habit_id).toBe(eng.habit_id);
      expect((await listContainers(ph, eng.habit_id)).map((c) => c.name)).toEqual(['日常語塊']);
      expect(moved?.container_id).toBe((await listContainers(ph, eng.habit_id))[0].container_id);
      // 同一天的打卡只剩一筆
      const engCk = (await ph.logs.toArray()).filter((l) => l.kind === 'CHECKIN' && l.habit_id === eng.habit_id && l.deleted === 0 && l.local_date === '2026-10-20');
      expect(engCk).toHaveLength(1);
      // 重訓課表沒有重複，星期綁定不變
      const courses = await listContainers(ph, (await habitBy(ph, '重訓')).habit_id);
      expect(courses.map((c) => [c.name, c.bound_weekdays])).toEqual([['背腹菜單', [1]], ['腿日菜單', [2]], ['胸肩腹菜單', [3]]]);
      expect(await pendingCount(ph)).toBe(0);

      // 雲端與其他裝置一致
      await syncNow(pc, fresh.transport);
      expect(await alive(pc)).toEqual(SIX);
      expect((await pc.logs.get(note.log_id))?.habit_id).toBe(eng.habit_id);
      const ipad = newDb();
      await setConfig(ipad, { url: 'x', token: fresh.token });
      await syncNow(ipad, fresh.transport);
      expect(await alive(ipad)).toEqual(SIX);
      expect((await ipad.logs.toArray()).filter((l) => l.kind === 'ENTRY' && l.deleted === 0).map((l) => l.summary_text)).toContain('I have an apple');

      // 再同步一次：沒有新的合併、沒有殘留待上傳
      const again = await syncNow(ph, fresh.transport);
      expect(again).toMatchObject({ status: 'OK', pushed: 0 });
    });
  });
});
