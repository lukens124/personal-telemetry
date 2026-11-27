/**
 * 裝置配對：把雲端網址 + Token 包成一個連結 (…/personal-telemetry/#pair=<code>)。
 * 打開連結、或在設定頁貼上連結 / 配對碼，就會自動連線並從雲端還原。
 */
import type { SyncConfig } from './sync';

const GAS_URL = /^https:\/\/script\.google\.com\/.+\/exec$/;

const b64url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
};

export function encodePairing(cfg: SyncConfig): string {
  return b64url(JSON.stringify({ u: cfg.url, t: cfg.token }));
}

export function pairingLink(cfg: SyncConfig, base = `${location.origin}${import.meta.env.BASE_URL}`): string {
  return `${base}#pair=${encodePairing(cfg)}`;
}

/** 接受完整連結、#pair=… 或單純的配對碼；無效回傳 null */
export function parsePairing(text: string): SyncConfig | null {
  const raw = text.trim();
  if (!raw) return null;
  const m = raw.match(/pair=([A-Za-z0-9_-]+)/);
  const code = m ? m[1] : raw;
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const o = JSON.parse(unb64url(code)) as { u?: unknown; t?: unknown };
    if (typeof o.u !== 'string' || typeof o.t !== 'string' || !GAS_URL.test(o.u) || !o.t) return null;
    return { url: o.u, token: o.t };
  } catch {
    return null;
  }
}

/** 開機時：網址帶 #pair= 就取出設定並把它從網址列清掉 (避免留在瀏覽紀錄或被分享出去) */
export function takePairingFromUrl(): SyncConfig | null {
  if (!location.hash.startsWith('#pair=')) return null;
  const cfg = parsePairing(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  return cfg;
}
