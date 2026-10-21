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
    const bike = await habitBy(ipad, '騎車');
    const route = (await listContainers(ipad, bike.habit_id))[1];
    await saveEntry(ipad, bike, { container_id: route.container_id, payload: { values: { distance_km: 60, duration_min: 150 } } }, WED);
    // 手機改了重訓名稱 (較早)，iPad 也改 (較晚)
    const gymP = await habitBy(phone, '重訓');
    await updateHabit(phone, gymP.habit_id, { name: '重訓-手機' }, new Date('2026-10-21T08:00:00+08:00'));
    await updateHabit(ipad, gymP.habit_id, { name: '重訓-iPad' }, new Date('2026-10-21T09:00:00+08:00'));

    await syncNow(ipad, server.transport);
    await syncNow(phone, server.transport);

    // 手機收到 iPad 的騎車紀錄
    const phoneBikeLogs = (await phone.logs.toArray()).filter((l) => l.habit_id === bike.habit_id);
    expect(phoneBikeLogs.map((l) => l.summary_text)).toContain('巴拉卡公路 · 60km · 2h30m');
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
});
