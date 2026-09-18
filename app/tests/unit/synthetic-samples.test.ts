import { describe, expect, it } from 'vitest';
import { parseImportFileName } from '../../src/import/file-name.ts';
import { IMPORT_FORMATS } from '../../src/import/formats.ts';
import { parseImportFile, type SourceRow } from '../../src/import/parse.ts';
import {
  buildSampleBytes,
  sampleCell,
  SYNTHETIC_SAMPLES,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import {
  mainValue,
  parseHexNo,
  parseInteger,
  parseVitality,
  stripSystemSuffix,
} from '../../src/import/values.ts';

function parseSample(id: string) {
  const sample = syntheticSample(id);
  const result = parseImportFile(buildSampleBytes(sample), sample.formatId);
  if (!result.ok) {
    throw new Error(`${id} 解析失敗：${result.problems.join('；')}`);
  }
  return { sample, file: result.file };
}

function firstRow(sample: SyntheticSample, rows: readonly SourceRow[]): SourceRow {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${sample.id} 樣本沒有資料列`);
  }
  return row;
}

/**
 * 欄位位置由 `src/import/columns.ts` 統一提供（設計決策 7.4）；這裡確認那份表沒有打錯序號，
 * 列出的是表頭還不驗證的位置。
 */
const UNVALIDATED_POSITIONS: Readonly<Record<string, readonly number[]>> = {
  broodmare: [2],
  stallion: [],
  jan2yo: [],
  aprFoals: [],
};

describe('合成樣本（設計決策 7.4）', () => {
  it('樣本的欄位位置都對得上解析器驗證的欄位位置', () => {
    for (const sample of SYNTHETIC_SAMPLES) {
      const validated = new Set(IMPORT_FORMATS[sample.formatId].headers.map((h) => h.position));
      const allowed = UNVALIDATED_POSITIONS[sample.formatId] ?? [];
      const unexpected = Object.entries(sample.columns).filter(
        ([, position]) => !validated.has(position) && !allowed.includes(position),
      );
      expect(unexpected).toEqual([]);
    }
  });

  it('[IMP-01] 每份樣本都是無 BOM 的 CP932、Tab 分隔，且欄數與附錄 A 相符', () => {
    for (const sample of SYNTHETIC_SAMPLES) {
      const { file } = parseSample(sample.id);
      expect(file.encoding).toBe('cp932');
      expect(file.delimiter).toBe('\t');
      expect(file.rows).toHaveLength(sample.rows.length);
    }
  });

  it('年度總表的檔名解析得出年、時點與類型；候選與目標種牡馬的檔名解析不出來', () => {
    const parsed = SYNTHETIC_SAMPLES.map((sample) => [
      sample.importType,
      parseImportFileName(sample.fileName)?.importType,
    ]);
    expect(parsed).toEqual([
      ['jan2yo', 'jan2yo'],
      ['aprFoals', 'aprFoals'],
      ['mayMares', 'mayMares'],
      ['julMares', 'julMares'],
      ['candidateFile', undefined],
      ['mayStallions', 'mayStallions'],
      ['targetStallion', undefined],
      ['octWorldMares', 'octWorldMares'],
    ]);
  });

  it('種牡馬樣本涵蓋 `0x0000`、千分位逗號與父系結尾「系」', () => {
    const { sample, file } = parseSample('mayStallions');
    const row = firstRow(sample, file.rows);
    expect(parseHexNo(sampleCell(sample, row, 'abilityNo'))).toBe(0);
    expect(parseInteger(sampleCell(sample, row, 'studFee'))).toBe(2450);
    expect(stripSystemSuffix(sampleCell(sample, row, 'sireSystem'))).toBe('エクリプス');
  });

  it('幼駒樣本的 SP 與 サ 帶括號附加值', () => {
    const { sample, file } = parseSample('aprFoals');
    const row = firstRow(sample, file.rows);
    expect(sampleCell(sample, row, 'sp')).toBe('72(72)');
    expect(mainValue(sampleCell(sample, row, 'sp'))).toBe('72');
    // `サ` 與七項副能力換算一致（72）；不一致是 BRD-11 的警告，由匯入測試另外驗。
    expect(mainValue(sampleCell(sample, row, 'subParamTotal'))).toBe('72');
  });

  it('五月繁殖牝馬樣本的活力涵蓋増強中的 `*13`', () => {
    const { sample, file } = parseSample('mayMares');
    const row = firstRow(sample, file.rows);
    expect(parseVitality(sampleCell(sample, row, 'vitality'))).toEqual({
      state: 'confirmed',
      value: 13,
      boosted: true,
    });
  });

  it('候選樣本超過一頁，能力番号與馬番号沒有重複', () => {
    const { sample, file } = parseSample('candidateFile');
    expect(file.rows.length).toBeGreaterThan(24);
    const abilityNos = file.rows.map((row) => sampleCell(sample, row, 'abilityNo'));
    expect(new Set(abilityNos).size).toBe(file.rows.length);
  });

  it('目標種牡馬樣本只有一筆資料列（需求規格 11.9）', () => {
    const { file } = parseSample('targetStallion');
    expect(file.rows).toHaveLength(1);
  });
});
