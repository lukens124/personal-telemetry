import type {
  CoffeePayload,
  Container,
  GenericConfig,
  GenericPayload,
  Habit,
  ReadingPayload,
  WorkoutPayload,
} from '../data/types';

const SHORT_NAMES: Record<string, string> = { 六角槓RDL: 'RDL', '六角槓 RDL': 'RDL' };

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** 依引擎產生列表用的單行摘要 (存入 summary_text) */
export function summarize(habit: Habit, container: Container | null, payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  switch (habit.engine_type) {
    case 'WORKOUT': {
      const p = payload as unknown as WorkoutPayload;
      return p.exercises
        .filter((e) => e.sets.length > 0)
        .map((e) => {
          const name = SHORT_NAMES[e.name] ?? e.name;
          const done = e.sets.filter((s) => s.done !== false);
          if (done.length === 0) return `${name}(略)`;
          const max = Math.max(...done.map((s) => s.kg));
          const partial = done.length < e.sets.length ? `(${done.length}/${e.sets.length})` : '';
          return (max > 0 ? `${name}${max}` : name) + partial;
        })
        .join(' / ');
    }
    case 'COFFEE': {
      const p = payload as unknown as CoffeePayload;
      const recipe =
        p.dose_g != null && p.ratio == null
          ? [`${p.dose_g}g→${p.yield_g ?? '?'}g`, p.time_s != null ? `${p.time_s}s` : '']
          : [p.ratio != null ? `1:${p.ratio}` : ''];
      const parts = [container?.name, p.grinder, `${p.temp_c}°C`, `${p.grind}格`, ...recipe].filter(Boolean);
      return parts.join(' · ') + (p.rating != null ? ` (★${p.rating})` : '');
    }
    case 'READING': {
      const p = payload as unknown as ReadingPayload;
      return p.text.length > 24 ? p.text.slice(0, 24) + '…' : p.text;
    }
    case 'GENERIC': {
      const p = payload as unknown as GenericPayload;
      const cfg = habit.config as GenericConfig;
      const vals = cfg.fields
        .filter((f) => p.values?.[f.key] != null)
        .map((f) => {
          const v = p.values[f.key];
          return f.type === 'duration' ? fmtDuration(v) : `${v}${f.unit ?? ''}`;
        });
      const head = [container?.name, ...vals].filter(Boolean).join(' · ');
      const firstLine = (p.text ?? '').split('\n').find((l) => l.trim()) ?? '';
      return [head, firstLine.slice(0, 30)].filter(Boolean).join(' — ');
    }
  }
}
