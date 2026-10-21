import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isoWeekday, toLocalDate, WEEKDAY_LABELS } from '../data/dates';
import { db } from '../data/db';
import {
  deleteEntry,
  findBoundContainer,
  listContainers,
  listEntries,
  saveEntry,
  updateContainer,
  updateEntry,
  workoutCycle,
} from '../data/repo';
import type { WorkoutExercise, WorkoutMode, WorkoutPayload } from '../data/types';
import { Seg, shortDate, Stepper, TimePicker, useNav } from '../ui/kit';

const clone = <T,>(x: T): T => structuredClone(x);
const toPayload = (p: WorkoutPayload) => p as unknown as Record<string, unknown>;

export function WorkoutBench({ habitId, entryId }: { habitId: string; entryId?: string }) {
  const nav = useNav();

  const data = useLiveQuery(async () => {
    const habit = await db.habits.get(habitId);
    if (!habit) return null;
    const allContainers = await listContainers(db, habitId, { includeArchived: true });
    const containers = allContainers.filter((c) => c.status === 'ACTIVE');
    const entries = await listEntries(db, habitId);
    const cycle = await workoutCycle(db, habit);
    const today = toLocalDate(new Date());
    const editing = entryId ? entries.find((e) => e.log_id === entryId) : entries.find((e) => e.local_date === today);
    const bound = await findBoundContainer(db, habitId, isoWeekday(today));
    return { habit, containers, allContainers, entries, cycle, editing, bound };
  }, [habitId, entryId]);

  const [containerId, setContainerId] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkoutMode>('MAIN');
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [at, setAt] = useState<Date | null>(null);
  const inited = useRef(false);

  // 初始化：編輯既有紀錄，或依今日星期預載綁定課表
  useEffect(() => {
    if (!data || inited.current) return;
    inited.current = true;
    if (data.editing) {
      setContainerId(data.editing.container_id);
      setMode((data.editing.sub_mode as WorkoutMode) ?? 'MAIN');
      setExercises(clone((data.editing.payload as unknown as WorkoutPayload)?.exercises ?? []));
      return;
    }
    setMode(data.cycle.suggested);
    if (data.bound) loadContainer(data.bound.container_id);
  }, [data]);

  const loadContainer = (id: string) => {
    setContainerId(id);
    const c = data?.allContainers.find((x) => x.container_id === id);
    const p = (c?.last_payload ?? c?.default_payload) as unknown as WorkoutPayload | null;
    setExercises(clone(p?.exercises ?? []));
  };

  if (data === undefined) return <main class="screen no-tabs" />;
  if (data === null) return <main class="screen no-tabs"><div class="empty">找不到這個項目。</div></main>;

  const { habit, containers, allContainers, entries, cycle, editing, bound } = data;
  const weekday = isoWeekday(toLocalDate(new Date()));

  const setEx = (i: number, fn: (e: WorkoutExercise) => WorkoutExercise) =>
    setExercises((xs) => xs.map((e, j) => (j === i ? fn(clone(e)) : e)));

  const save = async () => {
    if (!containerId) return nav.toast('請先選擇課表');
    const payload = toPayload({ exercises: exercises.filter((e) => e.name.trim()) });
    const now = new Date();
    if (editing) {
      await updateEntry(db, habit, editing.log_id, { payload, container_id: containerId, sub_mode: mode }, now);
      await updateContainer(db, containerId, { last_payload: payload }, now);
    } else {
      await saveEntry(db, habit, { container_id: containerId, sub_mode: mode, payload, at: at ?? undefined }, now);
    }
    nav.toast('已儲存');
    nav.back();
  };

  const remove = async () => {
    if (!editing || !confirm('刪除這筆重訓紀錄？')) return;
    await deleteEntry(db, editing.log_id, new Date());
    nav.toast('已刪除');
    nav.back();
  };

  const containerName = (id: string | null) => allContainers.find((c) => c.container_id === id)?.name ?? '';
  const trail = entries.slice(0, 12).reverse();

  return (
    <main class="screen no-tabs">
      <header class="topbar">
        <button class="icon-btn" onClick={nav.back}>‹ 返回</button>
        <h1 style={{ fontSize: '18px' }}>{habit.icon} {habit.name}</h1>
        <button class="icon-btn" onClick={() => nav.manage(habit.habit_id)}>管理</button>
      </header>

      <div class="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          {editing ? (
            <span class="field-label" style={{ margin: 0 }}>編輯 {shortDate(editing.local_date)} 的紀錄</span>
          ) : (
            <TimePicker value={at} onChange={setAt} />
          )}
          <button class="icon-btn primary" onClick={save}>✓ 儲存</button>
        </div>

        <div style={{ marginTop: '12px' }}>
          <span class="field-label">檔位</span>
          <Seg<WorkoutMode> value={mode} onChange={setMode} options={[['MAIN', '🔥 主訓練'], ['DELOAD', '🔋 減載']]} />
        </div>

        <div style={{ marginTop: '14px' }}>
          <label class="field-label" for="course">
            課表{bound ? `（週${WEEKDAY_LABELS[weekday - 1]}預設：${bound.name}）` : '（今天沒有綁定，請選擇）'}
          </label>
          <select
            id="course"
            class="select"
            value={containerId ?? ''}
            onChange={(e) => loadContainer((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="" disabled>選擇課表…</option>
            {containers.map((c) => (
              <option value={c.container_id}>
                {c.name}
                {c.bound_weekdays.length ? `（週${c.bound_weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join('、')}）` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {containerId && (
        <>
          <div class="section-title"><span>動作</span><span>帶入上次{containerName(containerId)}</span></div>
          {exercises.length === 0 && <div class="empty">這份課表還沒有動作，新增一個開始。</div>}
          {exercises.map((ex, i) => (
            <div class="card exercise">
              <div class="exercise-head">
                <input
                  class="text-input"
                  aria-label={`第 ${i + 1} 個動作名稱`}
                  value={ex.name}
                  placeholder="動作名稱"
                  onChange={(e) => setEx(i, (x) => ({ ...x, name: (e.currentTarget as HTMLInputElement).value }))}
                />
                <button class="link-btn danger" onClick={() => setExercises((xs) => xs.filter((_, j) => j !== i))}>移除</button>
              </div>
              {ex.sets.map((s, k) => (
                <div class="set-row">
                  <span class="idx">{k + 1}</span>
                  <Stepper label="重量" value={s.kg} step={2.5} unit="kg"
                    onChange={(v) => setEx(i, (x) => { x.sets[k].kg = v; return x; })} />
                  <span class="x">×</span>
                  <Stepper label="次數" value={s.reps} step={1} unit="下"
                    onChange={(v) => setEx(i, (x) => { x.sets[k].reps = v; return x; })} />
                </div>
              ))}
              <div class="btn-row">
                <button class="link-btn" onClick={() => setEx(i, (x) => {
                  const last = x.sets[x.sets.length - 1] ?? { kg: 0, reps: 5 };
                  x.sets.push({ ...last });
                  return x;
                })}>＋ 加一組</button>
                {ex.sets.length > 0 && (
                  <button class="link-btn danger" onClick={() => setEx(i, (x) => { x.sets.pop(); return x; })}>－ 刪最後一組</button>
                )}
              </div>
            </div>
          ))}
          <div class="btn-row">
            <button class="link-btn" onClick={() => setExercises((xs) => [...xs, { name: '', sets: [{ kg: 0, reps: 5 }] }])}>＋ 新增動作</button>
            {editing && <button class="link-btn danger" onClick={remove}>刪除這筆紀錄</button>}
          </div>
        </>
      )}

      <div class="section-title">
        <span>週期軌跡（主訓 {(habit.config as { cycle: { main: number; deload: number } }).cycle.main} : 減載 {(habit.config as { cycle: { main: number; deload: number } }).cycle.deload}）</span>
        <span>下次：{cycle.suggested === 'MAIN' ? '主訓' : '減載'} {cycle.position}/{cycle.of}</span>
      </div>
      <div class="card">
        <div class="trail" aria-label="最近 12 次訓練">
          {trail.map((e) => <span class={e.sub_mode === 'DELOAD' ? 'DELOAD' : 'MAIN'} title={e.local_date} />)}
          <span class={`next ${cycle.suggested}`} title="下一次" />
        </div>
      </div>

      <div class="section-title"><span>歷史</span></div>
      {entries.length === 0 ? (
        <div class="empty">還沒有重訓紀錄。</div>
      ) : (
        <ul class="history">
          {entries.slice(0, 30).map((e) => (
            <li>
              <button onClick={() => nav.go({ name: 'workout', habitId, entryId: e.log_id })}>
                <span class="date">{shortDate(e.local_date)}</span>
                <span>
                  <span class="tag">{e.sub_mode === 'DELOAD' ? '減載' : '主訓'}</span>
                  <span class="tag">{containerName(e.container_id)}</span>
                  {e.summary_text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
