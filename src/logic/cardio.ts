import { weekDates } from '../data/dates';
import { CARDIO_SPORT_LABEL, type CardioPayload, type CardioSport, type HabitLog, type LocalDate } from '../data/types';

export function fmtDuration(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** 配速 (秒/公里)；沒有距離時為 null */
export function paceSec(p: Pick<CardioPayload, 'duration_min' | 'distance_km'>): number | null {
  if (!p.distance_km || p.distance_km <= 0 || !p.duration_min) return null;
  return Math.round((p.duration_min * 60) / p.distance_km);
}

export function fmtPace(sec: number | null): string {
  if (sec == null) return '';
  return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}"`;
}

/** 列表摘要：公路車 · 巴拉卡公路 · 2h35m · 62.5km · ♥142 */
export function cardioSummary(sport: CardioSport, route: string | null | undefined, p: CardioPayload): string {
  const label = sport === 'OTHER' && p.hk_type ? p.hk_type : CARDIO_SPORT_LABEL[sport];
  const parts: string[] = [label];
  if (route) parts.push(route);
  if (p.duration_min) parts.push(fmtDuration(p.duration_min));
  if (p.distance_km) parts.push(`${Math.round(p.distance_km * 10) / 10}km`);
  if (sport === 'RUN') {
    const pace = fmtPace(paceSec(p));
    if (pace) parts.push(`${pace}/km`);
  }
  if (sport === 'INDOOR' && p.power_w) parts.push(`${p.power_w}W`);
  if (p.avg_hr) parts.push(`♥${p.avg_hr}`);
  return parts.join(' · ');
}

/**
 * 健康 App 運動名稱 → 分類。中英文都接受 (iPhone 語言設定不同時名稱不同)。
 * 騎乘沒有距離 = 室內台。
 */
export function classifyHealthWorkout(name: string, distanceKm: number | null | undefined): CardioSport | 'STRENGTH' {
  const n = (name || '').toLowerCase();
  if (/strength|肌力|重量訓練|functional|功能性/.test(n)) return 'STRENGTH';
  if (/cycl|bik|騎|單車|自行車/.test(n)) return /indoor|室內/.test(n) || !distanceKm || distanceKm < 0.1 ? 'INDOOR' : 'ROAD';
  if (/run|跑/.test(n)) return 'RUN';
  return 'OTHER';
}

export interface CardioWeek {
  minutes: number;
  km: number;
  kcal: number;
  count: number;
}

/** 本週 (週一起) 有氧累計 */
export function cardioWeek(entries: HabitLog[], today: LocalDate): CardioWeek {
  const days = new Set(weekDates(today));
  const w: CardioWeek = { minutes: 0, km: 0, kcal: 0, count: 0 };
  for (const e of entries) {
    if (e.kind !== 'ENTRY' || e.deleted !== 0 || !days.has(e.local_date)) continue;
    const p = e.payload as unknown as CardioPayload | null;
    if (!p) continue;
    w.minutes += p.duration_min || 0;
    w.km += p.distance_km || 0;
    w.kcal += p.kcal || 0;
    w.count++;
  }
  w.km = Math.round(w.km * 10) / 10;
  w.minutes = Math.round(w.minutes);
  w.kcal = Math.round(w.kcal);
  return w;
}
