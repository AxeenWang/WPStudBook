import { describe, expect, it } from 'vitest';
import type { Foal } from '../../src/domain/foal.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import { parseImportFile, type ParsedFile } from '../../src/import/parse.ts';
import { loadAnnualWork } from '../../src/services/annual-work.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { nameFoal } from '../../src/services/foals.ts';
import { createGame } from '../../src/services/games.ts';
import type { ImportProgress } from '../../src/services/import-progress.ts';
import {
  applyImport,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import {
  matchedOctRows,
  octWorldMaresImportHandler,
  previewOctWorldMares,
  summariseOctRows,
  type OctMareRow,
} from '../../src/services/oct-world-mares-import.ts';
import { loadOverviewReminders } from '../../src/services/reminders.ts';
import { listCheckpoints } from '../../src/storage/checkpoints.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { getHorse, horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import type { RecordCollection } from '../../src/storage/schema.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { sequentialIds, useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('octWorldMares');
const APPLY: ApplyImportOptions = { confirmAdvanceYear: true, confirmWarnings: true };

/** 樣本的テストメス010 是 4 歲；1972 年的十月總表才接得上 1968 年出生的自家產駒。 */
function choice(gameYear: number): ImportChoice {
  return { type: 'octWorldMares', gameYear, timing: { month: 10, week: 1 } };
}

function sampleRow(label: string): Readonly<Record<string, string>> {
  const found = SAMPLE.rows.find((row) => row.name === label);
  if (found === undefined) {
    throw new Error(`樣本沒有「${label}」`);
  }
  return found;
}

const OWN_FARM = sampleRow('テストメス001');
const ELSEWHERE = sampleRow('テストメス010');
const OTHER = sampleRow('テストメス020');

function sampleOf(
  gameYear: number,
  rows: readonly Readonly<Record<string, string>>[],
): SyntheticSample {
  return { ...SAMPLE, fileName: `${String(gameYear)}年10月1週_繁殖牝馬.txt`, rows };
}

/** 年齡隨匯出年增加，出生年才維持 1968。 */
function elsewhereIn(gameYear: number, changes: Readonly<Record<string, string>> = {}) {
  return { ...ELSEWHERE, age: String(gameYear - 1968), ...changes };
}

function parsed(sample: SyntheticSample): ParsedFile {
  const result = parseImportFile(buildSampleBytes(sample), 'broodmare');
  if (!result.ok) {
    throw new Error(`樣本解析失敗：${result.problems.join('；')}`);
  }
  return result.file;
}

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'female', stageNumbers: [], aliases: [], ...overrides };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'mares' | 'foals',
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

const PRODUCING: Mare = {
  id: 'd-2',
  group: { kind: 'substitute', position: 1, generation: 1 },
  origin: 'marketReplenish',
  status: 'producing',
  site: 32,
};

/** 自家母馬テストメス002 與她 1968 年出生、已補名的女兒テストメス010（能力番号 0x3002）。 */
async function setUp(context: ServiceContext, filly: Partial<Horse> = {}): Promise<string> {
  const game = await createGame(context, { name: '十月匯入局', startYear: 1968 });
  await seed(context, game.id, 'horses', [
    horse({ id: 'd-2', fullName: 'テストメス002' }),
    horse({
      id: 'f-1',
      birthYear: 1968,
      abilityNo: 0x3002,
      damId: 'd-2',
      officialName: 'テストメス010',
      baseName: 'テストメス010',
      ...filly,
    }),
  ]);
  await seed(context, game.id, 'mares', [PRODUCING]);
  await seed(context, game.id, 'foals', [
    {
      id: 'f-1',
      damId: 'd-2',
      birthYear: 1968,
      freeBred: true,
      disposition: 'sold',
    } satisfies Foal,
  ]);
  return game.id;
}

async function runOct(
  context: ServiceContext,
  sample: SyntheticSample,
  gameYear: number,
  options: ApplyImportOptions = APPLY,
) {
  const handler = octWorldMaresImportHandler();
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    choice(gameYear),
  );
  return { prepared, result: await applyImport(context, handler, prepared, options) };
}

function rowFor(rows: readonly OctMareRow[], label: string): OctMareRow {
  const found = rows.find((item) => item.label === label);
  if (found === undefined) {
    throw new Error(`預覽沒有「${label}」`);
  }
  return found;
}

async function requireHorse(context: ServiceContext, gameId: string, id: string): Promise<Horse> {
  const found = await getHorse(context.database, gameId, id);
  if (found === undefined) {
    throw new Error(`找不到馬匹 ${id}`);
  }
  return found;
}

const UNTOUCHED: readonly RecordCollection[] = [
  'mares',
  'mareYearly',
  'breedings',
  'foals',
  'lines',
  'stallionDuties',
  'stallionYearly',
];

async function snapshot(context: ServiceContext, gameId: string) {
  return Object.fromEntries(
    await Promise.all(
      UNTOUCHED.map(
        async (collection) =>
          [collection, await readRecords(context.database, gameId, collection)] as const,
      ),
    ),
  );
}

describe('十月全世界繁殖牝馬總表的匯入（需求規格 11.10）', () => {
  const open = useServiceContexts();

  it('[OCT-02] 配對到在其他牧場的自家產駒 → 建立去向事件，保存繁殖牝馬馬番号與所在牧場', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const sample = sampleOf(1972, [OWN_FARM, elsewhereIn(1972), OTHER]);
    const rows = await previewOctWorldMares(context, {
      gameId,
      file: parsed(sample),
      choice: choice(1972),
    });
    expect(rowFor(rows, 'テストメス010')).toMatchObject({
      disposition: 'new',
      outcome: 'apply',
      birthYear: 1968,
      foalLabel: 'テストメス010',
    });

    await runOct(context, sample, 1972);
    const stored = await requireHorse(context, gameId, 'f-1');
    expect(stored.fate).toEqual({
      kind: 'mareElsewhere',
      gameYear: 1972,
      farmNo: 150,
      lastSeenYear: 1972,
    });
    expect(stored.stageNumbers).toEqual([
      { stage: 'broodmare', number: 0x8001, gameYear: 1972, source: 'octWorldMares' },
    ]);
    const events = await listEventsForSubject(context.database, gameId, 'f-1');
    expect(events).toEqual([
      expect.objectContaining({
        type: 'becameMareElsewhere',
        gameYear: 1972,
        timing: { month: 10, week: 1 },
        after: { farmNo: 150, horseNo: 0x8001 },
      }),
    ]);
  });

  it('在其他牧場成為繁殖牝馬的自家產駒馬名唯讀（需求規格 6.4）', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await runOct(context, sampleOf(1972, [elsewhereIn(1972)]), 1972);
    await expect(nameFoal(context, { foalId: 'f-1', officialName: 'テスト改名' })).rejects.toThrow(
      '繁殖牝馬馬名唯讀',
    );
    expect((await requireHorse(context, gameId, 'f-1')).officialName).toBe('テストメス010');
  });

  it('[OCT-03][OCT-01] 非自家產駒的繁殖牝馬不建立、不保存，只計入略過；牧場 0 不停止', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const before = await readRecords(context.database, gameId, 'horses');
    const sample = sampleOf(1972, [OWN_FARM, elsewhereIn(1972), OTHER]);
    const { prepared } = await runOct(context, sample, 1972);
    expect(rowFor(prepared.rows, 'テストメス020')).toMatchObject({
      disposition: 'other',
      outcome: 'skip',
      horse: undefined,
    });
    expect(summariseOctRows(prepared.rows)).toEqual({
      total: 3,
      ownFarm: 1,
      other: 1,
      new: 1,
      continuing: 0,
      moved: 0,
      conflict: 0,
    });
    expect(matchedOctRows(prepared.rows).map((row) => row.label)).toEqual(['テストメス010']);
    expect(await readRecords(context.database, gameId, 'horses')).toHaveLength(before.length);
  });

  it('[OCT-04] 自家牧場 32～35 的列一律略過，不改變繁殖牝馬圈、年度資料或受胎紀錄', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const before = await snapshot(context, gameId);
    // 自家產駒在自家牧場（不在五月名單也一樣）：繁殖牝馬圈只由五月總表負責。
    const sample = sampleOf(1972, [OWN_FARM, elsewhereIn(1972, { farm: '33' })]);
    const { prepared } = await runOct(context, sample, 1972);
    expect(prepared.rows.map((row) => row.disposition)).toEqual(['ownFarm', 'ownFarm']);
    expect((await requireHorse(context, gameId, 'f-1')).fate).toBeUndefined();
    expect(await snapshot(context, gameId)).toEqual(before);
  });

  it('[OCT-05] 隔年再次出現 → 更新最後確認年，不重複建立事件；牧場不同 → 保存變更歷程', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await runOct(context, sampleOf(1972, [elsewhereIn(1972)]), 1972);

    const same = await runOct(context, sampleOf(1973, [elsewhereIn(1973)]), 1973);
    expect(same.prepared.rows[0]?.disposition).toBe('continuing');
    expect((await requireHorse(context, gameId, 'f-1')).fate).toEqual({
      kind: 'mareElsewhere',
      gameYear: 1972,
      farmNo: 150,
      lastSeenYear: 1973,
    });

    const moved = await runOct(context, sampleOf(1974, [elsewhereIn(1974, { farm: '160' })]), 1974);
    expect(moved.prepared.rows[0]?.disposition).toBe('moved');
    expect((await requireHorse(context, gameId, 'f-1')).fate).toEqual({
      kind: 'mareElsewhere',
      gameYear: 1972,
      farmNo: 160,
      lastSeenYear: 1974,
    });
    const events = await listEventsForSubject(context.database, gameId, 'f-1');
    expect(events.map((event) => [event.type, event.gameYear, event.before, event.after])).toEqual(
      expect.arrayContaining([
        ['becameMareElsewhere', 1972, undefined, { farmNo: 150, horseNo: 0x8001 }],
        ['mareElsewhereMoved', 1974, { farmNo: 150 }, { farmNo: 160 }],
      ]),
    );
    expect(events).toHaveLength(2);
    // 同一匹馬的繁殖牝馬馬番号相同，不重複記錄。
    expect((await requireHorse(context, gameId, 'f-1')).stageNumbers).toHaveLength(1);
  });

  it('[OCT-06] 以前出現過、今年缺席 → 不推定原因，保留最後確認年', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await runOct(context, sampleOf(1972, [elsewhereIn(1972)]), 1972);
    await runOct(context, sampleOf(1973, [OWN_FARM, OTHER]), 1973);
    expect((await requireHorse(context, gameId, 'f-1')).fate).toEqual({
      kind: 'mareElsewhere',
      gameYear: 1972,
      farmNo: 150,
      lastSeenYear: 1972,
    });
  });

  it('[OCT-07] 沒有匯入十月總表 → 年度工作清單不列、不提醒；套用後不建立檢查點', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const work = await loadAnnualWork(context);
    expect(work.items.map((item) => item.type)).not.toContain('octWorldMares');
    const reminders = await loadOverviewReminders(context);
    expect(JSON.stringify(reminders)).not.toContain('十月');

    const { result } = await runOct(context, sampleOf(1968, [OWN_FARM, OTHER]), 1968);
    expect(result.checkpointId).toBeUndefined();
    expect(await listCheckpoints(context.database, gameId)).toEqual([]);
    expect((await loadAnnualWork(context)).items.map((item) => item.type)).not.toContain(
      'octWorldMares',
    );
  });

  it('同一年重匯或比最後確認年舊的檔案 → 不改寫', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await runOct(context, sampleOf(1973, [elsewhereIn(1973)]), 1973);
    const again = await previewOctWorldMares(context, {
      gameId,
      file: parsed(sampleOf(1973, [elsewhereIn(1973, { name: 'テストメス010' })])),
      choice: choice(1973),
    });
    expect(again[0]?.disposition).toBe('unchanged');
    const older = await previewOctWorldMares(context, {
      gameId,
      file: parsed(sampleOf(1972, [elsewhereIn(1972, { farm: '170' })])),
      choice: choice(1972),
    });
    expect(older[0]).toMatchObject({ disposition: 'unchanged', outcome: 'skip' });
    expect(older[0]?.issues.map((issue) => issue.code)).toEqual(['olderFile']);
  });

  it('能力番号與出生年相符但馬名或性別不符 → 衝突，不寫入（需求規格 6.2）', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const renamed = await previewOctWorldMares(context, {
      gameId,
      file: parsed(
        sampleOf(1972, [elsewhereIn(1972, { name: 'テストベツメイ', baseName: 'テストベツメイ' })]),
      ),
      choice: choice(1972),
    });
    expect(renamed[0]).toMatchObject({ disposition: 'conflict', outcome: 'review' });
    expect(renamed[0]?.issues.map((issue) => issue.code)).toEqual(['nameMismatch']);

    // 同一個測試裡第二局：id 換一組前綴，免得和第一局的遊戲局 id 相撞。
    const colt = await open({ newId: sequentialIds('colt') });
    const coltGame = await setUp(colt, { sex: 'male' });
    const rows = await previewOctWorldMares(colt, {
      gameId: coltGame,
      file: parsed(sampleOf(1972, [elsewhereIn(1972)])),
      choice: choice(1972),
    });
    expect(rows[0]?.issues.map((issue) => issue.code)).toEqual(['notFemale']);
  });

  it('[ID-06] 同一份十月總表內能力番号重複 → 整份停止', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const sample = sampleOf(1972, [
      elsewhereIn(1972),
      { ...OTHER, abilityNo: ELSEWHERE.abilityNo ?? '' },
    ]);
    await expect(
      previewOctWorldMares(context, { gameId, file: parsed(sample), choice: choice(1972) }),
    ).rejects.toThrow('0x3002');
  });

  it('[OCT-08] 5,000 筆分批處理並回報進度，預覽只列出配對到的自家產駒', async () => {
    const context = await open();
    await setUp(context);
    const others = Array.from({ length: 4999 }, (_, index) => ({
      ...OTHER,
      name: `テスト他場${String(index).padStart(4, '0')}`,
      baseName: `テスト他場${String(index).padStart(4, '0')}`,
      abilityNo: `0x${(0x9000 + index).toString(16).toUpperCase()}`,
      horseNo: `0x${(0xa000 + index).toString(16).toUpperCase()}`,
      farm: String(index % 273),
    }));
    const sample = sampleOf(1972, [...others, elsewhereIn(1972)]);
    const reports: ImportProgress[] = [];
    const prepared = await prepareImport(
      context,
      octWorldMaresImportHandler(),
      { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
      choice(1972),
      {
        onProgress: (progress) => {
          reports.push(progress);
        },
      },
    );
    expect(reports[0]).toEqual({ done: 0, total: 5000 });
    expect(reports.at(-1)).toEqual({ done: 5000, total: 5000 });
    expect(reports.length).toBeGreaterThan(2);
    expect(matchedOctRows(prepared.rows).map((row) => row.label)).toEqual(['テストメス010']);
    expect(prepared.summary.skip).toBe(4999);
  });
});
