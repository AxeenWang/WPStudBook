import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import type { PreviewRow } from '../../src/domain/import-batch.ts';
import type { Mare } from '../../src/domain/mare.ts';
import { aprFoalsImportHandler, withReviewConfirmed } from '../../src/services/apr-foals-import.ts';
import { candidateImportHandler } from '../../src/services/candidate-import.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame, requireCurrentGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  type ImportChoice,
  type ImportHandler,
  type PreparedImport,
} from '../../src/services/imports.ts';
import { jan2yoImportHandler } from '../../src/services/jan2yo-import.ts';
import { julMaresImportHandler } from '../../src/services/jul-mares-import.ts';
import { mayMaresImportHandler } from '../../src/services/may-mares-import.ts';
import { mayStallionsImportHandler } from '../../src/services/may-stallions-import.ts';
import { octWorldMaresImportHandler } from '../../src/services/oct-world-mares-import.ts';
import { targetStallionImportHandler } from '../../src/services/target-stallion-import.ts';
import { horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords, readRecords, type StoredRecord } from '../../src/storage/records.ts';
import { RECORD_COLLECTIONS, type RecordCollection } from '../../src/storage/schema.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

type Snapshot = Readonly<Record<RecordCollection, ReadonlyMap<string, StoredRecord>>>;

/** 匯入紀錄與事件每次都會寫；nameKeys 是 storage 依名稱重建的索引欄位。 */
const ALWAYS_WRITTEN: readonly RecordCollection[] = ['imports', 'events'];
const IGNORED_FIELDS = new Set(['nameKeys']);

async function snapshot(context: ServiceContext, gameId: string): Promise<Snapshot> {
  const entries = await Promise.all(
    RECORD_COLLECTIONS.map(async (collection) => {
      const records = await readRecords(context.database, gameId, collection);
      return [collection, new Map(records.map((record) => [String(record.id), record]))] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as Snapshot;
}

interface CollectionDiff {
  readonly added: number;
  readonly removed: number;
  /** 既有紀錄裡變動過的欄位。 */
  readonly changedFields: ReadonlySet<string>;
}

function diffRecords(before: StoredRecord, after: StoredRecord): string[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...fields].filter(
    (field) =>
      !IGNORED_FIELDS.has(field) && JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

function diff(before: Snapshot, after: Snapshot): Map<RecordCollection, CollectionDiff> {
  const result = new Map<RecordCollection, CollectionDiff>();
  for (const collection of RECORD_COLLECTIONS) {
    if (ALWAYS_WRITTEN.includes(collection)) {
      continue;
    }
    const was = before[collection];
    const now = after[collection];
    const added = [...now.keys()].filter((id) => !was.has(id)).length;
    const removed = [...was.keys()].filter((id) => !now.has(id)).length;
    const changedFields = new Set<string>();
    for (const [id, record] of now) {
      const previous = was.get(id);
      if (previous !== undefined) {
        for (const field of diffRecords(previous, record)) {
          changedFields.add(field);
        }
      }
    }
    if (added > 0 || removed > 0 || changedFields.size > 0) {
      result.set(collection, { added, removed, changedFields });
    }
  }
  return result;
}

/**
 * 需求規格 11.2 的一列：可以新增紀錄的資料表，以及既有紀錄可以改的欄位（`'*'` 表示不限欄位）。
 * 不在表內的資料表一律不能動；任何匯入都不刪除紀錄（5.1、5.3）。
 */
interface Boundary {
  readonly add: readonly RecordCollection[];
  readonly change: Partial<Record<RecordCollection, readonly string[] | '*'>>;
}

function expectWithin(changes: Map<RecordCollection, CollectionDiff>, boundary: Boundary): void {
  for (const [collection, change] of changes) {
    expect(change.removed, `${collection} 不能刪除紀錄`).toBe(0);
    if (change.added > 0) {
      expect(boundary.add, `${collection} 不能新增紀錄`).toContain(collection);
    }
    if (change.changedFields.size > 0) {
      const allowed = boundary.change[collection];
      expect(allowed, `${collection} 的既有紀錄不能改`).toBeDefined();
      if (allowed !== '*') {
        expect(
          [...change.changedFields].filter((field) => !(allowed ?? []).includes(field)),
          `${collection} 改了不屬於這個匯入的欄位`,
        ).toEqual([]);
      }
    }
  }
}

const HORSE_FILLS = [
  'abilityNo',
  'birthYear',
  'sireName',
  'damName',
  'sireSubsystem',
  'femaleLine',
  'stageNumbers',
];

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'female', stageNumbers: [], aliases: [], ...overrides };
}

function producing(id: string, site: Mare['site']): Mare {
  return {
    id,
    group: { kind: 'substitute', position: 1, generation: 1 },
    origin: 'marketReplenish',
    status: 'producing',
    site,
  };
}

async function seedHerd(context: ServiceContext, gameId: string): Promise<void> {
  const herd = [
    horse({ id: 'd-1', fullName: 'テストメス001' }),
    horse({ id: 'd-2', fullName: 'テストメス002' }),
    horse({ id: 'd-3', fullName: '(外)テストメス003', baseName: 'テストメス003' }),
  ];
  await putRecords(
    context.database,
    gameId,
    'horses',
    herd.map((item) => ({ ...item, nameKeys: horseNameKeys(gameId, item) })),
  );
  await putRecords(context.database, gameId, 'mares', [
    { ...producing('d-1', 32) },
    { ...producing('d-2', 33) },
    { ...producing('d-3', 35) },
  ]);
}

interface Step<TRow extends PreviewRow> {
  readonly handler: ImportHandler<TRow>;
  readonly sample: SyntheticSample;
  readonly choice: ImportChoice;
  /** 預覽之後、套用之前的人工處理（例如逐匹確認）。 */
  readonly adjust?: (prepared: PreparedImport<TRow>) => Promise<PreparedImport<TRow>>;
}

async function run<TRow extends PreviewRow>(
  context: ServiceContext,
  gameId: string,
  step: Step<TRow>,
): Promise<Map<RecordCollection, CollectionDiff>> {
  const before = await snapshot(context, gameId);
  const prepared = await prepareImport(
    context,
    step.handler,
    { fileName: step.sample.fileName, bytes: buildSampleBytes(step.sample) },
    step.choice,
  );
  const adjusted = step.adjust === undefined ? prepared : await step.adjust(prepared);
  await applyImport(context, step.handler, adjusted, {
    confirmAdvanceYear: true,
    confirmWarnings: true,
    confirmBehindProgress: true,
    confirmCorrection: true,
  });
  return diff(before, await snapshot(context, gameId));
}

function choice(type: ImportChoice['type'], gameYear: number, month: number): ImportChoice {
  return { type, gameYear, timing: { month, week: 1 } };
}

describe('關卡 E：各類匯入只更新自己負責的欄位（需求規格 11.2）', () => {
  const open = useServiceContexts();

  it('[IMP-10] 同一局依序匯入八種檔案，每一種都只寫 11.2 允許的資料表與欄位', async () => {
    const context = await open();
    const game = await createGame(context, { name: '責任邊界局', startYear: 1968 });
    const gameId = game.id;
    await seedHerd(context, gameId);

    // 目標種牡馬 TXT：建立新系或補齊目標種牡馬；不得寫年度資料。
    const target = await run(context, gameId, {
      handler: targetStallionImportHandler({
        kind: 'openLine',
        position: 1,
        subsystem: '',
        parentSystem: 'ヘロド',
        color: '#c62828',
      }),
      sample: syntheticSample('targetStallion'),
      choice: choice('targetStallion', 1968, 5),
    });
    expect([...target.keys()]).toEqual(expect.arrayContaining(['lines', 'stallionDuties']));
    // 開新系時一併登錄子系統與親系統的對照（與手動開啟系位置相同）。
    expectWithin(target, { add: ['horses', 'lines', 'stallionDuties', 'systemMap'], change: {} });

    // 五月繁殖牝馬：繁殖牝馬圈對帳、年度資料、補齊父母與父系；不得建立受胎結果。
    const may = await run(context, gameId, {
      handler: mayMaresImportHandler(),
      sample: syntheticSample('mayMares'),
      choice: choice('mayMares', 1968, 5),
    });
    expect([...may.keys()]).toEqual(expect.arrayContaining(['mareYearly', 'horses']));
    expectWithin(may, {
      add: ['horses', 'mares', 'mareYearly'],
      change: {
        horses: HORSE_FILLS,
        mares: '*',
        mareYearly: '*',
        foals: ['disposition'],
        lines: ['establishedGenerations'],
      },
    });

    // 五月種牡馬：種牡馬身分與年度資料；不得動繁殖牝馬圈、八系位置或配種。
    const stallions = await run(context, gameId, {
      handler: mayStallionsImportHandler(),
      sample: syntheticSample('mayStallions'),
      choice: choice('mayStallions', 1968, 5),
    });
    expect([...stallions.keys()]).toEqual(expect.arrayContaining(['stallionYearly']));
    expectWithin(stallions, {
      add: ['horses', 'stallionYearly'],
      change: {
        horses: [...HORSE_FILLS, 'stallionListing', 'fate'],
        stallionYearly: '*',
        stallionDuties: ['dutyStatus', 'endYear', 'readiness'],
      },
    });

    // 候選 TXT：只建立勾選的新進母馬，不對帳整個繁殖牝馬圈。
    const candidates = await run(context, gameId, {
      handler: candidateImportHandler({ group: undefined, site: 32, origin: 'marketMixed' }),
      sample: syntheticSample('candidateFile'),
      choice: choice('candidateFile', 1968, 5),
    });
    expect(candidates.get('mares')?.added).toBeGreaterThan(0);
    expectWithin(candidates, { add: ['horses', 'mares'], change: {} });

    // 七月：正式受胎、自動建立配種紀錄、7 月活力；不得重新對帳繁殖牝馬圈或覆寫五月年度資料。
    const july = await run(context, gameId, {
      handler: julMaresImportHandler(),
      sample: syntheticSample('julMares'),
      choice: choice('julMares', 1968, 7),
    });
    expect([...july.keys()]).toEqual(expect.arrayContaining(['breedings', 'mareYearly']));
    expectWithin(july, {
      add: ['breedings', 'mareYearly'],
      change: { breedings: '*', mareYearly: ['vitalityJuly'], horses: HORSE_FILLS },
    });

    // 十月（當年還沒有自家產駒）：只計入略過，什麼都不寫。
    const october = await run(context, gameId, {
      handler: octWorldMaresImportHandler(),
      sample: syntheticSample('octWorldMares'),
      choice: choice('octWorldMares', 1968, 10),
    });
    expect([...october.keys()]).toEqual([]);

    // 四月（隔年）：依前一年受胎建立產駒並連回繁殖紀錄；不猜測父母、不改受胎結果。
    const april = await run(context, gameId, {
      handler: aprFoalsImportHandler(),
      sample: syntheticSample('aprFoals'),
      choice: choice('aprFoals', 1969, 4),
      adjust: async (prepared) => {
        // テストメス002 在 1968 年不受胎：待核對，使用者確認後比照自由配種產駒建立。
        const keys = new Set(prepared.rows.map((row) => row.key));
        return {
          ...prepared,
          rows: withReviewConfirmed(prepared.rows, keys, await requireCurrentGame(context)),
        };
      },
    });
    expect(april.get('foals')?.added).toBe(2);
    expectWithin(april, {
      add: ['horses', 'foals'],
      change: { breedings: ['foalId'] },
    });

    // 一月（兩年後）：替既有產駒補名與競走馬馬番号；不新增馬匹、不動持有與父母。
    const january = await run(context, gameId, {
      handler: jan2yoImportHandler(),
      sample: { ...syntheticSample('jan2yo'), fileName: '1971年 1月1週._二歲新馬.txt' },
      choice: choice('jan2yo', 1971, 1),
    });
    expect(january.get('horses')?.changedFields).toContain('officialName');
    expectWithin(january, {
      add: [],
      change: {
        horses: [
          'officialName',
          'officialNameSource',
          'baseName',
          'aliases',
          'abilityNo',
          'stageNumbers',
        ],
      },
    });

    // 十月（牝駒 4 歲）：只記去向與繁殖牝馬馬番号。
    const later = await run(context, gameId, {
      handler: octWorldMaresImportHandler(),
      sample: { ...syntheticSample('octWorldMares'), fileName: '1973年10月1週_繁殖牝馬.txt' },
      choice: choice('octWorldMares', 1973, 10),
    });
    expect(later.get('horses')?.changedFields).toContain('fate');
    expectWithin(later, { add: [], change: { horses: ['fate', 'stageNumbers'] } });
  });

  it('[IMP-06] 八種匯入各自選錯格式的檔案 → 整份停止，資料與匯入歷程都不變', async () => {
    const context = await open();
    const game = await createGame(context, { name: '失敗不寫入局', startYear: 1968 });
    await seedHerd(context, game.id);
    const before = await snapshot(context, game.id);
    // 二歲馬總表 78 欄、幼駒總表 63 欄、繁殖牝馬總表 61 欄、種牡馬總表 63 欄（表頭也不同）。
    const broodmare = syntheticSample('mayMares');
    const jan = syntheticSample('jan2yo');
    const attempt = <TRow extends PreviewRow>(
      handler: ImportHandler<TRow>,
      sample: SyntheticSample,
      picked: ImportChoice,
    ) =>
      expect(
        prepareImport(
          context,
          handler,
          { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
          picked,
        ),
        handler.type,
      ).rejects.toMatchObject({ code: 'importHalted' });
    await attempt(jan2yoImportHandler(), broodmare, choice('jan2yo', 1968, 1));
    await attempt(aprFoalsImportHandler(), jan, choice('aprFoals', 1968, 4));
    await attempt(mayMaresImportHandler(), jan, choice('mayMares', 1968, 5));
    await attempt(mayStallionsImportHandler(), broodmare, choice('mayStallions', 1968, 5));
    await attempt(julMaresImportHandler(), jan, choice('julMares', 1968, 7));
    await attempt(
      candidateImportHandler({ group: undefined, site: 32, origin: 'marketMixed' }),
      jan,
      choice('candidateFile', 1968, 5),
    );
    await attempt(
      targetStallionImportHandler({
        kind: 'openLine',
        position: 1,
        subsystem: '',
        parentSystem: 'ヘロド',
        color: '#c62828',
      }),
      broodmare,
      choice('targetStallion', 1968, 5),
    );
    await attempt(octWorldMaresImportHandler(), jan, choice('octWorldMares', 1968, 10));
    const after = await snapshot(context, game.id);
    for (const collection of RECORD_COLLECTIONS) {
      expect([...after[collection].values()], collection).toEqual([...before[collection].values()]);
    }
  });
});
