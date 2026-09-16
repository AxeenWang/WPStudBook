import { describe, expect, it } from 'vitest';
import type { Game } from '../../src/domain/game.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { PreviewRow } from '../../src/domain/import-batch.ts';
import type { ImportType } from '../../src/domain/import-type.ts';
import { cell, type ParsedFile } from '../../src/import/parse.ts';
import { parseHexNo, parseInteger, stripSystemSuffix } from '../../src/import/values.ts';
import { listGameCheckpoints } from '../../src/services/checkpoints.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { ServiceError } from '../../src/services/errors.ts';
import { createGame, getCurrentGame, switchGame } from '../../src/services/games.ts';
import {
  applyImport,
  listImportHistory,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
  type ImportHandler,
} from '../../src/services/imports.ts';
import { listEventsOfType } from '../../src/storage/events.ts';
import { readRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('mayMares');
const MAY: ImportChoice = { type: 'mayMares', gameYear: 1968, timing: { month: 5, week: 1 } };

interface MareRow extends PreviewRow {
  readonly horse: Horse;
}

/**
 * 批次 3 只做通用流程，各類型的處理器從批次 5 起陸續加入。這個測試用處理器把每一列
 * 變成一匹母馬，用來驗管線本身：單一交易、重複與更正、年份推進、自動檢查點。
 */
function testHandler(
  type: ImportType,
  options: { readonly errorOnLine?: number } = {},
): ImportHandler<MareRow> {
  return {
    type,
    collections: ['horses'],
    preview: (_context: ServiceContext, _game: Game, file: ParsedFile) =>
      Promise.resolve(
        file.rows.map((row): MareRow => {
          const columns = SAMPLE.columns;
          const name = cell(row, columns.name ?? 0) ?? '';
          const sireSubsystem = stripSystemSuffix(cell(row, columns.sireSystem ?? 0));
          return {
            lineNumber: row.lineNumber,
            label: name,
            outcome: row.lineNumber === options.errorOnLine ? 'error' : 'apply',
            issues: [],
            horse: {
              id: `horse-${String(row.lineNumber)}`,
              sex: 'female',
              abilityNo: parseHexNo(cell(row, columns.abilityNo ?? 0)) ?? 0,
              birthYear: 1968 - (parseInteger(cell(row, columns.age ?? 0)) ?? 0),
              fullName: name,
              baseName: cell(row, columns.baseName ?? 0) ?? name,
              ...(sireSubsystem === undefined ? {} : { sireSubsystem }),
              stageNumbers: [],
              aliases: [],
            },
          };
        }),
      ),
    build: ({ rows, occurredAt, newId, choice }) => ({
      records: rows.map((row) => ({ collection: 'horses' as const, record: row.horse })),
      events: rows.map((row) => ({
        id: newId(),
        subjectId: row.horse.id,
        type: 'horseCreated' as const,
        gameYear: choice.gameYear,
        source: 'user' as const,
        occurredAt,
      })),
    }),
  };
}

/** 改一個欄位做出「同年同時點、內容不同」的檔案（IMP-08）。 */
function editedSample(sample: SyntheticSample, vitality: string): SyntheticSample {
  const [first, ...rest] = sample.rows;
  if (first === undefined) {
    throw new Error('樣本沒有資料列');
  }
  return { ...sample, rows: [{ ...first, vitality }, ...rest] };
}

function source(sample: SyntheticSample, fileName = sample.fileName) {
  return { fileName, bytes: buildSampleBytes(sample) };
}

async function setUp(context: ServiceContext, startYear = 1968): Promise<Game> {
  return createGame(context, { name: '匯入測試局', startYear });
}

async function runImport(
  context: ServiceContext,
  handler: ImportHandler<MareRow>,
  sample: SyntheticSample,
  choice: ImportChoice,
  options: ApplyImportOptions = {},
) {
  const prepared = await prepareImport(context, handler, source(sample), choice);
  return applyImport(context, handler, prepared, options);
}

describe('匯入流程（需求規格 11.1）', () => {
  const openContext = useServiceContexts();

  it('套用後只保存檔名、雜湊、年、時點、類型與摘要（IMP-05、IMP-11）', async () => {
    const context = await openContext();
    const game = await setUp(context);
    const result = await runImport(context, testHandler('mayMares'), SAMPLE, MAY);

    expect(result.appliedRows).toBe(3);
    expect(result.batch.summary).toEqual({ apply: 3, skip: 0, review: 0, warn: 0, error: 0 });
    expect(Object.keys(result.batch).sort()).toEqual([
      'appliedAt',
      'fileName',
      'gameYear',
      'id',
      'sha256',
      'summary',
      'timing',
      'type',
    ]);
    expect(result.batch.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(3);
    expect(await listEventsOfType(context.database, game.id, 'horseCreated')).toHaveLength(3);
  });

  it('年度總表套用後自動建立檢查點（IMP-12、CKPT-01）', async () => {
    const context = await openContext();
    await setUp(context);
    const result = await runImport(context, testHandler('mayMares'), SAMPLE, MAY);

    const checkpoints = await listGameCheckpoints(context);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.id).toBe(result.checkpointId);
    expect(checkpoints[0]?.gameYear).toBe(1968);
    expect(checkpoints[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('候選 TXT 不建立檢查點（IMP-12、CAND-05）', async () => {
    const context = await openContext();
    await setUp(context);
    const result = await runImport(context, testHandler('candidateFile'), SAMPLE, {
      ...MAY,
      type: 'candidateFile',
    });

    expect(result.checkpointId).toBeUndefined();
    expect(await listGameCheckpoints(context)).toHaveLength(0);
  });

  it('同局同年同時點同類型同雜湊再次匯入為重複，不重複建立歷程（IMP-07）', async () => {
    const context = await openContext();
    await setUp(context);
    const handler = testHandler('mayMares');
    await runImport(context, handler, SAMPLE, MAY);

    const again = await prepareImport(context, handler, source(SAMPLE), MAY);
    expect(again.repeat.kind).toBe('duplicate');
    await expect(applyImport(context, handler, again)).rejects.toMatchObject({
      code: 'importDuplicate',
    });
    expect(await listImportHistory(context)).toHaveLength(1);
  });

  it('同年同時點內容不同要確認資料更正，並指回前一次匯入（IMP-08）', async () => {
    const context = await openContext();
    await setUp(context);
    const handler = testHandler('mayMares');
    const first = await runImport(context, handler, SAMPLE, MAY);

    const changed = editedSample(SAMPLE, '55');
    const prepared = await prepareImport(context, handler, source(changed), MAY);
    expect(prepared.repeat.kind).toBe('correction');
    await expect(applyImport(context, handler, prepared)).rejects.toMatchObject({
      code: 'confirmationRequired',
    });

    const corrected = await applyImport(context, handler, prepared, { confirmCorrection: true });
    expect(corrected.batch.correctionOf).toBe(first.batch.id);
    const history = await listImportHistory(context);
    expect(history.map((batch) => batch.fileName)).toEqual([SAMPLE.fileName, SAMPLE.fileName]);
  });

  it('同一時點不同類型各自套用，不視為重複或更正（IMP-16）', async () => {
    const context = await openContext();
    await setUp(context);
    await runImport(context, testHandler('mayMares'), SAMPLE, MAY);

    const stallions = syntheticSample('mayStallions');
    const prepared = await prepareImport(context, testHandler('mayStallions'), source(stallions), {
      ...MAY,
      type: 'mayStallions',
    });
    expect(prepared.repeat.kind).toBe('new');
    expect(await listImportHistory(context)).toHaveLength(1);
  });

  it('有阻擋錯誤時資料與歷程都不變（IMP-06）', async () => {
    const context = await openContext();
    const game = await setUp(context);
    const handler = testHandler('mayMares', { errorOnLine: 3 });
    const prepared = await prepareImport(context, handler, source(SAMPLE), MAY);

    expect(prepared.summary).toEqual({ apply: 2, skip: 0, review: 0, warn: 0, error: 1 });
    await expect(applyImport(context, handler, prepared)).rejects.toMatchObject({
      code: 'importHalted',
    });
    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(0);
    expect(await listImportHistory(context)).toHaveLength(0);
  });

  it('選錯類型時依欄數停止，不寫入（IMP-04）', async () => {
    const context = await openContext();
    const game = await setUp(context);
    const handler = testHandler('jan2yo');

    await expect(
      prepareImport(context, handler, source(SAMPLE), { ...MAY, type: 'jan2yo' }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(0);
  });

  it('檔案年份較晚時要確認推進，確認後先推進再套用（IMP-14）', async () => {
    const context = await openContext();
    await setUp(context);
    const handler = testHandler('mayMares');
    const next: ImportChoice = { ...MAY, gameYear: 1969 };
    const prepared = await prepareImport(context, handler, source(SAMPLE), next);

    expect(prepared.year).toEqual({ kind: 'advance', to: 1969, farFuture: false });
    await expect(applyImport(context, handler, prepared)).rejects.toMatchObject({
      code: 'confirmationRequired',
    });
    expect((await getCurrentGame(context))?.currentYear).toBe(1968);

    const result = await applyImport(context, handler, prepared, { confirmAdvanceYear: true });
    expect(result.advancedToYear).toBe(1969);
    expect((await getCurrentGame(context))?.currentYear).toBe(1969);
    const game = await getCurrentGame(context);
    expect(game).toBeDefined();
    if (game !== undefined) {
      expect(await listEventsOfType(context.database, game.id, 'gameYearChanged')).toHaveLength(1);
    }
  });

  it('檔案年份晚兩年以上另外警告（IMP-15）', async () => {
    const context = await openContext();
    await setUp(context);
    const prepared = await prepareImport(context, testHandler('mayMares'), source(SAMPLE), {
      ...MAY,
      gameYear: 1970,
    });
    expect(prepared.year).toEqual({ kind: 'advance', to: 1970, farFuture: true });
  });

  it('檔案早於目前進度時提示回溯，確認後才套用（IMP-09）', async () => {
    const context = await openContext();
    await setUp(context);
    await runImport(context, testHandler('julMares'), syntheticSample('julMares'), {
      type: 'julMares',
      gameYear: 1968,
      timing: { month: 7, week: 1 },
    });

    const handler = testHandler('mayMares');
    const prepared = await prepareImport(context, handler, source(SAMPLE), MAY);
    expect(prepared.year).toEqual({
      kind: 'behind',
      progress: { gameYear: 1968, timing: { month: 7, week: 1 } },
    });
    await expect(applyImport(context, handler, prepared)).rejects.toMatchObject({
      code: 'confirmationRequired',
    });
    const result = await applyImport(context, handler, prepared, { confirmBehindProgress: true });
    expect(result.appliedRows).toBe(3);
  });

  it('只套用勾選的列（CAND-02）', async () => {
    const context = await openContext();
    const game = await setUp(context);
    const handler = testHandler('candidateFile');
    const prepared = await prepareImport(context, handler, source(SAMPLE), {
      ...MAY,
      type: 'candidateFile',
    });

    const result = await applyImport(context, handler, prepared, { selectedLineNumbers: [2, 4] });
    expect(result.appliedRows).toBe(2);
    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(2);
    // 摘要記錄的是預覽結果，勾選與否不改變它。
    expect(result.batch.summary.apply).toBe(3);
  });

  it('兩個遊戲局完全隔離，匯入只影響目前局（DATA-08）', async () => {
    const context = await openContext();
    const first = await setUp(context);
    const second = await createGame(context, { name: '另一局', startYear: 1968 });
    await switchGame(context, second.id);
    await runImport(context, testHandler('mayMares'), SAMPLE, MAY);

    expect(await readRecords(context.database, second.id, 'horses')).toHaveLength(3);
    expect(await readRecords(context.database, first.id, 'horses')).toHaveLength(0);
    await switchGame(context, first.id);
    expect(await listImportHistory(context)).toHaveLength(0);
  });
});
