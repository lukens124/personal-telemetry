/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register';

/**
 * iOS 主畫面 App 從背景切回時不會重新載入頁面，因此不會自動檢查新版。
 * 這裡在開啟、回到前景、以及每小時主動檢查；有新版時自動套用並重新載入。
 */
export function setupPwaUpdates() {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine !== false) void reg.update().catch(() => undefined);
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 60 * 60 * 1000);
    },
  });
}
