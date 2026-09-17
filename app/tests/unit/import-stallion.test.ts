import { describe, expect, it } from 'vitest';
import { parseImportFile, type SourceRow } from '../../src/import/parse.ts';
import { hasPrefixOnlyName, readStallionRow } from '../../src/import/stallion.ts';
import { buildSampleBytes, syntheticSample } from '../../scripts/lib/synthetic-samples.ts';

function stallionRows(id: string): SourceRow[] {
  const sample = syntheticSample(id);
  const result = parseImportFile(buildSampleBytes(sample), sample.formatId);
  if (!result.ok) {
    throw new Error(`${id} 解析失敗：${result.problems.join('；')}`);
  }
  return [...result.file.rows];
}

function rowAt(id: string, index: number): SourceRow {
  const row = stallionRows(id)[index];
  if (row === undefined) {
    throw new Error(`${id} 沒有第 ${String(index + 1)} 筆資料列`);
  }
  return row;
}

describe('種牡馬總表的欄位讀取（需求規格 11.8、附錄 A.4）', () => {
  it('[STL-08] 依位置取值，父系去掉結尾「系」，千分位逗號不影響數值', () => {
    const values = readStallionRow(rowAt('mayStallions', 0));
    expect(values).toMatchObject({
      lineNumber: 2,
      fullName: 'テストウマ001',
      baseName: 'テストウマ001',
      country: '日',
      age: 8,
      sp: 95,
      st: 88,
      subParamTotal: 45,
      kodashi: 8,
      turf: '◎',
      dirt: '○',
      distanceText: '中距離',
      sireName: 'テストウマ900',
      sireSubsystem: 'エクリプス',
      damName: 'テストメス900',
      femaleLine: 'テスト牝系',
      studFee: 2450,
      farmNo: 12,
      active: '○',
    });
    expect(values.subParams).toEqual({
      power: 'B',
      quickness: 'A',
      guts: 'B',
      flexibility: 'C',
      spirit: 'B',
      wisdom: 'A',
      health: 'B',
    });
  });

  it('[ID-12] 能力番号與馬番号讀成整數，`0x0000` 是有效值', () => {
    const values = readStallionRow(rowAt('mayStallions', 0));
    expect(values.abilityNo).toBe(0);
    expect(values.horseNo).toBe(0);
    expect(readStallionRow(rowAt('mayStallions', 1)).abilityNo).toBe(0x0101);
  });

  it('[STL-11] 戦績欄讀成整數，未取得的欄位不存成零', () => {
    expect(readStallionRow(rowAt('mayStallions', 0)).record).toEqual({
      starts: 18,
      wins: 9,
      earnings: 312500,
      gradedWins: 4,
      g1Wins: 2,
    });
    // 第 2 筆沒有 G1 勝，第 3 筆整組留白。
    expect(readStallionRow(rowAt('mayStallions', 1)).record).toEqual({
      starts: 12,
      wins: 5,
      earnings: 88000,
      gradedWins: 1,
    });
    expect(readStallionRow(rowAt('mayStallions', 2)).record).toEqual({});
    expect(readStallionRow(rowAt('mayStallions', 2)).studFee).toBeUndefined();
  });

  it('[STL-08] `牧場` 不套用範圍檢查，日本以外的番号照樣讀出來', () => {
    expect(readStallionRow(rowAt('mayStallions', 1)).farmNo).toBe(240);
    expect(readStallionRow(rowAt('mayStallions', 2)).farmNo).toBe(260);
  });

  it('馬名保留 `(外)`、`[地]` 前綴，只有前綴時是資料異常（需求規格 6.4）', () => {
    const foreign = readStallionRow(rowAt('mayStallions', 1));
    expect(foreign.fullName).toBe('(外)テストウマ002');
    expect(foreign.baseName).toBe('テストウマ002');
    expect(hasPrefixOnlyName(foreign)).toBe(false);
    expect(hasPrefixOnlyName({ ...foreign, fullName: '(外)' })).toBe(true);
  });

  it('[STL-01] 目標種牡馬 TXT 用同一份格式，整份只有一筆資料列', () => {
    const rows = stallionRows('targetStallion');
    expect(rows).toHaveLength(1);
    const values = readStallionRow(rows[0] as SourceRow);
    expect(values.fullName).toBe('テストウマ004');
    expect(values.sireSubsystem).toBe('ヘロド');
    expect(values.sireName).toBe('(外)テストウマ002');
  });
});
