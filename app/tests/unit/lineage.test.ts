import { describe, expect, it } from 'vitest';
import { MARKET_GENERATION, offspringLineage, pairDistanceFor } from '../../src/domain/lineage.ts';

describe('配對距離（需求規格 4.3）', () => {
  it('產出 1 代是起點沒有距離；2、5、8 代為 1，3、6、9 代為 2，4、7、10 代為 4', () => {
    expect(pairDistanceFor(1)).toBeUndefined();
    expect([2, 5, 8].map((generation) => pairDistanceFor(generation))).toEqual([1, 1, 1]);
    expect([3, 6, 9].map((generation) => pairDistanceFor(generation))).toEqual([2, 2, 2]);
    expect([4, 7, 10].map((generation) => pairDistanceFor(generation))).toEqual([4, 4, 4]);
  });

  it('產出代數不是 2 以上的整數時沒有距離', () => {
    expect(pairDistanceFor(0)).toBeUndefined();
    expect(pairDistanceFor(2.5)).toBeUndefined();
  });
});

describe('產駒的系與代數（需求規格 8.2）', () => {
  it('[LINE-28] 第 2 系零代 × 第 1 系 1 代母馬 = 第 2 系 2 代；第 1 系 1 代 × 市場母馬 = 第 1 系 2 代', () => {
    expect(offspringLineage({ position: 2, generation: 0 }, 1)).toEqual({
      position: 2,
      generation: 2,
    });
    expect(offspringLineage({ position: 1, generation: 1 }, MARKET_GENERATION)).toEqual({
      position: 1,
      generation: 2,
    });
  });

  it('第 1 系零代 × 起點市場母馬 = 第 1 系 1 代；代數取父母較大者加 1，系位置只看父馬', () => {
    expect(offspringLineage({ position: 1, generation: 0 }, MARKET_GENERATION)).toEqual({
      position: 1,
      generation: 1,
    });
    expect(offspringLineage({ position: 3, generation: 5 }, 6)).toEqual({
      position: 3,
      generation: 7,
    });
  });
});
