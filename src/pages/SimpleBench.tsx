/**
 * Page 2.0-C 閱讀/語言 (READING) 與 Page 2.0-D 通用 (GENERIC) 工作台。
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../data/db';
import { createContainer, deleteEntry, listContainers, listEntries, saveEntry, updateEntry } from '../data/repo';
import type { Container, GenericConfig, GenericPayload, HabitLog, NoteNature, ReadingConfig, ReadingPayload } from '../data/types';
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
  const [tags, setTags] = useState<string[]>([]);
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
        setTags(p.tags ?? []);
        setShowMore(!!(p.example || p.page || p.tags?.length));
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

  const addContainer = async () => {
    const name = prompt(`新增${containerLabel ?? '分類'}名稱`)?.trim();
    if (!name) return;
    const c = await createContainer(db, { habit_id: habit.habit_id, name }, new Date());
    setContainerId(c.container_id);
  };

  const buildPayload = (): Record<string, unknown> | null => {
    if (isReading) {
      if (!text.trim()) return null;
      const p: ReadingPayload = {
        nature,
        text: text.trim(),
        ...(example.trim() && { example: example.trim() }),
        ...(page.trim() && { page: page.trim() }),
        ...(tags.length && { tags }),
      };
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
  const knownTags = [...new Set(entries.flatMap((e) => (e.payload as unknown as ReadingPayload | null)?.tags ?? []))];
  const tagChoices = [...knownTags, ...tags.filter((t) => !knownTags.includes(t))];
  const addTag = () => {
    const t = prompt('新增主題標籤')?.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) setTags((xs) => [...xs, t]);
  };

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
              {showMore ? '▾' : '▸'} 補充例句、頁碼與標籤{tags.length ? `（${tags.map((t) => `#${t}`).join(' ')}）` : ''}
            </button>
            {showMore && (
              <div style={{ display: 'grid', gap: '8px', marginTop: '6px' }}>
                <input class="text-input" placeholder="例句 / 補充語境" value={example}
                  onInput={(e) => setExample((e.currentTarget as HTMLInputElement).value)} />
                <input class="text-input" placeholder="頁碼" value={page}
                  onInput={(e) => setPage((e.currentTarget as HTMLInputElement).value)} />
                <div class="chips" aria-label="主題標籤">
                  {tagChoices.map((t) => (
                    <button type="button" class="chip" aria-pressed={tags.includes(t)}
                      onClick={() => setTags((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]))}>
                      #{t}
                    </button>
                  ))}
                  <button type="button" class="chip" onClick={addTag}>＋ 標籤</button>
                </div>
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

      {isReading ? (
        <ReadingHistory entries={entries} containers={all} onOpen={(id) => nav.go({ name: 'simple', habitId, entryId: id })} />
      ) : (
        <>
          <div class="section-title"><span>歷史</span><span>{entries.length} 則</span></div>
          {entries.length === 0 ? (
            <div class="empty">還沒有紀錄。</div>
          ) : (
            <ul class="history">
              {entries.slice(0, 60).map((e) => (
                <li>
                  <button onClick={() => nav.go({ name: 'simple', habitId, entryId: e.log_id })}>
                    <span class="date">{shortDate(e.local_date)}</span>
                    <span>{e.summary_text || '（無內容）'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

const NATURE_ICON: Record<NoteNature, string> = { INSIGHT: '💡', STATUS: '📌', CHUNK: '🗣️' };

/** 2.0-C 下方：📖 依書櫃 / 🏷️ 依主題 雙視角 */
function ReadingHistory(props: { entries: HabitLog[]; containers: Container[]; onOpen: (id: string) => void }) {
  const { entries, containers, onOpen } = props;
  const [view, setView] = useState<'SHELF' | 'TAG'>('SHELF');
  const [open, setOpen] = useState<Set<string>>(() => new Set(containers.filter((c) => c.status === 'ACTIVE').slice(0, 1).map((c) => c.container_id)));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const groups: { key: string; title: string; section?: string; items: HabitLog[] }[] = [];
  if (view === 'SHELF') {
    for (const status of ['ACTIVE', 'ARCHIVED'] as const) {
      for (const c of containers.filter((x) => x.status === status)) {
        const items = entries.filter((e) => e.container_id === c.container_id);
        if (status === 'ARCHIVED' && items.length === 0) continue;
        groups.push({ key: c.container_id, title: c.name, section: status === 'ACTIVE' ? '進行中' : '已封存', items });
      }
    }
  } else {
    const byTag = new Map<string, HabitLog[]>();
    for (const e of entries) {
      const tags = (e.payload as unknown as ReadingPayload | null)?.tags ?? [];
      for (const t of tags.length ? tags : ['（未加標籤）']) byTag.set(t, [...(byTag.get(t) ?? []), e]);
    }
    for (const [t, items] of [...byTag.entries()].sort((a, b) => b[1].length - a[1].length)) {
      groups.push({ key: `#${t}`, title: t.startsWith('（') ? t : `#${t}`, items });
    }
  }

  let lastSection = '';
  return (
    <>
      <div class="section-title">
        <Seg<'SHELF' | 'TAG'> value={view} onChange={setView} options={[['SHELF', '📖 依書櫃'], ['TAG', '🏷️ 依主題']]} />
        <span>{entries.length} 則</span>
      </div>
      {entries.length === 0 && groups.length === 0 && <div class="empty">還沒有筆記。</div>}
      {groups.map((g) => {
        const head = g.section && g.section !== lastSection ? <div class="field-label" style={{ marginTop: '12px' }}>【{g.section}】</div> : null;
        lastSection = g.section ?? lastSection;
        const isOpen = open.has(g.key);
        return (
          <>
            {head}
            <div class="shelf">
              <button class="shelf-head" aria-expanded={isOpen} onClick={() => toggle(g.key)}>
                <span>{isOpen ? '▾' : '▸'} {g.title}</span>
                <span class="field-label" style={{ margin: 0 }}>{g.items.length} 則</span>
              </button>
              {isOpen && (
                <ul class="history">
                  {g.items.length === 0 && <li class="field-label" style={{ padding: '8px 2px' }}>還沒有筆記。</li>}
                  {g.items.map((e) => {
                    const p = e.payload as unknown as ReadingPayload;
                    return (
                      <li>
                        <button onClick={() => onOpen(e.log_id)}>
                          <span class="date">{shortDate(e.local_date)}</span>
                          <span>{NATURE_ICON[p.nature] ?? ''} {p.text}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        );
      })}
    </>
  );
}
