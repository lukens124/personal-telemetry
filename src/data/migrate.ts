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
