import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../data/db';
import { createContainer, deleteEntry, listContainers, listEntries, saveEntry, updateEntry, updateHabit } from '../data/repo';
import type { CoffeeConfig, CoffeeMode, CoffeePayload } from '../data/types';
import { coffeeDefaults, FLAVOR_PRESETS } from '../logic/coffee';
import { Seg, shortDate, Stepper, TimePicker, useNav } from '../ui/kit';

const MODE_LABEL: Record<CoffeeMode, string> = { POUR_OVER: '手沖', ESPRESSO: '義式' };

/** Page 2.0-B 咖啡工作台 */
export function CoffeeBench({ habitId, entryId }: { habitId: string; entryId?: string }) {
  const nav = useNav();
  const data = useLiveQuery(async () => {
    const habit = await db.habits.get(habitId);
    if (!habit) return null;
    const all = await listContainers(db, habitId, { includeArchived: true });
    const entries = await listEntries(db, habitId);
    const editing = entryId ? entries.find((e) => e.log_id === entryId) : undefined;
    return { habit, all, active: all.filter((c) => c.status === 'ACTIVE'), entries, editing };
  }, [habitId, entryId]);

  const [mode, setMode] = useState<CoffeeMode>('POUR_OVER');
  const [beanId, setBeanId] = useState<string | null>(null);
  const [p, setP] = useState<CoffeePayload | null>(null);
  const [rating, setRating] = useState(0);
  const [flavors, setFlavors] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [more, setMore] = useState(false);
  const [at, setAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<'ALL' | CoffeeMode>('ALL');
  const inited = useRef(false);

  const applyDefaults = (m: CoffeeMode, bean: string | null) => {
    if (!data) return;
    const c = data.all.find((x) => x.container_id === bean) ?? null;
    setP(coffeeDefaults(data.entries, c, m, data.habit.config as CoffeeConfig));
  };

  useEffect(() => {
    if (!data || inited.current) return;
    inited.current = true;
    if (data.editing) {
      const ep = data.editing.payload as unknown as CoffeePayload;
      setMode((data.editing.sub_mode as CoffeeMode) ?? 'POUR_OVER');
      setBeanId(data.editing.container_id);
      setP({ ...ep });
      setRating(ep.rating ?? 0);
      setFlavors(ep.flavors ?? []);
      setNote(ep.note ?? '');
      setMore(!!(ep.rating || ep.flavors?.length || ep.note));
      return;
    }
    const last = data.entries[0];
    const m = (last?.sub_mode as CoffeeMode) ?? 'POUR_OVER';
    const bean = data.active.find((c) => c.container_id === last?.container_id)?.container_id ?? data.active[0]?.container_id ?? null;
    setMode(m);
    setBeanId(bean);
    const c = data.all.find((x) => x.container_id === bean) ?? null;
    setP(coffeeDefaults(data.entries, c, m, data.habit.config as CoffeeConfig));
  }, [data]);

  if (data === undefined || (data && !p)) return <main class="screen no-tabs" />;
  if (data === null) return <main class="screen no-tabs"><div class="empty">找不到這個項目。</div></main>;

  const { habit, all, active, entries, editing } = data;
  const cfg = habit.config as CoffeeConfig;
  const payload = p!;
  const set = (patch: Partial<CoffeePayload>) => setP({ ...payload, ...patch });

  const switchMode = (m: CoffeeMode) => {
    setMode(m);
    applyDefaults(m, beanId);
  };
  const switchBean = (id: string) => {
    if (id === '__new') return void addBean();
    setBeanId(id);
    if (!editing) applyDefaults(mode, id);
  };
  const addBean = async () => {
    const name = prompt('新增咖啡豆 (例如：肯亞 AA 水洗)')?.trim();
    if (!name) return;
    const c = await createContainer(db, { habit_id: habit.habit_id, name }, new Date());
    setBeanId(c.container_id);
  };
  const switchGrinder = async (g: string) => {
    if (g !== '__new') return set({ grinder: g });
    const name = prompt('新增磨豆機型號')?.trim();
    if (!name) return;
    await updateHabit(db, habit.habit_id, { config: { ...cfg, grinders: [...cfg.grinders, name] } }, new Date());
    set({ grinder: name });
  };

  const customFlavors = [...new Set(entries.flatMap((e) => (e.payload as unknown as CoffeePayload)?.flavors ?? []))].filter(
    (f) => !FLAVOR_PRESETS.includes(f),
  );
  const toggleFlavor = (f: string) => setFlavors((xs) => (xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f]));
  const addFlavor = () => {
    const f = prompt('新增風味')?.trim();
    if (f && !flavors.includes(f)) setFlavors((xs) => [...xs, f]);
  };

  const buildPayload = (): Record<string, unknown> => {
    const base: CoffeePayload =
      mode === 'POUR_OVER'
        ? { grinder: payload.grinder, temp_c: payload.temp_c, grind: payload.grind, ratio: payload.ratio ?? 15 }
        : {
            grinder: payload.grinder,
            temp_c: payload.temp_c,
            grind: payload.grind,
            dose_g: payload.dose_g ?? 18,
            yield_g: payload.yield_g ?? 36,
            time_s: payload.time_s ?? 28,
          };
    if (rating > 0) base.rating = rating;
    if (flavors.length) base.flavors = flavors;
    if (note.trim()) base.note = note.trim();
    return base as unknown as Record<string, unknown>;
  };

  const save = async () => {
    if (!beanId) return nav.toast('請先選擇或新增咖啡豆');
    const now = new Date();
    const body = buildPayload();
    if (editing) await updateEntry(db, habit, editing.log_id, { payload: body, container_id: beanId, sub_mode: mode }, now);
    else await saveEntry(db, habit, { container_id: beanId, sub_mode: mode, payload: body, at: at ?? undefined }, now);
    nav.toast('已儲存');
    nav.back();
  };

  const remove = async () => {
    if (!editing || !confirm('刪除這筆咖啡紀錄？')) return;
    await deleteEntry(db, editing.log_id, new Date());
    nav.toast('已刪除');
    nav.back();
  };

  const grinders = cfg.grinders.includes(payload.grinder) || !payload.grinder ? cfg.grinders : [...cfg.grinders, payload.grinder];
  const nameOf = (id: string | null) => all.find((c) => c.container_id === id)?.name ?? '';
  const history = entries.filter((e) => filter === 'ALL' || e.sub_mode === filter);

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
          <Seg<CoffeeMode> value={mode} onChange={switchMode} options={[['POUR_OVER', '手沖模式'], ['ESPRESSO', '義式模式']]} />
        </div>

        <div style={{ marginTop: '12px' }}>
          <label class="field-label" for="bean">🫘 咖啡豆</label>
          <select id="bean" class="select" value={beanId ?? ''} onChange={(e) => switchBean((e.currentTarget as HTMLSelectElement).value)}>
            {!beanId && <option value="" disabled>選擇咖啡豆…</option>}
            {active.map((c) => <option value={c.container_id}>{c.name}</option>)}
            {beanId && !active.some((c) => c.container_id === beanId) && <option value={beanId}>{nameOf(beanId)}（已封存）</option>}
            <option value="__new">＋ 新增咖啡豆…</option>
          </select>
        </div>

        <div style={{ marginTop: '12px' }}>
          <label class="field-label" for="grinder">
            ⚙️ 磨豆機{cfg.default_grinder[mode] === payload.grinder ? `（${MODE_LABEL[mode]}預設）` : ''}
          </label>
          <select id="grinder" class="select" value={payload.grinder} onChange={(e) => void switchGrinder((e.currentTarget as HTMLSelectElement).value)}>
            {!payload.grinder && <option value="" disabled>選擇磨豆機…</option>}
            {grinders.map((g) => <option value={g}>{g}</option>)}
            <option value="__new">＋ 新增磨豆機…</option>
          </select>
        </div>

        <div class="param-grid">
          <span>水溫</span>
          <Stepper label="水溫" value={payload.temp_c} step={1} unit="°C" onChange={(v) => set({ temp_c: v })} />
          <span>研磨</span>
          <Stepper label="研磨刻度" value={payload.grind} step={1} unit="格" onChange={(v) => set({ grind: v })} />
          {mode === 'POUR_OVER' ? (
            <>
              <span>粉水比</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span class="field-label" style={{ margin: 0 }}>1 :</span>
                <Stepper label="粉水比" value={payload.ratio ?? 15} step={0.5} min={1} onChange={(v) => set({ ratio: v })} />
              </span>
            </>
          ) : (
            <>
              <span>粉量</span>
              <Stepper label="粉量" value={payload.dose_g ?? 18} step={0.5} unit="g" onChange={(v) => set({ dose_g: v })} />
              <span>萃取量</span>
              <Stepper label="萃取量" value={payload.yield_g ?? 36} step={1} unit="g" onChange={(v) => set({ yield_g: v })} />
              <span>時間</span>
              <Stepper label="萃取時間" value={payload.time_s ?? 28} step={1} unit="秒" onChange={(v) => set({ time_s: v })} />
            </>
          )}
        </div>

        <button class="link-btn" style={{ marginTop: '8px' }} onClick={() => setMore((v) => !v)}>
          {more ? '▾' : '▸'} 風味、評分與備註
        </button>
        {more && (
          <div style={{ display: 'grid', gap: '12px', marginTop: '6px' }}>
            <div class="param-grid" style={{ marginTop: 0 }}>
              <span>評分</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Stepper label="評分" value={rating} step={0.5} onChange={(v) => setRating(Math.min(5, v))} />
                <span class="field-label" style={{ margin: 0 }}>{rating > 0 ? `★${rating}` : '未評分'}</span>
              </span>
            </div>
            <div class="chips">
              {[...FLAVOR_PRESETS, ...customFlavors, ...flavors.filter((f) => !FLAVOR_PRESETS.includes(f) && !customFlavors.includes(f))].map((f) => (
                <button type="button" class="chip" aria-pressed={flavors.includes(f)} onClick={() => toggleFlavor(f)}>{f}</button>
              ))}
              <button type="button" class="chip" onClick={addFlavor}>＋</button>
            </div>
            <textarea class="text-input" style={{ minHeight: '72px' }} placeholder="備註" value={note}
              onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
          </div>
        )}
      </div>

      {editing && <div class="btn-row"><button class="link-btn danger" onClick={remove}>刪除這筆紀錄</button></div>}

      <div class="section-title">
        <span>歷史</span>
        <Seg<'ALL' | CoffeeMode> value={filter} onChange={setFilter} options={[['ALL', '全部'], ['POUR_OVER', '手沖'], ['ESPRESSO', '義式']]} />
      </div>
      {history.length === 0 ? (
        <div class="empty">還沒有紀錄。</div>
      ) : (
        <ul class="history">
          {history.slice(0, 40).map((e) => (
            <li>
              <button onClick={() => nav.go({ name: 'coffee', habitId, entryId: e.log_id })}>
                <span class="date">{shortDate(e.local_date)}</span>
                <span>
                  <span class="tag">{MODE_LABEL[(e.sub_mode as CoffeeMode) ?? 'POUR_OVER']}</span>
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
