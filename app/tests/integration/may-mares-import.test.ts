import { describe, expect, it } from 'vitest';
import type { Foal } from '../../src/domain/foal.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import { parseImportFile, type ParsedFile } from '../../src/import/parse.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import { updateGameRuleSettings } from '../../src/services/settings.ts';
import {
  previewMayMares,
  summariseMayRows,
  unknownSubsystemsOf,
  type MayMareRow,
} from '../../src/services/may-mares-import.ts';
import { saveSystemMapEntry } from '../../src/services/system-map.ts';
import type { ImportChoice } from '../../src/services/imports.ts';
import { horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('mayMares');
const MAY: ImportChoice = { type: 'mayMares', gameYear: 1968, timing: { month: 5, week: 1 } };

/** 樣本的三匹母馬：能力番号、據點與由馬齡推出的出生年（匯出年 1968）。 */
const HERD = [
  { abilityNo: 0x1001, name: 'テストメス001', site: 32, birthYear: 1962 },
  { abilityNo: 0x1002, name: 'テストメス002', site: 33, birthYear: 1959 },
  { abilityNo: 0x1003, name: '(外)テストメス003', site: 35, birthYear: 1964 },
] as const;

function parsed(sample: SyntheticSample = SAMPLE): ParsedFile {
  const result = parseImportFile(buildSampleBytes(sample), 'broodmare');
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
  return { sex: 'female', stageNumbers: [], aliases: [], ...overrides };
}

async function seedHorses(
  context: ServiceContext,
  gameId: string,
  horses: readonly Horse[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    'horses',
    horses.map((item) => ({ ...item, nameKeys: horseNameKeys(gameId, item) })),
  );
}

async function seedMares(
  context: ServiceContext,
  gameId: string,
  mares: readonly Mare[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    'mares',
    mares.map((mare) => ({ ...mare })),
  );
}

function producing(id: string, site: number): Mare {
  return {
    id,
    group: { kind: 'substitute', position: 1, generation: 1 },
    origin: 'marketReplenish',
    status: 'producing',
    site: site as Mare['site'],
  };
}

function rowFor(rows: readonly MayMareRow[], name: string): MayMareRow {
  const row = rows.find((item) => item.label === name);
  if (row === undefined) {
    throw new Error(`預覽沒有「${name}」`);
  }
  return row;
}

async function setUp(context: ServiceContext, name = '五月匯入局'): Promise<string> {
  const game = await createGame(context, { name, startYear: 1968 });
  return game.id;
}

describe('五月繁殖牝馬總表的預覽（需求規格 11.5）', () => {
  const openContext = useServiceContexts();

  it('[MAY-01] 繋養牧場番号不在 32～35 或缺少時整份停止', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    await expect(
      previewMayMares(context, gameId, parsed(withRow(SAMPLE, 1, { farm: '60' })), MAY),
    ).rejects.toMatchObject({ code: 'importHalted' });
    await expect(
      previewMayMares(context, gameId, parsed(withRow(SAMPLE, 2, { farm: '' })), MAY),
    ).rejects.toMatchObject({ code: 'importHalted' });
  });

  it('[MAY-02] 預覽分列各種處置與據點分布', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      // 繼續在圈（據點與檔案相同）。
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      // 繼續在圈但據點不同 → 轉場。
      horse({ id: 'h-2', abilityNo: 0x1002, birthYear: 1959, fullName: 'テストメス002' }),
      // 上年在圈、今年缺席。
      horse({ id: 'h-9', abilityNo: 0x1099, birthYear: 1960, fullName: 'テストメス099' }),
    ]);
    await seedMares(context, gameId, [
      producing('h-1', 32),
      producing('h-2', 34),
      producing('h-9', 32),
    ]);

    const rows = await previewMayMares(context, gameId, parsed(), MAY);
    const overview = summariseMayRows(rows);
    expect(overview).toMatchObject({
      total: 3,
      continuing: 2,
      transferred: 1,
      newOther: 1,
      returning: 0,
      conflict: 0,
      unmatched: 0,
    });
    // 缺席的那一匹進了預覽，所以摘要含定年引退或售出。
    expect(overview.retired + overview.sold).toBe(1);
    // 據點分布只算檔案列（32、33、35 各一）。
    expect(overview.sites).toEqual({ 32: 1, 33: 1, 34: 0, 35: 1 });
    expect(rowFor(rows, 'テストメス002').transferred).toBe(true);
    expect(rowFor(rows, 'テストメス001').transferred).toBe(false);
  });

  it('[MAY-03] 配對不到既有產駒的新進母馬是待指定用途', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    const rows = await previewMayMares(context, gameId, parsed(), MAY);
    const row = rowFor(rows, 'テストメス001');
    expect(row.disposition).toBe('newOther');
    expect(row.issues.map((issue) => issue.code)).toContain('unassignedPurpose');
    expect(row.lineage).toBeUndefined();
  });

  it('[MAY-04] `状態` 有值也不建立正式受胎結果，標示待 7 月確認', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    const rows = await previewMayMares(context, gameId, parsed(), MAY);
    // 樣本的三匹狀態都是「空胎」。
    for (const { name } of HERD) {
      expect(rowFor(rows, name).issues.map((issue) => issue.code)).toContain('conceptionPending');
    }
  });

  it('[MAY-05] 父馬、母馬、父系空白時補齊，與既有不同時衝突並略過', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      // 父母與父系都空白 → 待補齊。
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      // 父馬與檔案不同 → 衝突。
      horse({
        id: 'h-2',
        abilityNo: 0x1002,
        birthYear: 1959,
        fullName: 'テストメス002',
        sireName: 'ベツノウマ',
      }),
    ]);
    await seedMares(context, gameId, [producing('h-1', 32), producing('h-2', 33)]);

    const rows = await previewMayMares(context, gameId, parsed(), MAY);
    expect(rowFor(rows, 'テストメス001').fills).toEqual({
      sireName: 'テストウマ001',
      sireSubsystem: 'エクリプス',
      damName: 'テストメス900',
      femaleLine: 'テスト牝系',
    });
    const conflicted = rowFor(rows, 'テストメス002');
    expect(conflicted.disposition).toBe('conflict');
    expect(conflicted.outcome).toBe('review');
    expect(conflicted.fills).toEqual({});
  });

  it('[MAY-09] 八系指定配種所生的母駒帶著出生紀錄的系與代數', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'f-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await putRecords(context.database, gameId, 'foals', [
      {
        id: 'f-1',
        damId: 'dam-1',
        birthYear: 1962,
        freeBred: false,
        disposition: 'keep',
        lineage: { position: 1, generation: 3 },
      } satisfies Foal,
    ]);

    const rows = await previewMayMares(context, gameId, parsed(), MAY);
    const row = rowFor(rows, 'テストメス001');
    expect(row.disposition).toBe('newOwnFoal');
    expect(row.lineage).toEqual({ position: 1, generation: 3 });
    expect(row.freeBred).toBe(false);
  });

  it('[MAY-10] 自由配種所生的母駒不帶系與代數', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'f-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await putRecords(context.database, gameId, 'foals', [
      {
        id: 'f-1',
        damId: 'dam-1',
        birthYear: 1962,
        freeBred: true,
        disposition: 'keep',
      } satisfies Foal,
    ]);

    const row = rowFor(await previewMayMares(context, gameId, parsed(), MAY), 'テストメス001');
    expect(row.disposition).toBe('newOwnFoal');
    expect(row.freeBred).toBe(true);
    expect(row.lineage).toBeUndefined();
    expect(row.issues.map((issue) => issue.code)).toContain('freeBredFoal');
  });

  it('已離圈的母馬再次出現為回歸（ID-04）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await seedMares(context, gameId, [
      { ...producing('h-1', 32), status: 'left', leftReason: 'sold' },
    ]);

    expect(
      rowFor(await previewMayMares(context, gameId, parsed(), MAY), 'テストメス001'),
    ).toMatchObject({ disposition: 'returning', outcome: 'apply' });
  });

  it('[MARE-09][MARE-10] 缺席者依上次五月馬齡判斷，定年設定改了就換判斷', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    // 上次五月是 1967 年，這匹 1942 年出生 → 當時 25 歲。
    await seedHorses(context, gameId, [
      horse({ id: 'old', abilityNo: 0x1098, birthYear: 1942, fullName: 'テストロウバ' }),
      horse({ id: 'young', abilityNo: 0x1099, birthYear: 1960, fullName: 'テストワカ' }),
    ]);
    await seedMares(context, gameId, [producing('old', 32), producing('young', 32)]);

    const rows = await previewMayMares(context, gameId, parsed(), MAY);
    expect(rowFor(rows, 'テストロウバ').disposition).toBe('retired');
    expect(rowFor(rows, 'テストワカ').disposition).toBe('sold');

    // 定年改成 7 歲 → 下一次匯入依新設定判斷（MARE-10）。
    await updateGameRuleSettings(context, {
      retirementAge: 7,
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 26,
      vitalityThreshold: undefined,
    });
    const after = await previewMayMares(context, gameId, parsed(), MAY);
    expect(rowFor(after, 'テストワカ').disposition).toBe('retired');
  });

  it('檔案內能力番号重複時整份停止（ID-06）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    const [first] = SAMPLE.rows;
    if (first === undefined) {
      throw new Error('樣本資料不足');
    }

    await expect(
      previewMayMares(
        context,
        gameId,
        parsed(withRow(SAMPLE, 1, { abilityNo: first.abilityNo ?? '' })),
        MAY,
      ),
    ).rejects.toMatchObject({ code: 'importHalted' });
  });

  it('[LINE-05] 未登錄的子系統列在預覽可補登，未補登仍可匯入', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    const before = await previewMayMares(context, gameId, parsed(), MAY);
    // 樣本的父系是 エクリプス 與 ヘロド，兩者都還沒登錄。
    expect(unknownSubsystemsOf(before).sort()).toEqual(['エクリプス', 'ヘロド']);
    expect(rowFor(before, 'テストメス001').issues.map((issue) => issue.code)).toContain(
      'subsystemUnregistered',
    );
    // 未補登也不阻擋匯入。
    expect(rowFor(before, 'テストメス001').outcome).toBe('apply');

    await saveSystemMapEntry(context, { subsystem: 'エクリプス', parentSystem: 'エクリプス' });
    const after = await previewMayMares(context, gameId, parsed(), MAY);
    expect(unknownSubsystemsOf(after)).toEqual(['ヘロド']);
    expect(rowFor(after, 'テストメス001').subsystemUnregistered).toBe(false);
  });
});
