import { describe, expect, it } from 'vitest';
import { encodePairing, pairingLink, parsePairing } from './pair';

const cfg = { url: 'https://script.google.com/macros/s/AKfycbx-ABC_123/exec', token: '1234abcd5678ef90' };

describe('裝置配對', () => {
  it('連結、#pair= 與配對碼都能還原同一組設定', () => {
    const link = pairingLink(cfg, 'https://lukens124.github.io/personal-telemetry/');
    expect(link.startsWith('https://lukens124.github.io/personal-telemetry/#pair=')).toBe(true);
    expect(parsePairing(link)).toEqual(cfg);
    expect(parsePairing(`#pair=${encodePairing(cfg)}`)).toEqual(cfg);
    expect(parsePairing(`  ${encodePairing(cfg)}\n`)).toEqual(cfg);
  });
  it('無效內容回傳 null', () => {
    expect(parsePairing('')).toBeNull();
    expect(parsePairing('hello world')).toBeNull();
    expect(parsePairing(encodePairing({ url: 'https://evil.example/exec', token: 'x' }))).toBeNull();
  });
});
