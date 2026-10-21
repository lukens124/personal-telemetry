/**
 * 1.0-B 紀錄首頁 — P2 先提供時間軸與隨機喚醒的基本版，P3 補上咖啡工作台、右滑複製與自建分類。
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'preact/hooks';
import { isoWeekday, WEEKDAY_LABELS } from '../data/dates';
import { db } from '../data/db';
import { listHabits, randomRecall, timeline } from '../data/repo';
import type { HabitLog, ReadingPayload } from '../data/types';
import { shortDate, useNav } from '../ui/kit';
import { TopActions } from '../ui/TopActions';

export function LogHome() {
  const nav = useNav();
  const [filter, setFilter] = useState<string | null>(null);
  const [recallSeed, setRecallSeed] = useState(0);

  const data = useLiveQuery(async () => {
    const habits = await listHabits(db);
    const visible = habits.filter((h) => h.category_tab === 'LOG' || h.engine_type === 'READING');
    const logs = await timeline(db, filter ?? undefined);
    return { habits, visible, logs };
  }, [filter]);

  const recall = useLiveQuery(() => randomRecall(db), [recallSeed]);

  if (!data) return <main class="screen" />;

  const groups = new Map<string, HabitLog[]>();
  for (const l of data.logs) groups.set(l.local_date, [...(groups.get(l.local_date) ?? []), l]);
  const habitOf = (id: string) => data.habits.find((h) => h.habit_id === id);

  const open = (l: HabitLog) => {
    const h = habitOf(l.habit_id);
    if (!h) return;
    if (h.engine_type === 'COFFEE') return nav.toast('咖啡工作台在下一階段推出');
    nav.go({ name: 'simple', habitId: h.habit_id, entryId: l.log_id });
  };

  const add = () => {
    const h = filter ? habitOf(filter) : data.visible.find((x) => x.engine_type === 'GENERIC' && x.category_tab === 'LOG');
    if (!h) return;
    if (h.engine_type === 'COFFEE') return nav.toast('咖啡工作台在下一階段推出');
    nav.go({ name: 'simple', habitId: h.habit_id });
  };

  const rp = recall?.payload as unknown as ReadingPayload | undefined;

  return (
    <main class="screen">
      <header class="topbar">
        <h1>紀錄</h1>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <button class="icon-btn primary" onClick={add}>＋ 新增</button>
          <TopActions />
        </span>
      </header>

      <button class="card" style={{ width: '100%', textAlign: 'left', display: 'block' }}
        onClick={() => setRecallSeed((n) => n + 1)} aria-label="隨機知識喚醒，點擊換一則">
        <span class="field-label">💡 隨機喚醒 {recall ? `· ${habitOf(recall.habit_id)?.name ?? ''}` : ''} ↻</span>
        <span style={{ fontSize: '17px' }}>
          {rp ? `「${rp.text}」` : '新增閱讀或英文筆記後，這裡會隨機抽一則讓你複習。'}
        </span>
        {rp?.example && <span class="field-label" style={{ display: 'block', marginTop: '6px' }}>{rp.example}</span>}
      </button>

      <div class="chips" style={{ marginTop: '14px' }}>
        <button class="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>全部</button>
        {data.visible.map((h) => (
          <button class="chip" aria-pressed={filter === h.habit_id} onClick={() => setFilter(h.habit_id)}>
            {h.icon}{h.name}
          </button>
        ))}
      </div>

      {data.logs.length === 0 && <div class="empty" style={{ marginTop: '16px' }}>還沒有紀錄，按右上角「＋ 新增」開始。</div>}
      {[...groups.entries()].map(([date, logs]) => (
        <>
          <div class="section-title">
            <span>{shortDate(date)} ({WEEKDAY_LABELS[isoWeekday(date) - 1]})</span>
          </div>
          <ul class="history">
            {logs.map((l) => {
              const h = habitOf(l.habit_id);
              return (
                <li>
                  <button onClick={() => open(l)} style={{ gridTemplateColumns: '1.6em 1fr' }}>
                    <span>{h?.icon}</span>
                    <span>{l.summary_text || '（無內容）'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ))}
    </main>
  );
}
