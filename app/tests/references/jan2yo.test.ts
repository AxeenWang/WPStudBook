import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { toBaseName } from '../../src/domain/horse.ts';
import { JAN2YO_COLUMNS } from '../../src/import/columns.ts';
import { readJan2yoRow } from '../../src/import/jan2yo.ts';
import { cell, parseImportFile } from '../../src/import/parse.ts';
import { createGame } from '../../src/services/games.ts';
import { previewJan2yo } from '../../src/services/jan2yo-import.ts';
import { useServiceContexts } from '../integration/helpers.ts';
import { readSampleBytes, sampleExists, type ReferenceSample } from './samples.ts';

const SAMPLE: ReferenceSample = { fileName: '1968年 1月1週._二歲新馬.txt', formatId: 'jan2yo' };

function parsed() {
  const result = parseImportFile(readSampleBytes(SAMPLE), 'jan2yo');
  if (!result.ok) {
    throw new Error(`解析失敗：${result.problems.join('；')}`);
  }
  return result.file;
}

/** 只比對筆數，不輸出原始資料（設計決策 7.4）。 */
describe.skipIf(!sampleExists(SAMPLE))('本機實檔：一月二歲馬總表（檔案不存在時略過）', () => {
  const open = useServiceContexts();

  it('[JAN-01] 以 CP932 讀取 1,160 筆、78 欄；空白的局裡全部是非管理的馬，出生年為 1966', async () => {
    const file = parsed();
    expect(file.encoding).toBe('cp932');
    expect(file.header).toHaveLength(78);
    expect(file.rows).toHaveLength(1160);

    const context = await open();
    const game = await createGame(context, { name: '實檔局', startYear: 1968 });
    // 走正式的預覽：`年` 全部是 2、能力番号沒有重複，所以不會整份停止。
    const rows = await previewJan2yo(context, {
      gameId: game.id,
      file,
      choice: { type: 'jan2yo', gameYear: 1968, timing: { month: 1, week: 1 } },
    });
    expect(rows).toHaveLength(1160);
    expect(rows.every((row) => row.birthYear === 1966)).toBe(true);
    expect(rows.every((row) => row.disposition === 'unmanaged')).toBe(true);
  });

  it('[JAN-06] 第 77 欄依位置讀成基本馬名：全部等於第 1 欄去除前綴，111 筆兩欄不同', () => {
    const values = parsed().rows.map(readJan2yoRow);
    expect(values.every((row) => row.baseName === toBaseName(row.fullName ?? ''))).toBe(true);
    expect(values.filter((row) => row.fullName !== row.baseName)).toHaveLength(111);
  });

  it('[JAN-07] 史実番号 0x7FFF 由 1,046 筆共用，不能作為識別', () => {
    const shared = parsed().rows.filter(
      (row) => cell(row, JAN2YO_COLUMNS.historicalNo)?.trim().toUpperCase() === '0X7FFF',
    );
    expect(shared).toHaveLength(1046);
  });
});
