import { describe, expect, it } from 'vitest';
import type { Foal } from '../../src/domain/foal.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { StallionDuty } from '../../src/domain/stallion-duty.ts';
import { parseImportFileName } from '../../src/import/file-name.ts';
import { parseImportFile, type ParsedFile } from '../../src/import/parse.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import type { ImportChoice } from '../../src/services/imports.ts';
import {
  previewMayStallions,
  summariseStallionRows,
  withAbsentOverrides,
  type MayStallionRow,
} from '../../src/services/may-stallions-import.ts';
import { horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('mayStallions');
const MAY: ImportChoice = { type: 'mayStallions', gameYear: 1968, timing: { month: 5, week: 1 } };

/** 樣本的三匹種牡馬：能力番号與由馬齡推出的出生年（匯出年 1968）。 */
const STALLIONS = [
  { abilityNo: 0x0000, name: 'テストウマ001', birthYear: 1960, farmNo: 12 },
  { abilityNo: 0x0101, name: '(外)テストウマ002', birthYear: 1963, farmNo: 240 },
  { abilityNo: 0x0202, name: '[地]テストウマ003', birthYear: 1956, farmNo: 260 },
] as const;

function parsed(sample: SyntheticSample = SAMPLE): ParsedFile {
  const result = parseImportFile(buildSampleBytes(sample), 'stallion');
  if (!result.ok) {
    throw new Error(`樣本解析失敗：${result.problems.join('；')}`);
  }
  return result.file;
}

function withRow(
  sample: SyntheticSample,
  index: number,
  changes: Readonly<Record<string, string>>,
): SyntheticSample {
  return {
    ...sample,
    rows: sample.rows.map((row, at) => (at === index ? { ...row, ...changes } : row)),
  };
}

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'male', stageNumbers: [], aliases: [], ...overrides };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'foals' | 'stallionDuties' | 'stallionYearly' | 'lines',
  records: readonly object[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    collection,
    records.map((record) =>
      collection === 'horses'
        ? { ...record, nameKeys: horseNameKeys(gameId, record) }
        : { ...record },
    ),
  );
}

function ownFoal(id: string, damId: string, birthYear: number): Foal {
  return {
    id,
    damId,
    birthYear,
    freeBred: false,
    disposition: 'keep',
    lineage: { position: 1, generation: 1 },
  };
}

function onDuty(id: string, horseId: string, generation: number): StallionDuty {
  return {
    id,
    position: 1,
    generation,
    horseId,
    role: 'current',
    dutyStatus: 'onDuty',
    startYear: 1965,
  };
}

function rowFor(rows: readonly MayStallionRow[], name: string): MayStallionRow {
  const row = rows.find((item) => item.label === name);
  if (row === undefined) {
    throw new Error(`預覽沒有「${name}」`);
  }
  return row;
}

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '種牡馬匯入局', startYear: 1968 });
  return game.id;
}

describe('五月種牡馬總表的預覽（需求規格 11.8）', () => {
  const openContext = useServiceContexts();

  it('[STL-08] 檔名解析為 1968 年 5 月 1 週，以 CP932 讀出 63 欄，出生年為匯出年減馬齡', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    expect(parseImportFileName(SAMPLE.fileName)).toMatchObject({
      importType: 'mayStallions',
      gameYear: 1968,
      timing: { month: 5, week: 1 },
    });
    const file = parsed();
    expect(file.encoding).toBe('cp932');
    expect(file.delimiter).toBe('\t');
    expect(file.header).toHaveLength(63);

    const rows = await previewMayStallions(context, { gameId, file, choice: MAY });
    for (const stallion of STALLIONS) {
      const row = rowFor(rows, stallion.name);
      expect(row.birthYear).toBe(stallion.birthYear);
      expect(row.values?.abilityNo).toBe(stallion.abilityNo);
      // `牧場` 不套用範圍檢查（Q-07）：日本、美國、歐洲的番号都照收。
      expect(row.values?.farmNo).toBe(stallion.farmNo);
    }
    // `種付料` 的千分位逗號不影響分隔判斷，也不影響數值。
    expect(rowFor(rows, 'テストウマ001').snapshot?.studFee).toBe(2450);
  });

  it('[STL-08] 沒有既有紀錄時整份都是新的種牡馬紀錄', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    const rows = await previewMayStallions(context, { gameId, file: parsed(), choice: MAY });
    expect(summariseStallionRows(rows)).toMatchObject({
      total: 3,
      newStallion: 3,
      continuing: 0,
      becameStallion: 0,
      inactive: 0,
      retired: 0,
      conflict: 0,
    });
  });

  it('[STL-09] 配對到自家產駒時沿用內部識別並列為成為種牡馬', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({ id: 'dam-1', sex: 'female', fullName: 'テストメス900' }),
      horse({ id: 'own-1', abilityNo: 0x0000, birthYear: 1960, fullName: 'テストウマ001' }),
    ]);
    await seed(context, gameId, 'foals', [ownFoal('own-1', 'dam-1', 1960)]);

    const rows = await previewMayStallions(context, { gameId, file: parsed(), choice: MAY });
    const row = rowFor(rows, 'テストウマ001');
    expect(row.disposition).toBe('becameStallion');
    expect(row.horseId).toBe('own-1');
    expect(row.foal?.id).toBe('own-1');
  });

  it('[STL-13] 父馬、母馬與父系只補空白；不同值為衝突並略過', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      // 父馬空白 → 補上；父系已有且相同 → 不算衝突。
      horse({
        id: 'h-1',
        abilityNo: 0x0000,
        birthYear: 1960,
        fullName: 'テストウマ001',
        sireSubsystem: 'エクリプス',
      }),
      // 父系與檔案不同 → 血統衝突（父馬不同會先被身分判斷擋下，是另一回事）。
      horse({
        id: 'h-2',
        abilityNo: 0x0101,
        birthYear: 1963,
        fullName: '(外)テストウマ002',
        sireSubsystem: 'マッチェム',
      }),
    ]);

    const rows = await previewMayStallions(context, { gameId, file: parsed(), choice: MAY });
    const filled = rowFor(rows, 'テストウマ001');
    expect(filled.disposition).toBe('continuing');
    expect(filled.fills).toEqual({
      sireName: 'テストウマ900',
      damName: 'テストメス900',
      femaleLine: 'テスト牝系',
    });
    const conflict = rowFor(rows, '(外)テストウマ002');
    expect(conflict.disposition).toBe('conflict');
    expect(conflict.outcome).toBe('skip');
    expect(conflict.issues.map((issue) => issue.code)).toContain('bloodConflict');
  });

  it('[STL-11] 年度資料與前一份相同時不重複保存，不同時列為要保存', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({ id: 'h-1', abilityNo: 0x0000, birthYear: 1960, fullName: 'テストウマ001' }),
    ]);
    await seed(context, gameId, 'stallionYearly', [
      {
        id: 'sy-1',
        horseId: 'h-1',
        gameYear: 1967,
        sp: 95,
        st: 88,
        subParams: {
          power: 'B',
          quickness: 'A',
          guts: 'B',
          flexibility: 'C',
          spirit: 'B',
          wisdom: 'A',
          health: 'B',
        },
        subParamTotal: 45,
        kodashi: 8,
        studFee: 2450,
        record: { starts: 18, wins: 9, earnings: 312500, gradedWins: 4, g1Wins: 2 },
      },
    ]);

    const same = await previewMayStallions(context, { gameId, file: parsed(), choice: MAY });
    expect(summariseStallionRows(same).unchangedYearly).toBe(1);
    expect(rowFor(same, 'テストウマ001').previousYearly?.gameYear).toBe(1967);

    const changed = await previewMayStallions(context, {
      gameId,
      file: parsed(withRow(SAMPLE, 0, { studFee: '3,000' })),
      choice: MAY,
    });
    expect(summariseStallionRows(changed).unchangedYearly).toBe(0);
    expect(rowFor(changed, 'テストウマ001').snapshot?.studFee).toBe(3000);
  });

  it('[STL-10] 上年在表、今年缺席：八系現任預設已引退，其他只標示非現役', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'duty-1',
        fullName: 'ハチケイゲンニン',
        stallionListing: { lastSeenYear: 1967 },
      }),
      horse({
        id: 'market-1',
        fullName: 'シジョウシュボバ',
        stallionListing: { lastSeenYear: 1967 },
      }),
      // 早就標示過非現役的馬不再列一次。
      horse({
        id: 'gone-1',
        fullName: 'キョネンヒゲンエキ',
        stallionListing: { lastSeenYear: 1966, inactiveSince: 1967 },
      }),
    ]);
    await seed(context, gameId, 'stallionDuties', [onDuty('d-1', 'duty-1', 0)]);

    const rows = await previewMayStallions(context, { gameId, file: parsed(), choice: MAY });
    expect(summariseStallionRows(rows)).toMatchObject({ retired: 1, inactive: 1, newStallion: 3 });

    const retiring = rowFor(rows, 'ハチケイゲンニン');
    expect(retiring.disposition).toBe('retired');
    // 結束八系任期要使用者先確認。
    expect(retiring.outcome).toBe('warn');
    expect(retiring.duty?.id).toBe('d-1');

    const inactive = rowFor(rows, 'シジョウシュボバ');
    expect(inactive.disposition).toBe('inactive');
    expect(inactive.outcome).toBe('apply');
    expect(inactive.duty).toBeUndefined();
    expect(rows.some((row) => row.label === 'キョネンヒゲンエキ')).toBe(false);
  });

  it('[STL-10] 缺席者的處置可以逐匹更正', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'duty-1',
        fullName: 'ハチケイゲンニン',
        stallionListing: { lastSeenYear: 1967 },
      }),
    ]);
    await seed(context, gameId, 'stallionDuties', [onDuty('d-1', 'duty-1', 0)]);

    const rows = await previewMayStallions(context, { gameId, file: parsed(), choice: MAY });
    const corrected = withAbsentOverrides(rows, new Map([['horse:duty-1', 'inactive']]));
    const row = rowFor(corrected, 'ハチケイゲンニン');
    expect(row.disposition).toBe('inactive');
    expect(row.outcome).toBe('apply');
    expect(row.duty).toBeUndefined();
  });

  it('[ID-06] 檔案內能力番号重複時整份停止', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    await expect(
      previewMayStallions(context, {
        gameId,
        file: parsed(withRow(SAMPLE, 1, { abilityNo: '0x0000' })),
        choice: MAY,
      }),
    ).rejects.toMatchObject({ code: 'importHalted' });
  });

  it('配對到牝馬時列為衝突，不替牠寫種牡馬資料', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'h-1',
        sex: 'female',
        abilityNo: 0x0000,
        birthYear: 1960,
        fullName: 'テストウマ001',
      }),
    ]);

    const row = rowFor(
      await previewMayStallions(context, { gameId, file: parsed(), choice: MAY }),
      'テストウマ001',
    );
    expect(row.disposition).toBe('conflict');
    expect(row.issues.map((issue) => issue.code)).toContain('notMale');
  });
});
