import { useState } from 'preact/hooks';
import { db } from '../data/db';
import { createHabit } from '../data/repo';
import type { CategoryTab, EngineType, GenericConfig, GenericField, Habit, HabitConfig, IsoWeekday, ReadingConfig } from '../data/types';
import { benchRoute } from '../ui/routes';
import { Seg, useNav, WeekdayChips } from '../ui/kit';

type Kind = 'TEXT' | 'NUMBERS' | 'NOTES';

const ICONS = ['📝', '🍷', '🍵', '🎸', '🧘', '🏃', '🚴', '🏊', '💊', '🎮', '📷', '💰', '🌱', '🧠'];

interface FieldDraft {
  label: string;
  unit: string;
  type: GenericField['type'];
}

/** 「＋新分類」：建立新的追蹤或紀錄項目 (預設掛載 2.0-D 通用引擎) */
export function NewHabitSheet({ tab: initialTab, onClose }: { tab: CategoryTab; onClose: () => void }) {
  const nav = useNav();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📝');
  const [tab, setTab] = useState<CategoryTab>(initialTab);
  const [kind, setKind] = useState<Kind>('TEXT');
  const [days, setDays] = useState<IsoWeekday[]>([]);
  const [fields, setFields] = useState<FieldDraft[]>([{ label: '', unit: '', type: 'number' }]);
  const [containerLabel, setContainerLabel] = useState('');
  const [template, setTemplate] = useState('');

  const setField = (i: number, patch: Partial<FieldDraft>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const create = async () => {
    const n = name.trim();
    if (!n) return nav.toast('請輸入名稱');
    if (tab === 'TRACK' && days.length === 0) return nav.toast('請至少選一個排程日');

    let engine: EngineType = 'GENERIC';
    let config: HabitConfig;
    if (kind === 'NOTES') {
      engine = 'READING';
      config = { max_chars: 100 } satisfies ReadingConfig;
    } else {
      const usable = kind === 'NUMBERS' ? fields.filter((f) => f.label.trim()) : [];
      if (kind === 'NUMBERS' && usable.length === 0) return nav.toast('請至少填一個數值欄位名稱');
      config = {
        fields: usable.map((f, i) => ({
          key: `f${i + 1}`,
          label: f.label.trim(),
          type: f.type,
          ...(f.type === 'number' && f.unit.trim() && { unit: f.unit.trim() }),
          ...(f.type === 'number' && { step: 1 }),
        })),
        has_text: true,
        ...(containerLabel.trim() && { container_label: containerLabel.trim() }),
      } satisfies GenericConfig;
    }

    const habit: Habit = await createHabit(
      db,
      {
        name: n,
        icon: icon.trim() || '📝',
        category_tab: tab,
        engine_type: engine,
        schedule_days: tab === 'TRACK' ? days : [],
        weekly_target: tab === 'TRACK' ? days.length : 0,
        config,
        last_state: kind === 'TEXT' && template.trim() ? { template: template.trim() + '\n' } : null,
      },
      new Date(),
    );
    onClose();
    nav.toast(`已建立「${habit.name}」`);
    nav.go(benchRoute(habit));
  };

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="新增分類">
        <header class="topbar">
          <button class="icon-btn" onClick={onClose}>取消</button>
          <h1 style={{ fontSize: '18px' }}>新增分類</h1>
          <button class="icon-btn primary" onClick={create}>建立</button>
        </header>

        <div class="card">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input class="text-input" style={{ width: '3.4em', textAlign: 'center', flex: 'none' }} aria-label="圖示"
              value={icon} onInput={(e) => setIcon((e.currentTarget as HTMLInputElement).value)} />
            <input class="text-input" placeholder="名稱，例如：品酒、冥想" value={name}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </div>
          <div class="chips" style={{ marginTop: '8px' }}>
            {ICONS.map((i) => (
              <button type="button" class="chip" aria-pressed={icon === i} onClick={() => setIcon(i)}>{i}</button>
            ))}
          </div>
        </div>

        <div class="card">
          <span class="field-label">放在哪個分頁</span>
          <Seg<CategoryTab> value={tab} onChange={setTab} options={[['LOG', '🗂️ 紀錄 (隨手記)'], ['TRACK', '🎯 追蹤 (有排程)']]} />
          {tab === 'TRACK' && (
            <div style={{ marginTop: '12px' }}>
              <span class="field-label">排程日</span>
              <WeekdayChips value={days} onToggle={(d) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)))} />
            </div>
          )}
        </div>

        <div class="card">
          <span class="field-label">紀錄格式</span>
          <Seg<Kind> value={kind} onChange={setKind} options={[['TEXT', '文字'], ['NUMBERS', '數值＋備註'], ['NOTES', '短筆記']]} />
          <p class="field-label" style={{ marginTop: '8px' }}>
            {kind === 'TEXT' && '自由文字，下次會自動帶入上一次的段落格式。'}
            {kind === 'NUMBERS' && '用步進器記錄數值，例如距離、時間、次數。'}
            {kind === 'NOTES' && '100 字短筆記，依來源與標籤整理，並加入隨機喚醒。'}
          </p>

          {kind === 'TEXT' && (
            <textarea class="text-input" style={{ minHeight: '88px' }} placeholder={'初始格式 (選填)，例如：\n【酒款】\n【香氣】\n【感想】'}
              value={template} onInput={(e) => setTemplate((e.currentTarget as HTMLTextAreaElement).value)} />
          )}

          {kind === 'NUMBERS' && (
            <div style={{ display: 'grid', gap: '8px' }}>
              {fields.map((f, i) => (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input class="text-input" style={{ flex: '1 1 7em' }} placeholder="欄位名稱" value={f.label}
                    onInput={(e) => setField(i, { label: (e.currentTarget as HTMLInputElement).value })} />
                  <Seg<GenericField['type']> value={f.type} onChange={(t) => setField(i, { type: t })} options={[['number', '數字'], ['duration', '時間']]} />
                  {f.type === 'number' && (
                    <input class="text-input" style={{ width: '4.5em', flex: 'none' }} placeholder="單位" value={f.unit}
                      onInput={(e) => setField(i, { unit: (e.currentTarget as HTMLInputElement).value })} />
                  )}
                  {fields.length > 1 && (
                    <button class="link-btn danger" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}>移除</button>
                  )}
                </div>
              ))}
              <div class="btn-row" style={{ marginTop: 0 }}>
                <button class="link-btn" onClick={() => setFields((fs) => [...fs, { label: '', unit: '', type: 'number' }])}>＋ 欄位</button>
              </div>
            </div>
          )}

          {kind !== 'NOTES' && (
            <label style={{ display: 'block', marginTop: '12px' }}>
              <span class="field-label">下拉選單名稱 (選填，例如：路線、酒款)</span>
              <input class="text-input" value={containerLabel} onInput={(e) => setContainerLabel((e.currentTarget as HTMLInputElement).value)} />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
