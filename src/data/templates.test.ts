import { describe, expect, it } from 'vitest';
import { createDB } from './db';
import { findBoundContainer, listContainers, listHabits } from './repo';
import { seedTemplates } from './templates';

describe('通用範本', () => {
  it('只建立勾選的項目，重訓三份課表綁週一三五', async () => {
    const db = createDB('tpl-1');
    await seedTemplates(db, ['workout', 'coffee']);
    const hs = await listHabits(db);
    expect(hs.map((h) => h.name)).toEqual(['重訓', '咖啡']);
    const gym = hs[0];
    expect((await findBoundContainer(db, gym.habit_id, 3))?.name).toBe('拉（背二頭）');
    expect(await listContainers(db, hs[1].habit_id)).toEqual([]);
  });
  it('不包含個人化內容', async () => {
    const db = createDB('tpl-2');
    await seedTemplates(db, ['workout', 'reading', 'english', 'cardio', 'coffee', 'diary']);
    const names = (await db.containers.toArray()).map((c) => c.name).join(',');
    expect(names).not.toMatch(/巴拉卡|環台北|背腹|超級思維|雜訊|耶加雪菲/);
    expect((await listHabits(db)).length).toBe(6);
  });
});
