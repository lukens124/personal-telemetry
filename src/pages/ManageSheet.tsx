import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'preact/hooks';
import { db } from '../data/db';
import { bindWeekday, createContainer, deleteHabit, listContainers, updateContainer, updateHabit } from '../data/repo';
import type { CoffeeConfig, CoffeeMode, Container, Habit, IsoWeekday, WorkoutConfig } from '../data/types';
import { Stepper, useNav, WeekdayChips } from '../ui/kit';

const LABELS: Record<Habit['engine_type'], string> = {
  WORKOUT: '課表',
  COFFEE: '咖啡豆',
  READING: '書籍 / 來源',
  GENERIC: '分類',
};

/** Modal 2.5：排程、星期綁定、容器、N:M 週期 */
export function ManageSheet({ habitId, onClose }: { habitId: string; onClose: () => void }) {
  const data = useLiveQuery(async () => {
    const habit = await db.habits.get(habitId);
    const containers = habit ? await listContainers(db, habitId, { includeArchived: true }) : [];
    return { habit, containers };
  }, [habitId]);
  const [showArchived, setShowArchived] = useState(false);
  const nav = useNav();

  const habit = data?.habit;
  const now = () => new Date();

  const containerLabel =
    habit?.engine_type === 'GENERIC'
      ? ((habit.config as { container_label?: string }).container_label ?? LABELS.GENERIC)
      : habit
        ? LABELS[habit.engine_type]
        : '';

  const active = data?.containers.filter((c) => c.status === 'ACTIVE') ?? [];
  const archived = data?.containers.filter((c) => c.status === 'ARCHIVED') ?? [];

  const toggleSchedule = (d: IsoWeekday) => {
    if (!habit) return;
    const days = habit.schedule_days.includes(d)
      ? habit.schedule_days.filter((x) => x !== d)
      : [...habit.schedule_days, d].sort((a, b) => a - b);
    // 目標若原本等於排程天數，跟著調整
    const target = habit.weekly_target === habit.schedule_days.length ? days.length : habit.weekly_target;
    void updateHabit(db, habit.habit_id, { schedule_days: days, weekly_target: target }, now());
  };

  const addContainer = async () => {
    if (!habit) return;
    const name = prompt(`新增${containerLabel}名稱`)?.trim();
    if (name) await createContainer(db, { habit_id: habit.habit_id, name }, now());
  };

  const cycle = habit?.engine_type === 'WORKOUT' ? (habit.config as WorkoutConfig).cycle : null;
  const coffee = habit?.engine_type === 'COFFEE' ? (habit.config as CoffeeConfig) : null;

  const setCoffee = (c: CoffeeConfig) => habit && void updateHabit(db, habit.habit_id, { config: c }, now());
  const addGrinder = () => {
    if (!coffee) return;
    const g = prompt('新增磨豆機型號')?.trim();
    if (g && !coffee.grinders.includes(g)) setCoffee({ ...coffee, grinders: [...coffee.grinders, g] });
  };
  const removeGrinder = (g: string) => {
    if (!coffee || !confirm(`移除「${g}」？歷史紀錄不受影響。`)) return;
    const dg = { ...coffee.default_grinder };
    for (const k of Object.keys(dg) as CoffeeMode[]) if (dg[k] === g) delete dg[k];
    setCoffee({ grinders: coffee.grinders.filter((x) => x !== g), default_grinder: dg });
  };

  const remove = async () => {
    if (!habit) return;
    if (!confirm(`刪除「${habit.name}」？\n項目會從 App 隱藏，歷史紀錄仍保留在雲端試算表。`)) return;
    await deleteHabit(db, habit.habit_id, now());
    onClose();
    nav.go({ name: habit.category_tab === 'TRACK' ? 'track' : 'log' });
    nav.toast(`已刪除「${habit.name}」`);
  };

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="習慣管理">
        <header class="topbar">
          <h1 style={{ fontSize: '18px' }}>{habit ? `${habit.icon} ${habit.name}` : ''}</h1>
          <button class="icon-btn" onClick={onClose}>✕ 關閉</button>
        </header>
        {habit && (
          <>
            <div class="card">
              <label class="field-label" for="hname">名稱</label>
              <input id="hname" class="text-input" defaultValue={habit.name}
                onBlur={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value.trim();
                  if (v && v !== habit.name) void updateHabit(db, habit.habit_id, { name: v }, now());
                }} />
              {habit.category_tab === 'TRACK' && (
                <>
                  <span class="field-label" style={{ marginTop: '14px' }}>排程日</span>
                  <WeekdayChips value={habit.schedule_days} onToggle={toggleSchedule} />
                  <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span class="field-label" style={{ margin: 0 }}>每週目標</span>
                    <Stepper label="每週目標" value={habit.weekly_target} step={1} unit="次"
                      onChange={(v) => void updateHabit(db, habit.habit_id, { weekly_target: Math.min(7, v) }, now())} />
                  </div>
                </>
              )}
            </div>

            {cycle && (
              <div class="card">
                <span class="field-label">訓練週期</span>
                <div class="cycle-grid">
                  <span>主訓</span>
                  <Stepper label="主訓次數" value={cycle.main} step={1} min={1} unit="次"
                    onChange={(v) => void updateHabit(db, habit.habit_id, { config: { cycle: { ...cycle, main: Math.max(1, v) } } }, now())} />
                  <span>減載</span>
                  <Stepper label="減載次數" value={cycle.deload} step={1} unit="次"
                    onChange={(v) => void updateHabit(db, habit.habit_id, { config: { cycle: { ...cycle, deload: v } } }, now())} />
                </div>
              </div>
            )}

            {coffee && (
              <div class="card">
                <span class="field-label">磨豆機與模式預設</span>
                {coffee.grinders.length === 0 && <div class="field-label">還沒有磨豆機。</div>}
                {coffee.grinders.map((g) => (
                  <div class="container-item">
                    <div class="line">
                      <span style={{ flex: 1 }}>⚙️ {g}</span>
                      <button class="link-btn danger" onClick={() => removeGrinder(g)}>移除</button>
                    </div>
                  </div>
                ))}
                <div class="btn-row"><button class="link-btn" onClick={addGrinder}>＋ 新增磨豆機</button></div>
                <div class="param-grid">
                  {(['POUR_OVER', 'ESPRESSO'] as CoffeeMode[]).map((m) => (
                    <>
                      <span>{m === 'POUR_OVER' ? '手沖預設' : '義式預設'}</span>
                      <select class="select" value={coffee.default_grinder[m] ?? ''}
                        onChange={(e) => setCoffee({ ...coffee, default_grinder: { ...coffee.default_grinder, [m]: (e.currentTarget as HTMLSelectElement).value || undefined } })}>
                        <option value="">（不指定）</option>
                        {coffee.grinders.map((g) => <option value={g}>{g}</option>)}
                      </select>
                    </>
                  ))}
                </div>
              </div>
            )}

            <div class="section-title">
              <span>{containerLabel}{habit.engine_type === 'WORKOUT' ? '與星期綁定' : ''}</span>
              <button class="link-btn" onClick={addContainer}>＋ 新增</button>
            </div>
            <div class="card">
              {active.length === 0 && <div class="field-label">還沒有{containerLabel}。</div>}
              {active.map((c) => <ContainerItem key={c.container_id} c={c} habit={habit} />)}
            </div>

            {archived.length > 0 && (
              <>
                <div class="section-title">
                  <button class="link-btn" onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? '▾' : '▸'} 已封存 ({archived.length})
                  </button>
                </div>
                {showArchived && (
                  <div class="card">
                    {archived.map((c) => <ContainerItem key={c.container_id} c={c} habit={habit} />)}
                  </div>
                )}
              </>
            )}
            <div class="btn-row" style={{ marginTop: '24px', justifyContent: 'center' }}>
              <button class="link-btn danger" onClick={remove}>刪除「{habit.name}」</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ContainerItem({ c, habit }: { c: Container; habit: Habit }) {
  const now = () => new Date();
  const isWorkout = habit.engine_type === 'WORKOUT';
  const archived = c.status === 'ARCHIVED';
  return (
    <div class={`container-item${archived ? ' archived' : ''}`}>
      <div class="line">
        <input class="text-input" defaultValue={c.name} aria-label="名稱"
          onBlur={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value.trim();
            if (v && v !== c.name) void updateContainer(db, c.container_id, { name: v }, now());
          }} />
        <button class="link-btn" onClick={async () => {
          if (!archived && c.bound_weekdays.length) {
            for (const d of c.bound_weekdays) await bindWeekday(db, habit.habit_id, d, null, now());
          }
          await updateContainer(db, c.container_id, { status: archived ? 'ACTIVE' : 'ARCHIVED' }, now());
        }}>
          {archived ? '還原' : '📦封存'}
        </button>
      </div>
      {isWorkout && !archived && (
        <WeekdayChips value={c.bound_weekdays}
          onToggle={(d) => void bindWeekday(db, habit.habit_id, d, c.bound_weekdays.includes(d) ? null : c.container_id, now())} />
      )}
    </div>
  );
}
