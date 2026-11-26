import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { VitePWA } from 'vite-plugin-pwa';

const gitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();
const buildTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

// GitHub Pages 網址為 /personal-telemetry/
const base = process.env.BASE_PATH ?? '/personal-telemetry/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(`${gitHash} · ${buildTime}`),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // 由 src/pwa.ts 註冊，才能在回到前景時檢查更新
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: '個人日常遙測',
        short_name: '遙測',
        lang: 'zh-Hant-TW',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0D1A2B',
        theme_color: '#0D1A2B',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg}'] },
    }),
  ],
});
