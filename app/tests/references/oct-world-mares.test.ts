import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BROODMARE_COLUMNS } from '../../src/import/columns.ts';
import { parseImportFileName } from '../../src/import/file-name.ts';
import { cell, parseImportFile } from '../../src/import/parse.ts';
import { createGame } from '../../src/services/games.ts';
import {
  previewOctWorldMares,
  summariseOctRows,
} from '../../src/services/oct-world-mares-import.ts';
import { useServiceContexts } from '../integration/helpers.ts';
import { readSampleBytes, sampleExists, type ReferenceSample } from './samples.ts';

const SAMPLE: ReferenceSample = { fileName: '1968年10月1週_繁殖牝馬.txt', formatId: 'broodmare' };

function parsed() {
  const result = parseImportFile(readSampleBytes(SAMPLE), 'broodmare');
  if (!result.ok) {
    throw new Error(`解析失敗：${result.problems.join('；')}`);
  }
  return result.file;
}

/** 只比對筆數，不輸出原始資料（設計決策 7.4）。 */
describe.skipIf(!sampleExists(SAMPLE))(
  '本機實檔：十月全世界繁殖牝馬總表（檔案不存在時略過）',
  () => {
    const open = useServiceContexts();

    it('[OCT-01] 檔名預選十月全世界繁殖牝馬；CP932 讀取 2,971 筆、61 欄與 `国` 分布', () => {
      expect(parseImportFileName(SAMPLE.fileName)).toMatchObject({
        importType: 'octWorldMares',
        gameYear: 1968,
        timing: { month: 10, week: 1 },
      });
      const file = parsed();
      expect(file.encoding).toBe('cp932');
      expect(file.header).toHaveLength(61);
      expect(file.rows).toHaveLength(2971);
      const tally: Record<string, number> = {};
      for (const row of file.rows) {
        const country = cell(row, BROODMARE_COLUMNS.country)?.trim() ?? '';
        tally[country] = (tally[country] ?? 0) + 1;
      }
      expect(tally).toEqual({ 日: 1439, 米: 746, 欧: 786 });
    });

    it('[OCT-01] `牧場` 為 0 或其他番号時不停止；空白的局裡自家牧場 10 筆、其他全部略過', async () => {
      const file = parsed();
      const zeroFarm = file.rows.filter((row) => cell(row, BROODMARE_COLUMNS.farm)?.trim() === '0');
      expect(zeroFarm).toHaveLength(34);

      const context = await open();
      const game = await createGame(context, { name: '實檔局', startYear: 1968 });
      const rows = await previewOctWorldMares(context, {
        gameId: game.id,
        file,
        choice: { type: 'octWorldMares', gameYear: 1968, timing: { month: 10, week: 1 } },
      });
      expect(summariseOctRows(rows)).toEqual({
        total: 2971,
        ownFarm: 10,
        other: 2961,
        new: 0,
        continuing: 0,
        moved: 0,
        conflict: 0,
      });
    });
  },
);
