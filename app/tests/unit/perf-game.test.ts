import { describe, expect, it } from 'vitest';
import { buildPerfGame } from '../../scripts/lib/perf-game.ts';
import { validateCollections } from '../../src/storage/backup/collections.ts';

describe('效能量測用的合成遊戲局', () => {
  it('產生的資料通過備份的資料契約驗證，筆數達到目標且分布接近長期遊玩', () => {
    const perf = buildPerfGame(10_000);
    const validation = validateCollections(perf.collections);
    expect(validation.ok ? [] : validation.issues.map((item) => item.message)).toEqual([]);
    expect(perf.recordCount).toBeGreaterThanOrEqual(10_000);
    expect(perf.recordCount).toBeLessThan(11_500);
    const { collections } = perf;
    // 種牡馬年度快照與事件佔多數。
    expect(collections.stallionYearly.length + collections.events.length).toBeGreaterThan(
      perf.recordCount / 2,
    );
    expect(perf.game.currentYear).toBeGreaterThan(perf.game.startYear);
    expect(perf.ownFillies.length).toBeGreaterThan(0);
    expect(collections.horses.some((horse) => horse.fullName === perf.searchKeyword)).toBe(true);
  });

  it('同樣的目標筆數產生同樣的資料', () => {
    expect(buildPerfGame(3_000)).toEqual(buildPerfGame(3_000));
  });
});
