import { useMemo, useRef, useState } from 'preact/hooks';
import { CoffeeBench } from './pages/CoffeeBench';
import { LogHome } from './pages/LogHome';
import { NewHabitSheet } from './pages/NewHabitSheet';
import { ManageSheet } from './pages/ManageSheet';
import { Settings } from './pages/Settings';
import { SimpleBench } from './pages/SimpleBench';
import { TrackHome } from './pages/TrackHome';
import { WorkoutBench } from './pages/WorkoutBench';
import { NavContext, type Nav, type Route } from './ui/kit';

export function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'track' }]);
  const [manageId, setManageId] = useState<string | null>(null);
  const [newTab, setNewTab] = useState<'TRACK' | 'LOG' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const nav = useMemo<Nav>(
    () => ({
      go: (r) => {
        setStack((s) => (r.name === 'track' || r.name === 'log' ? [r] : [...s, r]));
        window.scrollTo(0, 0);
      },
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      manage: (id) => setManageId(id),
      newHabit: (tab) => setNewTab(tab),
      toast: (msg) => {
        setToast(msg);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 2200);
      },
    }),
    [],
  );

  const route = stack[stack.length - 1];
  const isHome = route.name === 'track' || route.name === 'log';

  return (
    <NavContext.Provider value={nav}>
      {route.name === 'track' && <TrackHome />}
      {route.name === 'log' && <LogHome />}
      {route.name === 'workout' && <WorkoutBench key={route.entryId ?? 'new'} habitId={route.habitId} entryId={route.entryId} />}
      {route.name === 'settings' && <Settings />}
      {route.name === 'coffee' && <CoffeeBench key={route.entryId ?? 'new'} habitId={route.habitId} entryId={route.entryId} />}
      {route.name === 'simple' && <SimpleBench key={route.entryId ?? 'new'} habitId={route.habitId} entryId={route.entryId} />}

      {isHome && (
        <nav class="tabbar" aria-label="視角">
          <button aria-current={route.name === 'track' ? 'page' : undefined} onClick={() => nav.go({ name: 'track' })}>
            🎯 追蹤
          </button>
          <button aria-current={route.name === 'log' ? 'page' : undefined} onClick={() => nav.go({ name: 'log' })}>
            🗂️ 紀錄
          </button>
        </nav>
      )}

      {manageId && <ManageSheet habitId={manageId} onClose={() => setManageId(null)} />}
      {newTab && <NewHabitSheet tab={newTab} onClose={() => setNewTab(null)} />}
      {toast && (
        <div class={`toast${isHome && !manageId && !newTab ? '' : ' low'}`} role="status">
          {toast}
        </div>
      )}
    </NavContext.Provider>
  );
}
