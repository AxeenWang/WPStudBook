import { describe, expect, it } from 'vitest';
import {
  checkLineageAgainstRule,
  checkPedigree,
  estimateActivation,
  isActivationEstablished,
  pedigreeNotices,
  pedigreeWarningCodes,
  type AncestorNode,
  type AncestorTree,
} from '../../src/domain/pedigree-check.ts';

function ancestor(parentSystem: string | undefined, buildingPhaseMarket = false): AncestorNode {
  return { horseId: `h-${parentSystem ?? 'x'}`, parentSystem, buildingPhaseMarket };
}

/** 八系親系統互不相同的理想情形（需求規格 4.3）。 */
function eightSystems(): AncestorNode[] {
  return [
    'エクリプス',
    'ヘロド',
    'マッチェム',
    'ファラリス',
    'ネアルコ',
    'ハイペリオン',
    'セントサイモン',
    'テディ',
  ].map((system) => ancestor(system));
}

function tree(overrides: Partial<AncestorTree> = {}): AncestorTree {
  return {
    greatGrandparents: eightSystems(),
    duplicateAncestors: [],
    unlinkedAncestors: 0,
    buildingPhaseGaps: 0,
    ...overrides,
  };
}

describe('活血種數預估（需求規格 4.3、10.2）', () => {
  it('3 代前 8 匹祖先的親系統互不相同時為 8 種', () => {
    expect(estimateActivation(eightSystems())).toBe(8);
  });

  it('親系統重複時種數變少', () => {
    const ancestors = eightSystems();
    ancestors[7] = ancestor('エクリプス');
    expect(estimateActivation(ancestors)).toBe(7);
  });

  it('查不到親系統或位置空白時不計入種類', () => {
    const ancestors: (AncestorNode | undefined)[] = [
      ancestor('エクリプス'),
      ancestor(undefined),
      ancestor(''),
      undefined,
    ];
    expect(estimateActivation(ancestors)).toBe(1);
  });

  it('血脈活性化以 6 種為門檻，只用於顯示', () => {
    expect([5, 6, 8].map((count) => isActivationEstablished(count))).toEqual([false, true, true]);
    expect(isActivationEstablished(undefined)).toBe(false);
  });
});

describe('血統檢查（需求規格 10.1、10.2）', () => {
  it('[PED-01] 建系期不計算活血，也不因市場馬血統不完整警告', () => {
    const check = checkPedigree('building', tree({ unlinkedAncestors: 4, buildingPhaseGaps: 2 }));
    expect(check.evaluated).toBe(false);
    expect(check.activationCount).toBeUndefined();
    expect(check.insufficientPedigree).toBe(false);
    expect(pedigreeWarningCodes(check)).toEqual([]);
  });

  // PED-02 要求依 7.3 建系並循環到產出 6 代，需子計畫 3-3 的長期模擬才算驗證；這裡只固定計算方式。
  it('八系親系統互不相同、無重複也無缺漏時預估 8 種，不警告', () => {
    const check = checkPedigree('cycling', tree());
    expect(check.activationCount).toBe(8);
    expect(check.duplicateAncestors).toEqual([]);
    expect(check.insufficientPedigree).toBe(false);
    expect(pedigreeWarningCodes(check)).toEqual([]);
  });

  it('[PED-03] 補入親系統不同的市場母馬使預估低於 8 種時警告', () => {
    const ancestors = eightSystems();
    ancestors[7] = ancestor('エクリプス');
    const check = checkPedigree('cycling', tree({ greatGrandparents: ancestors }));
    expect(check.activationCount).toBe(7);
    expect(pedigreeWarningCodes(check)).toEqual(['activationBelowFull']);
  });

  it('[PED-04] 4 代內有重複的馬時警告', () => {
    const check = checkPedigree('cycling', tree({ duplicateAncestors: ['horse-1'] }));
    expect(check.duplicateAncestors).toEqual(['horse-1']);
    expect(pedigreeWarningCodes(check)).toEqual(['duplicateAncestors']);
  });

  it('[PED-05] 血統資料不足時警告，不阻止', () => {
    const check = checkPedigree('cycling', tree({ unlinkedAncestors: 2 }));
    expect(check.insufficientPedigree).toBe(true);
    expect(check.gapsOnlyFromBuildingPhase).toBe(false);
    expect(pedigreeWarningCodes(check)).toEqual(['insufficientPedigree']);
  });

  it('[PED-11] 資料不足只因建系期市場馬時只提示，含其他未連結的馬時仍需確認', () => {
    const onlyMarket = checkPedigree('cycling', tree({ buildingPhaseGaps: 3 }));
    expect(onlyMarket.insufficientPedigree).toBe(true);
    expect(onlyMarket.gapsOnlyFromBuildingPhase).toBe(true);
    expect(pedigreeWarningCodes(onlyMarket)).toEqual([]);
    expect(pedigreeNotices(onlyMarket)).toHaveLength(1);

    const mixed = checkPedigree('cycling', tree({ buildingPhaseGaps: 3, unlinkedAncestors: 1 }));
    expect(mixed.gapsOnlyFromBuildingPhase).toBe(false);
    expect(pedigreeWarningCodes(mixed)).toEqual(['insufficientPedigree']);
    expect(pedigreeNotices(mixed)).toEqual([]);
  });

  it('多項同時成立時全部列出', () => {
    const ancestors = eightSystems();
    ancestors[0] = ancestor('ネアルコ');
    const check = checkPedigree(
      'cycling',
      tree({ greatGrandparents: ancestors, duplicateAncestors: ['horse-1'], unlinkedAncestors: 1 }),
    );
    expect(pedigreeWarningCodes(check)).toEqual([
      'activationBelowFull',
      'duplicateAncestors',
      'insufficientPedigree',
    ]);
  });
});

describe('系與代數檢查（需求規格 10.3）', () => {
  it('符合規則時沒有不符', () => {
    expect(
      checkLineageAgainstRule(
        'sire',
        { position: 1, generation: 5 },
        { position: 1, generation: 5 },
      ),
    ).toBeUndefined();
  });

  it('[PED-06][LINE-34] 系別不符時指出正確的系', () => {
    const mismatch = checkLineageAgainstRule(
      'dam',
      { position: 3, generation: 5 },
      { position: 2, generation: 5 },
    );
    expect(mismatch).toEqual({
      side: 'dam',
      kind: 'position',
      expected: { position: 3, generation: 5 },
      actual: { position: 2, generation: 5 },
    });
  });

  it('[PED-07][LINE-27] 代數不符時指出正確的代數', () => {
    const mismatch = checkLineageAgainstRule(
      'dam',
      { position: 1, generation: 2 },
      { position: 1, generation: 1 },
    );
    expect(mismatch).toEqual({
      side: 'dam',
      kind: 'generation',
      expected: { position: 1, generation: 2 },
      actual: { position: 1, generation: 1 },
    });
  });

  it('沒有系與代數的馬也阻止', () => {
    const mismatch = checkLineageAgainstRule('sire', { position: 1, generation: 5 }, undefined);
    expect(mismatch?.kind).toBe('unknown');
    expect(mismatch?.expected).toEqual({ position: 1, generation: 5 });
  });

  it('系錯時先回報系位置，不先報代數', () => {
    const mismatch = checkLineageAgainstRule(
      'sire',
      { position: 1, generation: 5 },
      { position: 4, generation: 9 },
    );
    expect(mismatch?.kind).toBe('position');
  });
});
