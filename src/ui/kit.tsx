import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { WEEKDAY_LABELS } from '../data/dates';
import type { IsoWeekday } from '../data/types';

// ---------------------------------------------------------------- 導覽

export type Route =
  | { name: 'track' }
  | { name: 'log' }
  | { name: 'workout'; habitId: string; entryId?: string }
  | { name: 'simple'; habitId: string; entryId?: string }
  | { name: 'settings' };

export interface Nav {
  go: (r: Route) => void;
  back: () => void;
  manage: (habitId: string) => void;
  toast: (msg: string) => void;
}
export const NavContext = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavContext);

// ---------------------------------------------------------------- 觸覺回饋

/**
 * iOS Safari 不支援 navigator.vibrate。Safari 18+ 切換 <input switch> 會產生觸覺回饋，
 * 這是非官方做法，失效時靜默略過。
 */
export function haptic() {
  try {
    if (typeof navigator.vibrate === 'function' && navigator.vibrate(10)) return;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    label.style.display = 'none';
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch {
    /* 不支援就略過 */
  }
}

// ---------------------------------------------------------------- 整列手勢

export interface RowGestureHandlers {
  /** x 為點擊位置佔列寬的比例 (0~1) */
  onTap: (xRatio: number) => void;
  onSwipeLeft: () => void;
  onLongPress: () => void;
}

const SWIPE_THRESHOLD = 72;
const SWIPE_MAX = 110;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

/** 單擊 (區分左右熱區) / 左滑 / 長按，垂直捲動交給瀏覽器 */
export function useRowGesture(h: RowGestureHandlers) {
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const st = useRef({ x: 0, y: 0, active: false, moved: false, horiz: false, long: false, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const hRef = useRef(h);
  hRef.current = h;

  const clear = () => clearTimeout(st.current.timer);

  const onPointerDown = (e: PointerEvent) => {
    const s = st.current;
    Object.assign(s, { x: e.clientX, y: e.clientY, active: true, moved: false, horiz: false, long: false });
    clear();
    s.timer = setTimeout(() => {
      if (!s.moved) {
        s.long = true;
        haptic();
        hRef.current.onLongPress();
      }
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = st.current;
    if (!s.active) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.moved && (Math.abs(mx) > MOVE_TOLERANCE || Math.abs(my) > MOVE_TOLERANCE)) {
      s.moved = true;
      clear();
      s.horiz = Math.abs(mx) > Math.abs(my);
      if (s.horiz) {
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else {
        s.active = false; // 垂直捲動
      }
    }
    if (s.horiz) setDx(Math.max(-SWIPE_MAX, Math.min(0, mx)));
  };

  const finish = (e: PointerEvent, cancelled = false) => {
    const s = st.current;
    clear();
    if (!s.active) return;
    s.active = false;
    setDragging(false);
    if (cancelled) {
      setDx(0);
      return;
    }
    if (s.horiz) {
      const mx = e.clientX - s.x;
      setDx(0);
      if (mx <= -SWIPE_THRESHOLD) {
        haptic();
        hRef.current.onSwipeLeft();
      }
      return;
    }
    if (!s.moved && !s.long && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      hRef.current.onTap((e.clientX - rect.left) / rect.width);
    }
  };

  useEffect(() => clear, []);

  return {
    ref,
    dx,
    dragging,
    revealed: dx <= -SWIPE_THRESHOLD,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: PointerEvent) => finish(e),
      onPointerCancel: (e: PointerEvent) => finish(e, true),
      onContextMenu: (e: Event) => e.preventDefault(),
    },
  };
}

// ---------------------------------------------------------------- 元件

export function Stepper(props: {
  value: number;
  step: number;
  min?: number;
  unit?: string;
  onChange: (v: number) => void;
  label: string;
}) {
  const { value, step, min = 0, unit, onChange, label } = props;
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <span class="stepper">
      <button type="button" aria-label={`${label}減少`} onClick={() => onChange(Math.max(min, round(value - step)))}>
        −
      </button>
      <input
        inputMode="decimal"
        aria-label={label}
        value={String(value)}
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        onChange={(e) => {
          const v = parseFloat((e.currentTarget as HTMLInputElement).value);
          onChange(Number.isFinite(v) ? Math.max(min, v) : min);
        }}
      />
      <button type="button" aria-label={`${label}增加`} onClick={() => onChange(round(value + step))}>
        +
      </button>
      {unit && <span class="unit">{unit}</span>}
    </span>
  );
}

export function WeekdayChips(props: {
  value: IsoWeekday[];
  onToggle: (d: IsoWeekday) => void;
  disabled?: IsoWeekday[];
}) {
  return (
    <div class="chips" role="group">
      {WEEKDAY_LABELS.map((lbl, i) => {
        const d = (i + 1) as IsoWeekday;
        return (
          <button
            type="button"
            class="chip"
            aria-pressed={props.value.includes(d)}
            disabled={props.disabled?.includes(d)}
            onClick={() => props.onToggle(d)}
          >
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="group">
      {props.options.map(([v, lbl]) => (
        <button type="button" aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {lbl}
        </button>
      ))}
    </div>
  );
}

/** [🕒現在▾]：可改成補登時間 */
export function TimePicker(props: { value: Date | null; onChange: (d: Date | null) => void }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = props.value ?? new Date();
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return (
    <label class="field-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
      <span>🕒</span>
      {props.value === null ? (
        <button type="button" class="link-btn" onClick={() => props.onChange(new Date())}>
          現在 ▾
        </button>
      ) : (
        <input
          class="text-input"
          style={{ minHeight: '36px', padding: '4px 8px', width: 'auto' }}
          type="datetime-local"
          value={local}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            props.onChange(v ? new Date(v) : null);
          }}
        />
      )}
    </label>
  );
}

export function shortDate(ld: string) {
  const [, m, d] = ld.split('-');
  return `${Number(m)}/${Number(d)}`;
}
