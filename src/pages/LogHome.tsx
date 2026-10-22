/**
 * Page 1.0-B 紀錄視角首頁：隨機知識喚醒、分類標籤列、時間軸 (單擊編輯 / 右滑複製到今天)
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'preact/hooks';
import { isoWeekday, WEEKDAY_LABELS } from '../data/dates';
import { db } from '../data/db';
import { duplicateEntry, listHabits, randomRecall, timeline } from '../data/repo';
import type { Container, Habit, HabitLog, ReadingPayload } from '../data/types';
import { shortDate, useNav, useRowGesture } from '../ui/kit';
import { benchRoute } from '../ui/routes';
import { TopActions } from '../ui/TopActions';

const PAGE = 80;
const MODE_TAG: Record<string, string> = { POUR_OVER: '手沖', ESPRESSO: '義式', MAIN: '主訓', DELOAD: '減載' };

export function LogHome() {
  const nav = useNav();
  const [filter, setFilter] = useState<string | null>(null);
  const [recallSeed, setRecallSeed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [menu, setMenu] = useState(false);

  const data = useLiveQuery(async () => {
    const habits = await listHabits(db);
    const visible = habits.filter((h) => h.category_tab === 'LOG' || h.engine_type === 'READING');
    const logs = await timeline(db, filter ?? undefined);
    const containers = await db.containers.toArray();
    return { habits, visible, logs, containers: new Map(containers.map((c) => [c.container_id, c])) };
  }, [filter]);

  const recall = useLiveQuery(() => randomRecall(db), [recallSeed]);

  if (!data) return <main class="screen" />;

  const habitOf = (id: string) => data.habits.find((h) => h.habit_id === id);
  const shown = data.logs.slice(0, limit);
  const groups = new Map<string, HabitLog[]>();
  for (const l of shown) groups.set(l.local_date, [...(groups.get(l.local_date) ?? []), l]);

  const add = () => {
    const h = filter ? habitOf(filter) : undefined;
    if (h) nav.go(benchRoute(h));
    else setMenu(true);
  };

  const rp = recall?.payload as unknown as ReadingPayload | undefined;
  const tapRecall = () => {
    if (rp?.example && !expanded) return setExpanded(true);
    setExpanded(false);
    setRecallSeed((n) => n + 1);
  };
  const recallSource = recall?.container_id ? data.containers.get(recall.container_id)?.name : habitOf(recall?.habit_id ?? '')?.name;

  return (
    <main class="screen">
      <header class="topbar">
        <h1>紀錄</h1>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <button class="icon-btn primary" onClick={add}>＋ 新增</button>
          <TopActions />
        </span>
      </header>

      <button class="card" style={{ width: '100%', textAlign: 'left', display: 'block' }} onClick={tapRecall}
        aria-label={rp?.example && !expanded ? '展開補充語境' : '換一則'}>
        <span class="field-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>💡 隨機喚醒{recallSource ? `（${recallSource}）` : ''}</span>
          <span>↻</span>
        </span>
        <span style={{ fontSize: '17px', display: 'block' }}>
          {rp ? `「${rp.text}」` : '新增閱讀或英文筆記後，這裡會隨機抽一則讓你複習。'}
        </span>
        {rp?.example && expanded && <span class="field-label" style={{ display: 'block', marginTop: '6px' }}>{rp.example}</span>}
        {rp && <span class="field-label" style={{ display: 'block', marginTop: '6px', fontSize: '12px' }}>
          {rp.example && !expanded ? '點一下看補充語境' : '點一下換一則'}
        </span>}
      </button>

      <div class="chips" style={{ marginTop: '14px' }}>
        <button class="chip" aria-pressed={filter === null} onClick={() => { setFilter(null); setLimit(PAGE); }}>全部</button>
        {data.visible.map((h) => (
          <button class="chip" aria-pressed={filter === h.habit_id} onClick={() => { setFilter(h.habit_id); setLimit(PAGE); }}>
            {h.icon}{h.name}
          </button>
        ))}
        <button class="chip" onClick={() => nav.newHabit('LOG')}>＋ 新分類</button>
      </div>

      {data.logs.length === 0 && <div class="empty" style={{ marginTop: '16px' }}>還沒有紀錄，按右上角「＋ 新增」開始。</div>}
      {[...groups.entries()].map(([date, logs]) => (
        <>
          <div class="section-title">
            <span>{shortDate(date)} ({WEEKDAY_LABELS[isoWeekday(date) - 1]})</span>
          </div>
          <div>
            {logs.map((l) => (
              <TimelineRow key={l.log_id} log={l} habit={habitOf(l.habit_id)} container={l.container_id ? data.containers.get(l.container_id) : undefined} />
            ))}
          </div>
        </>
      ))}
      {data.logs.length > limit && (
        <div class="btn-row" style={{ justifyContent: 'center' }}>
          <button class="link-btn" onClick={() => setLimit((n) => n + PAGE)}>顯示更多</button>
        </div>
      )}
      {data.logs.length > 0 && <p class="hint">單擊編輯 · 右滑複製到今天</p>}

      {menu && (
        <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div class="sheet" role="dialog" aria-modal="true" aria-label="新增紀錄">
            <header class="topbar">
              <h1 style={{ fontSize: '18px' }}>新增紀錄</h1>
              <button class="icon-btn" onClick={() => setMenu(false)}>✕ 關閉</button>
            </header>
            <div class="menu-list">
              {data.visible.map((h) => (
                <button onClick={() => { setMenu(false); nav.go(benchRoute(h)); }}>{h.icon} {h.name}</button>
              ))}
              <button style={{ color: 'var(--done)' }} onClick={() => { setMenu(false); nav.newHabit('LOG'); }}>＋ 新分類</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TimelineRow({ log, habit, container }: { log: HabitLog; habit: Habit | undefined; container: Container | undefined }) {
  const nav = useNav();
  const g = useRowGesture({
    onTap: () => habit && nav.go(benchRoute(habit, log.log_id)),
    onSwipeRight: async () => {
      await duplicateEntry(db, log.log_id, new Date());
      nav.toast('已複製一筆到今天');
    },
  });
  const time = log.timestamp.slice(11, 16);
  const tag = log.sub_mode ? MODE_TAG[log.sub_mode] : habit?.engine_type === 'READING' ? container?.name : undefined;
  return (
    <div class="tl-wrap">
      <div class="behind" aria-hidden="true">⧉ 複製到今天</div>
      <div ref={g.ref} class={`tl-row${g.dragging ? ' dragging' : ''}`} style={{ transform: `translateX(${g.dx}px)` }} {...g.bind}>
        <span>{habit?.icon}</span>
        <span>
          {tag && <span class="tag">{tag}</span>}
          {log.summary_text || '（無內容）'}
        </span>
        <span class="time">{time}</span>
      </div>
    </div>
  );
}
