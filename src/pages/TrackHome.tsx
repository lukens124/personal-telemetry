import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'preact/hooks';
import { isoWeekday, toLocalDate, WEEKDAY_LABELS } from '../data/dates';
import { db } from '../data/db';
import {
  findBoundContainer,
  listContainers,
  listEntries,
  listHabits,
  quickCheckin,
  toggleSkip,
  trackDashboard,
  workoutCycle,
} from '../data/repo';
import { FLAG_DONE, FLAG_SKIP, type Habit, type HabitLog } from '../data/types';
import type { WeekRow } from '../logic/grid';
import { summarize } from '../logic/summary';
import { haptic, useNav, useRowGesture } from '../ui/kit';

/** 跨午夜或從背景回來時刷新「今天」 */
export function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

interface ItemView {
  habit: Habit;
  checkin: HabitLog | undefined;
  row: WeekRow;
  detail: string;
  badge?: string;
}

async function describe(habit: Habit, now: Date): Promise<{ detail: string; badge?: string }> {
  const today = toLocalDate(now);
  const entries = await listEntries(db, habit.habit_id);
  const todays = entries.find((e) => e.local_date === today);

  switch (habit.engine_type) {
    case 'WORKOUT': {
      const cyc = await workoutCycle(db, habit);
      const badge = cyc.suggested === 'MAIN' ? `🔥主訓 ${cyc.position}/${cyc.of}` : `🔋減載 ${cyc.position}/${cyc.of}`;
      if (todays) {
        const c = todays.container_id ? await db.containers.get(todays.container_id) : null;
        return { detail: `今日：${c?.name ?? ''} ${todays.summary_text}`.trim(), badge };
      }
      const wd = isoWeekday(today);
      const bound = await findBoundContainer(db, habit.habit_id, wd);
      if (!bound) return { detail: '今天沒有綁定課表，點右側選擇', badge };
      const payload = bound.last_payload ?? bound.default_payload;
      const sum = summarize(habit, bound, payload);
      return { detail: `週${WEEKDAY_LABELS[wd - 1]}綁定：${bound.name}${sum ? ` (${sum})` : ''}`, badge };
    }
    case 'READING': {
      if (todays) return { detail: `今日：${todays.summary_text}` };
      const active = (await listContainers(db, habit.habit_id))[0];
      return { detail: active ? `進行中：${active.name}` : '點右側新增書籍或來源' };
    }
    default: {
      if (todays) return { detail: `今日：${todays.summary_text}` };
      const last = entries[0];
      return { detail: last ? `上次：${last.summary_text}` : '點右側新增紀錄' };
    }
  }
}

export function TrackHome() {
  const now = useToday();
  const todayKey = toLocalDate(now);

  const data = useLiveQuery(async () => {
    const { rows, today } = await trackDashboard(db, now);
    const inList = new Set(today.map((t) => t.habit.habit_id));
    const all = await listHabits(db, 'TRACK');
    const toView = async (habit: Habit, checkin: HabitLog | undefined, row: WeekRow): Promise<ItemView> => ({
      habit,
      checkin,
      row,
      ...(await describe(habit, now)),
    });
    const items = await Promise.all(today.map((t) => toView(t.habit, t.checkin, t.row)));
    const others = await Promise.all(
      all
        .filter((h) => !inList.has(h.habit_id))
        .map((h) => toView(h, undefined, rows.find((r) => r.habit_id === h.habit_id)!)),
    );
    return { rows, items, others, habits: all };
  }, [todayKey]);

  const [showOthers, setShowOthers] = useState(false);

  if (!data) return <main class="screen" />;

  const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日 (${WEEKDAY_LABELS[isoWeekday(todayKey) - 1]})`;
  const todayIdx = isoWeekday(todayKey) - 1;

  return (
    <main class="screen">
      <header class="topbar">
        <h1>{dateLabel}</h1>
        <span class="sub">本週</span>
      </header>

      <section class="grid" aria-label="本週習慣網格">
        <div class="grid-head">
          <div>項目</div>
          {WEEKDAY_LABELS.map((l, i) => (
            <div class={i === todayIdx ? 'today' : ''}>{l}</div>
          ))}
        </div>
        {data.rows.map((r) => {
          const h = data.habits.find((x) => x.habit_id === r.habit_id)!;
          return (
            <div class="grid-row">
              <div class="label">
                {h.icon}
                {h.name.slice(0, 2)}
              </div>
              {r.cells.map((c, i) => (
                <div class={i === todayIdx ? 'today' : ''} aria-label={`${c.date} ${c.state}`}>
                  <span class={`mark ${c.state}`} />
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <div class="section-title">
        <span>今日清單</span>
      </div>
      <div class="today-list">
        {data.items.length === 0 && <div class="empty">今天沒有排程項目。</div>}
        {data.items.map((it) => (
          <HabitRow key={it.habit.habit_id} item={it} />
        ))}
      </div>

      {data.others.length > 0 && (
        <>
          <div class="section-title">
            <button class="link-btn" onClick={() => setShowOthers((v) => !v)}>
              {showOthers ? '▾' : '▸'} 非排程項目 ({data.others.length})
            </button>
          </div>
          {showOthers && (
            <div class="today-list">
              {data.others.map((it) => (
                <HabitRow key={it.habit.habit_id} item={it} />
              ))}
            </div>
          )}
        </>
      )}

      <p class="hint">左側打卡 · 右側進工作台 · 左滑略過 · 長按管理</p>
    </main>
  );
}

function HabitRow({ item }: { item: ItemView }) {
  const nav = useNav();
  const flag = item.checkin?.visual_flag ?? null;
  const done = flag === FLAG_DONE;
  const skip = flag === FLAG_SKIP;
  const h = item.habit;

  const openBench = () => nav.go({ name: h.engine_type === 'WORKOUT' ? 'workout' : 'simple', habitId: h.habit_id });

  const g = useRowGesture({
    onTap: async (x) => {
      if (x >= 0.2) return openBench();
      haptic();
      const r = await quickCheckin(db, h, new Date());
      if (r.status === 'NEEDS_WORKBENCH') {
        nav.toast('今天沒有綁定課表，請選擇');
        openBench();
      } else if (r.status === 'UNCHECKED') nav.toast('已取消打卡');
    },
    onSwipeLeft: async () => {
      const r = await toggleSkip(db, h, new Date());
      nav.toast(r === 'SKIPPED' ? '今日略過' : r === 'UNSKIPPED' ? '已取消略過' : '已完成，不能略過');
    },
    onLongPress: () => nav.manage(h.habit_id),
  });

  const r = item.row;
  return (
    <div class="row-wrap">
      <div class="behind">{skip ? '取消略過' : '略過今天 [-]'}</div>
      <div
        ref={g.ref}
        class={`row${done ? ' is-done' : ''}${skip ? ' is-skip' : ''}${g.dragging ? ' dragging' : ''}`}
        style={{ transform: `translateX(${g.dx}px)` }}
        {...g.bind}
      >
        <div class="check" aria-label={done ? '已完成，點擊取消' : '打卡'}>
          <span class="box">
            <span class={`mark ${done ? 'DONE' : skip ? 'SKIP' : 'PENDING_TODAY'}`} />
          </span>
        </div>
        <div class="body">
          <div class="title">
            <span>
              {h.icon} {h.name}
            </span>
            <span class="count">
              本週 {r.done}/{r.effective_target}
              {item.badge ? `　${item.badge}` : ''}
            </span>
          </div>
          <div class="detail">{item.detail}</div>
        </div>
        <span class="chev" aria-hidden="true">
          ›
        </span>
      </div>
    </div>
  );
}
