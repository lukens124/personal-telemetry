import type { CoffeeConfig, CoffeeMode, CoffeePayload, Container, HabitLog } from '../data/types';

export const COFFEE_BASE: Record<CoffeeMode, Omit<CoffeePayload, 'grinder'>> = {
  POUR_OVER: { temp_c: 92, grind: 24, ratio: 15 },
  ESPRESSO: { temp_c: 93, grind: 10, dose_g: 18, yield_g: 36, time_s: 28 },
};

export const FLAVOR_PRESETS = ['花香', '柑橘', '莓果', '核果', '茶感', '焦糖', '堅果', '巧克力', '酒香', '發酵', '酸亮', '甜感', '苦', '澀'];

/**
 * 咖啡工作台預填 (Smart Defaults)
 *  1. 同一支豆、同一模式的上一筆 → 沿用全部參數 (評分、風味、備註除外)
 *  2. 同模式的上一筆 → 沿用沖煮參數
 *  3. 豆子的預設值 (default_payload) 或模式基準值
 * 磨豆機：沿用上一筆，否則用該模式的預設磨豆機。
 */
export function coffeeDefaults(
  entries: HabitLog[], // 新 → 舊
  container: Container | null,
  mode: CoffeeMode,
  cfg: CoffeeConfig,
): CoffeePayload {
  const sameMode = entries.filter((e) => e.sub_mode === mode);
  const prev =
    (container && sameMode.find((e) => e.container_id === container.container_id)) ?? sameMode[0] ?? null;
  const grinderDefault = cfg.default_grinder[mode] ?? cfg.grinders[0] ?? '';

  if (prev?.payload) {
    const { rating: _r, flavors: _f, note: _n, ...params } = prev.payload as unknown as CoffeePayload;
    return { ...params, grinder: params.grinder || grinderDefault };
  }
  const beanDefault = container?.default_payload as Partial<CoffeePayload> | null | undefined;
  const base = { ...COFFEE_BASE[mode] };
  // 豆子預設值只套用在相同模式 (手沖的刻度不適用義式)
  if (beanDefault && (!container?.sub_mode || container.sub_mode === mode)) {
    // 只取與模式相容的欄位
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      if (beanDefault[k] != null) (base as Record<string, unknown>)[k] = beanDefault[k];
    }
  }
  return { ...base, grinder: grinderDefault };
}
