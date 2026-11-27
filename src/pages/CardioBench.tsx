/**
 * 有氧工作台：公路車 / 室內台 / 跑步，依類型切換欄位。
 * Apple 健康匯入的紀錄也在這裡檢視或補充 (RPE、路線、備註皆為選填)。
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../data/db';
import { createContainer, deleteEntry, listContainers, listEntries, saveEntry, updateEntry } from '../data/repo';
import { type CardioConfig, type CardioPayload, type CardioSport } from '../data/types';
import { fmtPace, paceSec } from '../logic/cardio';
import { Seg, shortDate, Stepper, TimePicker, useNav } from '../ui/kit';

type Num = Exclude<keyof CardioPayload, 'source' | 'note' | 'hk_type'>;

export function CardioBench({ habitId, entryId }: { habitId: string; entryId?: string }) {
  const nav = useNav();
  const data = useLiveQuery(async () => {
    const habit = await db.habits.get(habitId);
    if (!habit) return null;
    const all = await listContainers(db, habitId, { includeArchived: true });
    const entries = await listEntries(db, habitId);
    const editing = entryId ? entries.find((e) => e.log_id === entryId) : undefined;
    return { habit, all, active: all.filter((c) => c.status === 'ACTIVE'), entries, editing };
  }, [habitId, entryId]);

  const [sport, setSport] = useState<CardioSport>('ROAD');
  const [routeId, setRouteId] = useState<string | null>(null);
  const [p, setP] = useState<CardioPayload>({ duration_min: 0, source: 'MANUAL' });
  const [at, setAt] = useState<Date | null>(null);
  const inited = useRef(false);

  const prefill = (s: CardioSport) => {
    if (!data) return;
    const last = data.entries.find((e) => e.sub_mode === s && (e.payload as unknown as CardioPayload)?.source === 'MANUAL');
    const lp = last?.payload as unknown as CardioPayload | undefined;
    setRouteId(s === 'INDOOR' ? null : (last?.container_id ?? null));
    setP({
      duration_min: lp?.duration_min ?? 0,
      ...(lp?.distance_km && s !== 'INDOOR' ? { distance_km: lp.distance_km } : {}),
      source: 'MANUAL',
    });
  };

  useEffect(() => {
    if (!data || inited.current) return;
    inited.current = true;
    if (data.editing) {
      setSport((data.editing.sub_mode as CardioSport) ?? 'ROAD');
      setRouteId(data.editing.container_id);
      setP({ ...(data.editing.payload as unknown as CardioPayload) });
      return;
    }
    const s = (data.entries[0]?.sub_mode as CardioSport) ?? 'ROAD';
    setSport(s);
    prefill(s);
  }, [data]);

  if (data === undefined) return <main class="screen no-tabs" />;
  if (data === null) return <main class="screen no-tabs"><div class="empty">找不到這個項目。</div></main>;

  const { habit, all, active, entries, editing } = data;
  const cfg = habit.config as CardioConfig;
  const fromHealth = p.source === 'HEALTH';
  const set = (k: Num, v: number) => setP((x) => ({ ...x, [k]: v > 0 ? v : undefined }));
  const num = (k: Num) => (p[k] as number | undefined) ?? 0;

  const switchSport = (s: CardioSport) => {
    setSport(s);
    if (!editing) prefill(s);
  };
  const switchRoute = async (id: string) => {
    if (id !== '__new') return setRouteId(id || null);
    const name = prompt(`新增${cfg.container_label}`)?.trim();
    if (!name) return;
    const c = await createContainer(db, { habit_id: habit.habit_id, name }, new Date());
    setRouteId(c.container_id);
  };

  const clean = (): CardioPayload => {
    const out: CardioPayload = { duration_min: p.duration_min, source: p.source };
    const keep: Num[] = ['distance_km', 'kcal', 'avg_hr', 'max_hr', 'rpe'];
    if (sport === 'INDOOR') keep.push('power_w');
    if (sport === 'RUN') keep.push('cadence_spm');
    for (const k of keep) if (p[k]) (out as unknown as Record<string, unknown>)[k] = p[k];
    if (sport === 'INDOOR') delete out.distance_km;
    if (p.note?.trim()) out.note = p.note.trim();
    if (p.hk_type) out.hk_type = p.hk_type;
    return out;
  };

  const save = async () => {
    if (!p.duration_min) return nav.toast('請輸入運動時間');
    const payload = clean() as unknown as Record<string, unknown>;
    const container_id = sport === 'INDOOR' ? null : routeId;
    const now = new Date();
    if (editing) await updateEntry(db, habit, editing.log_id, { payload, container_id, sub_mode: sport }, now);
    else await saveEntry(db, habit, { container_id, sub_mode: sport, payload, at: at ?? undefined }, now);
    nav.toast('已儲存');
    nav.back();
  };

  const remove = async () => {
    if (!editing || !confirm('刪除這筆有氧紀錄？' + (fromHealth ? '\n之後健康 App 同步也不會再匯入這筆。' : ''))) return;
    await deleteEntry(db, editing.log_id, new Date());
    nav.toast('已刪除');
    nav.back();
  };

  const hours = Math.floor(p.duration_min / 60);
  const mins = Math.round((p.duration_min % 60) * 10) / 10;
  const pace = sport === 'RUN' ? fmtPace(paceSec(p)) : '';
  const sports: [CardioSport, string][] = [['ROAD', '公路車'], ['INDOOR', '室內台'], ['RUN', '跑步']];
  if (sport === 'OTHER') sports.push(['OTHER', p.hk_type ?? '其他']);
  const nameOf = (id: string | null) => all.find((c) => c.container_id === id)?.name ?? '';

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
            <span class="field-label" style={{ margin: 0 }}>
              {shortDate(editing.local_date)} {editing.timestamp.slice(11, 16)}{' '}
              <span class="badge">{fromHealth ? 'Apple 健康' : '手動'}</span>
            </span>
          ) : (
            <TimePicker value={at} onChange={setAt} />
          )}
          <button class="icon-btn primary" onClick={save}>✓ 儲存</button>
        </div>

        <div style={{ marginTop: '14px' }}>
          <Seg<CardioSport> value={sport} onChange={switchSport} options={sports} />
        </div>

        {sport !== 'INDOOR' && (
          <div style={{ marginTop: '12px' }}>
            <label class="field-label" for="route">{cfg.container_label}（選填）</label>
            <select id="route" class="select" value={routeId ?? ''} onChange={(e) => void switchRoute((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">（不指定）</option>
              {active.map((c) => <option value={c.container_id}>{c.name}</option>)}
              {routeId && !active.some((c) => c.container_id === routeId) && <option value={routeId}>{nameOf(routeId)}</option>}
              <option value="__new">＋ 新增…</option>
            </select>
          </div>
        )}

        <div class="param-grid">
          <span>時間</span>
          <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Stepper label="小時" value={hours} step={1} unit="時" onChange={(h) => setP((x) => ({ ...x, duration_min: h * 60 + (x.duration_min % 60) }))} />
            <Stepper label="分鐘" value={mins} step={5} unit="分"
              onChange={(m) => setP((x) => ({ ...x, duration_min: Math.floor(x.duration_min / 60) * 60 + Math.min(59.9, m) }))} />
          </span>
          {sport !== 'INDOOR' && (
            <>
              <span>距離</span>
              <Stepper label="距離" value={num('distance_km')} step={1} unit="km" onChange={(v) => set('distance_km', v)} />
            </>
          )}
          {sport === 'RUN' && (
            <>
              <span>配速</span>
              <span class="field-label" style={{ margin: 0, fontSize: '16px', color: 'var(--ink)' }}>{pace ? `${pace} /km` : '輸入時間與距離後自動計算'}</span>
              <span>步頻</span>
              <Stepper label="步頻" value={num('cadence_spm')} step={1} unit="spm" onChange={(v) => set('cadence_spm', v)} />
            </>
          )}
          {sport === 'INDOOR' && (
            <>
              <span>功率</span>
              <Stepper label="平均功率" value={num('power_w')} step={5} unit="W" onChange={(v) => set('power_w', v)} />
            </>
          )}
          <span>熱量</span>
          <Stepper label="動態熱量" value={num('kcal')} step={10} unit="kcal" onChange={(v) => set('kcal', v)} />
          <span>平均心率</span>
          <Stepper label="平均心率" value={num('avg_hr')} step={1} unit="bpm" onChange={(v) => set('avg_hr', v)} />
          <span>最大心率</span>
          <Stepper label="最大心率" value={num('max_hr')} step={1} unit="bpm" onChange={(v) => set('max_hr', v)} />
        </div>

        <div style={{ marginTop: '14px' }}>
          <span class="field-label">RPE 體感強度（選填）</span>
          <div class="rpe-row" role="group" aria-label="RPE">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button type="button" aria-pressed={p.rpe === n} onClick={() => setP((x) => ({ ...x, rpe: x.rpe === n ? undefined : n }))}>{n}</button>
            ))}
          </div>
        </div>

        <textarea class="text-input" style={{ minHeight: '64px', marginTop: '12px' }} placeholder="備註（選填）" value={p.note ?? ''}
          onInput={(e) => setP((x) => ({ ...x, note: (e.currentTarget as HTMLTextAreaElement).value }))} />
      </div>

      {editing && <div class="btn-row"><button class="link-btn danger" onClick={remove}>刪除這筆紀錄</button></div>}

      <div class="section-title"><span>歷史</span><span>{entries.length} 筆</span></div>
      {entries.length === 0 ? (
        <div class="empty">還沒有紀錄。設定好 Apple 健康同步後，運動會自動出現在這裡。</div>
      ) : (
        <ul class="history">
          {entries.slice(0, 60).map((e) => (
            <li>
              <button onClick={() => nav.go({ name: 'cardio', habitId, entryId: e.log_id })}>
                <span class="date">{shortDate(e.local_date)}</span>
                <span>
                  {e.summary_text}
                  {(e.payload as unknown as CardioPayload)?.rpe ? <span class="tag"> RPE {(e.payload as unknown as CardioPayload).rpe}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
