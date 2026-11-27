/**
 * 資料遷移 (開機時執行，可重複執行)
 */
import type { TelemetryDB } from './db';
import type { CardioConfig, CardioPayload, GenericConfig, GenericPayload, Habit } from './types';
import { cardioSummary } from '../logic/cardio';

/** v4.2：舊的「騎車」(GENERIC：距離 + 時間) → 有氧模組 (CARDIO)，路線與紀錄全部保留 */
export async function migrateBikeToCardio(db: TelemetryDB, now = new Date()): Promise<number> {
  const t = now.getTime();
  const isOldBike = (h: Habit) => {
    if (h.deleted !== 0 || h.engine_type !== 'GENERIC') return false;
    const keys = ((h.config as GenericConfig).fields ?? []).map((f) => f.key);
    return keys.includes('distance_km') && keys.includes('duration_min');
  };
  const targets = (await db.habits.toArray()).filter(isOldBike);
  if (targets.length === 0) return 0;

  let n = 0;
  await db.transaction('rw', db.habits, db.logs, db.containers, async () => {
    for (const h of targets) {
      const label = (h.config as GenericConfig).container_label ?? '路線 / 主題';
      await db.habits.update(h.habit_id, {
        engine_type: 'CARDIO',
        name: h.name === '騎車' ? '有氧' : h.name,
        config: { container_label: label } satisfies CardioConfig,
        last_state: null,
        updated_at: t,
        dirty: 1,
      });
      const logs = await db.logs.where('[habit_id+kind]').equals([h.habit_id, 'ENTRY']).toArray();
      for (const l of logs) {
        const old = (l.payload ?? {}) as unknown as GenericPayload;
        const p: CardioPayload = {
          duration_min: old.values?.duration_min ?? 0,
          ...(old.values?.distance_km ? { distance_km: old.values.distance_km } : {}),
          ...(old.text?.trim() ? { note: old.text.trim() } : {}),
          source: 'MANUAL',
        };
        const route = l.container_id ? (await db.containers.get(l.container_id))?.name : null;
        await db.logs.update(l.log_id, {
          sub_mode: 'ROAD',
          payload: p as unknown as Record<string, unknown>,
          summary_text: cardioSummary('ROAD', route, p),
          updated_at: t,
          dirty: 1,
        });
        n++;
      }
    }
  });
  return n;
}

/**
 * 合併重複項目：同名、同引擎的習慣只留一個 (紀錄最多者)，其餘的紀錄、清單項目搬過去後標記刪除。
 * 用於兩台裝置各自建立了預設項目、第一次連到同一份雲端時。回傳被合併的習慣數。
 */
export async function dedupeHabits(db: TelemetryDB, now = new Date()): Promise<number> {
  const t = now.getTime();
  const touch = { updated_at: t, dirty: 1 as const };
  const habits = (await db.habits.toArray()).filter((h) => h.deleted === 0);
  const groups = new Map<string, Habit[]>();
  for (const h of habits) {
    const k = `${h.name}|${h.engine_type}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  }

  let merged = 0;
  await db.transaction('rw', db.habits, db.containers, db.logs, async () => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const entryCount = async (h: Habit) =>
        (await db.logs.where('[habit_id+kind]').equals([h.habit_id, 'ENTRY']).toArray()).filter((l) => l.deleted === 0).length;
      const counts = await Promise.all(group.map(entryCount));
      const order = group.map((h, i) => ({ h, n: counts[i] })).sort((a, b) => b.n - a.n || a.h.created_at - b.h.created_at);
      const keeper = order[0].h;

      for (const { h: dup } of order.slice(1)) {
        // 清單項目：同名合併，不同名搬過去
        const keepC = (await db.containers.where('habit_id').equals(keeper.habit_id).toArray()).filter((c) => c.deleted === 0);
        const usedDays = new Set(keepC.flatMap((c) => c.bound_weekdays));
        const cmap = new Map<string, string>();
        for (const c of (await db.containers.where('habit_id').equals(dup.habit_id).toArray()).filter((x) => x.deleted === 0)) {
          const same = keepC.find((k) => k.name === c.name);
          if (same) {
            cmap.set(c.container_id, same.container_id);
            await db.containers.update(c.container_id, { deleted: 1, ...touch });
          } else {
            await db.containers.update(c.container_id, {
              habit_id: keeper.habit_id,
              bound_weekdays: c.bound_weekdays.filter((d) => !usedDays.has(d)),
              ...touch,
            });
          }
        }
        // 紀錄
        for (const l of (await db.logs.where('habit_id').equals(dup.habit_id).toArray()).filter((x) => x.deleted === 0)) {
          if (l.kind === 'CHECKIN') {
            const newId = `ck_${keeper.habit_id}_${l.local_date}`;
            const existing = await db.logs.get(newId);
            if (!existing || existing.deleted === 1) {
              await db.logs.put({ ...l, ...touch, log_id: newId, habit_id: keeper.habit_id, deleted: 0, created_at: existing?.created_at ?? l.created_at });
            } else if (existing.visual_flag !== 1 && l.visual_flag === 1) {
              await db.logs.update(newId, { visual_flag: 1, ...touch });
            }
            await db.logs.update(l.log_id, { deleted: 1, ...touch });
          } else {
            await db.logs.update(l.log_id, {
              habit_id: keeper.habit_id,
              container_id: l.container_id ? (cmap.get(l.container_id) ?? l.container_id) : null,
              ...touch,
            });
          }
        }
        await db.habits.update(dup.habit_id, { deleted: 1, ...touch });
        merged++;
      }
    }
  });
  return merged;
}
