/**
 * 閱讀/語言 (READING) 與通用 (GENERIC) 工作台。
 * P3 會擴充成完整的 2.0-C / 2.0-D；目前提供日常記錄所需的核心功能。
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../data/db';
import { createContainer, deleteEntry, listContainers, listEntries, saveEntry, updateEntry } from '../data/repo';
import type { GenericConfig, GenericPayload, NoteNature, ReadingConfig, ReadingPayload } from '../data/types';
import { Seg, shortDate, Stepper, TimePicker, useNav } from '../ui/kit';

export function SimpleBench({ habitId, entryId }: { habitId: string; entryId?: string }) {
  const nav = useNav();
  const data = useLiveQuery(async () => {
    const habit = await db.habits.get(habitId);
    if (!habit) return null;
    const all = await listContainers(db, habitId, { includeArchived: true });
    const entries = await listEntries(db, habitId);
    const editing = entryId ? entries.find((e) => e.log_id === entryId) : undefined;
    return { habit, all, active: all.filter((c) => c.status === 'ACTIVE'), entries, editing };
  }, [habitId, entryId]);

  const [containerId, setContainerId] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  // READING
  const [nature, setNature] = useState<NoteNature>('INSIGHT');
  const [example, setExample] = useState('');
  const [page, setPage] = useState('');
  const [showMore, setShowMore] = useState(false);
  // 共用文字
  const [text, setText] = useState('');
  // GENERIC 數值
  const [values, setValues] = useState<Record<string, number>>({});
  const inited = useRef(false);

  useEffect(() => {
    if (!data || inited.current) return;
    inited.current = true;
    const { habit, editing, active } = data;
    if (editing) {
      setContainerId(editing.container_id);
      if (habit.engine_type === 'READING') {
        const p = editing.payload as unknown as ReadingPayload;
        setNature(p.nature);
        setText(p.text);
        setExample(p.example ?? '');
        setPage(p.page ?? '');
      } else {
        const p = editing.payload as unknown as GenericPayload;
        setValues(p.values ?? {});
        setText(p.text ?? '');
      }
      return;
    }
    // 新紀錄：沿用上次的容器 / 模板
    const lastC = data.entries[0]?.container_id;
    setContainerId(active.find((c) => c.container_id === lastC)?.container_id ?? active[0]?.container_id ?? null);
    if (habit.engine_type === 'GENERIC') {
      const tpl = habit.last_state?.template;
      if (typeof tpl === 'string') setText(tpl);
      // 數值沿用上一筆 (例如同一條路線的距離)
      const lastVals = (data.entries[0]?.payload as unknown as GenericPayload | undefined)?.values;
      if (lastVals) setValues({ ...lastVals });
    }
  }, [data]);

  if (data === undefined) return <main class="screen no-tabs" />;
  if (data === null) return <main class="screen no-tabs"><div class="empty">找不到這個項目。</div></main>;

  const { habit, all, active, entries, editing } = data;
  const isReading = habit.engine_type === 'READING';
  const rcfg = habit.config as ReadingConfig;
  const gcfg = habit.config as GenericConfig;
  const containerLabel = isReading ? '書籍 / 來源' : gcfg.container_label;
  const showContainer = isReading || !!gcfg.container_label || active.length > 0;
  const nameOf = (id: string | null) => all.find((c) => c.container_id === id)?.name ?? '';

  const addContainer = async () => {
    const name = prompt(`新增${containerLabel ?? '分類'}名稱`)?.trim();
    if (!name) return;
    const c = await createContainer(db, { habit_id: habit.habit_id, name }, new Date());
    setContainerId(c.container_id);
  };

  const buildPayload = (): Record<string, unknown> | null => {
    if (isReading) {
      if (!text.trim()) return null;
      const p: ReadingPayload = { nature, text: text.trim(), ...(example && { example }), ...(page && { page }) };
      return p as unknown as Record<string, unknown>;
    }
    const p: GenericPayload = { values, text };
    return p as unknown as Record<string, unknown>;
  };

  const save = async () => {
    const payload = buildPayload();
    if (!payload) return nav.toast('請先輸入內容');
    if (isReading && !containerId) return nav.toast('請先選擇書籍或來源');
    const now = new Date();
    if (editing) await updateEntry(db, habit, editing.log_id, { payload, container_id: containerId }, now);
    else await saveEntry(db, habit, { container_id: containerId, payload, at: at ?? undefined }, now);
    nav.toast('已儲存');
    nav.back();
  };

  const remove = async () => {
    if (!editing || !confirm('刪除這筆紀錄？')) return;
    await deleteEntry(db, editing.log_id, new Date());
    nav.toast('已刪除');
    nav.back();
  };

  const over = isReading && text.length > rcfg.max_chars;

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

        {showContainer && (
          <div style={{ marginTop: '12px' }}>
            <label class="field-label" for="container">{containerLabel ?? '分類'}</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select id="container" class="select" value={containerId ?? ''}
                onChange={(e) => setContainerId((e.currentTarget as HTMLSelectElement).value || null)}>
                {!isReading && <option value="">（不指定）</option>}
                {isReading && !containerId && <option value="" disabled>選擇…</option>}
                {active.map((c) => <option value={c.container_id}>{c.name}</option>)}
              </select>
              <button class="link-btn" onClick={addContainer}>＋新增</button>
            </div>
          </div>
        )}

        {isReading && (
          <>
            <div style={{ marginTop: '12px' }}>
              <span class="field-label">性質</span>
              <Seg<NoteNature> value={nature} onChange={setNature}
                options={[['INSIGHT', '💡洞察'], ['STATUS', '📌狀態'], ['CHUNK', '🗣️語塊']]} />
            </div>
            <div style={{ marginTop: '12px' }}>
              <textarea class="text-input" aria-label="筆記內容" placeholder="一句話記下重點…" value={text}
                style={{ minHeight: '96px' }}
                onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
              <div class="field-label" style={{ textAlign: 'right', color: over ? 'var(--miss)' : undefined }}>
                {text.length} / {rcfg.max_chars} 字
              </div>
            </div>
            <button class="link-btn" onClick={() => setShowMore((v) => !v)}>
              {showMore ? '▾' : '▸'} 補充例句與頁碼
            </button>
            {showMore && (
              <div style={{ display: 'grid', gap: '8px', marginTop: '6px' }}>
                <input class="text-input" placeholder="例句 / 補充語境" value={example}
                  onInput={(e) => setExample((e.currentTarget as HTMLInputElement).value)} />
                <input class="text-input" placeholder="頁碼" value={page}
                  onInput={(e) => setPage((e.currentTarget as HTMLInputElement).value)} />
              </div>
            )}
          </>
        )}

        {!isReading && gcfg.fields.map((f) => (
          <div style={{ marginTop: '12px' }}>
            <span class="field-label">{f.label}</span>
            {f.type === 'duration' ? (
              <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <Stepper label={`${f.label}小時`} value={Math.floor((values[f.key] ?? 0) / 60)} step={1} unit="時"
                  onChange={(h) => setValues((v) => ({ ...v, [f.key]: h * 60 + ((v[f.key] ?? 0) % 60) }))} />
                <Stepper label={`${f.label}分鐘`} value={(values[f.key] ?? 0) % 60} step={5} unit="分"
                  onChange={(m) => setValues((v) => ({ ...v, [f.key]: Math.floor((v[f.key] ?? 0) / 60) * 60 + Math.min(59, m) }))} />
              </span>
            ) : (
              <Stepper label={f.label} value={values[f.key] ?? 0} step={f.step ?? 1} unit={f.unit}
                onChange={(n) => setValues((v) => ({ ...v, [f.key]: n }))} />
            )}
          </div>
        ))}

        {!isReading && gcfg.has_text && (
          <div style={{ marginTop: '12px' }}>
            <label class="field-label" for="txt">{gcfg.fields.length ? '備註' : '內容'}</label>
            <textarea id="txt" class="text-input" value={text}
              style={gcfg.fields.length ? { minHeight: '72px' } : undefined}
              onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
          </div>
        )}
      </div>

      {editing && (
        <div class="btn-row"><button class="link-btn danger" onClick={remove}>刪除這筆紀錄</button></div>
      )}

      <div class="section-title"><span>歷史</span><span>{entries.length} 則</span></div>
      {entries.length === 0 ? (
        <div class="empty">還沒有紀錄。</div>
      ) : (
        <ul class="history">
          {entries.slice(0, 40).map((e) => (
            <li>
              <button onClick={() => nav.go({ name: 'simple', habitId, entryId: e.log_id })}>
                <span class="date">{shortDate(e.local_date)}</span>
                <span>
                  {isReading && <span class="tag">{nameOf(e.container_id)}</span>}
                  {e.summary_text || '（無內容）'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
