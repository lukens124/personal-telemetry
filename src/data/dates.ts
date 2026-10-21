import type { IsoWeekday, LocalDate } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Date → 使用者本地日期 YYYY-MM-DD */
export function toLocalDate(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date → 帶時區偏移的 ISO 字串，例如 2026-10-21T15:20:00+08:00 */
export function toIsoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${toLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** 以 UTC 解析日期字串，避免時區影響星期計算 */
function parse(ld: LocalDate): Date {
  const [y, m, d] = ld.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(d: Date): LocalDate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** ISO 星期：1 = 週一 … 7 = 週日 */
export function isoWeekday(ld: LocalDate): IsoWeekday {
  const js = parse(ld).getUTCDay(); // 0 = 週日
  return (js === 0 ? 7 : js) as IsoWeekday;
}

export function addDays(ld: LocalDate, n: number): LocalDate {
  const d = parse(ld);
  d.setUTCDate(d.getUTCDate() + n);
  return format(d);
}

/** 該日所在週 (週一起算) 的七天 */
export function weekDates(ld: LocalDate): LocalDate[] {
  const monday = addDays(ld, 1 - isoWeekday(ld));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
