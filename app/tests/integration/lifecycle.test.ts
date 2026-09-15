import { describe, expect, it } from 'vitest';
import { exportBackup, restoreBackupAsNewGame } from '../../src/services/backup.ts';
import { saveBreeding } from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { loadFoalList, nameFoal, registerFoal } from '../../src/services/foals.ts';
import { changeCurrentYear, createGame, getCurrentGame } from '../../src/services/games.ts';
import { openFirstLine } from '../../src/services/lines.ts';
import { loadMareHerd, sellMare } from '../../src/services/mares.ts';
import { loadMareMatingRatings, saveMatingRating } from '../../src/services/mating-ratings.ts';
import { loadPedigree } from '../../src/services/pedigree.ts';
import {
  assignCurrentStallion,
  confirmPlannedBirth,
  loadStallionOverview,
  setPlannedSuccessor,
} from '../../src/services/stallions.ts';
import { convertFoalToMare } from '../../src/services/succession.ts';
import { findHorsesByName } from '../../src/storage/horses.ts';
import { readRecords, type StoredRecord } from '../../src/storage/records.ts';
import { RECORD_COLLECTIONS, type RecordCollection } from '../../src/storage/schema.ts';
import { stripNameKeys } from '../fixtures/synthetic-game.ts';
import { useServiceContexts } from './helpers.ts';
import { addStarter, foalInput } from './stud-fixture.ts';

function sortById(records: readonly StoredRecord[]): StoredRecord[] {
  return [...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function snapshot(context: ServiceContext, gameId: string) {
  const entries = await Promise.all(
    RECORD_COLLECTIONS.map(
      async (collection) =>
        [
          collection,
          sortById(stripNameKeys(await readRecords(context.database, gameId, collection))),
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<RecordCollection, StoredRecord[]>;
}

/** 以服務讀出的畫面資料：八系種牡馬、母馬群、產駒、血緣表與配種評價。 */
async function views(
  context: ServiceContext,
  ids: { damId: string; fillyId: string; coltId: string },
) {
  const [stallions, herd, foals, pedigree, ratings] = await Promise.all([
    loadStallionOverview(context),
    loadMareHerd(context),
    loadFoalList(context),
    loadPedigree(context, ids.coltId, 2),
    loadMareMatingRatings(context, ids.fillyId),
  ]);
  return { stallions, herd, foals, pedigree, ratings };
}

describe('關卡 C：第 1 系生命週期（開發計畫階段 2 完成條件）', () => {
  const open = useServiceContexts();

  it('[BLD-03] 零代種牡馬 × 起點母馬 → 受胎 → 產駒 → 母駒轉入成立 1 代 → 公駒接任 → 母馬賣出；識別不變、歷程完整，JSON.GZ 往返後關聯一致', async () => {
    const context = await open();
    const game = await createGame(context, { name: '生命週期局', startYear: 1968 });
    const line = await openFirstLine(context, {
      subsystem: 'ネアルコ',
      parentSystem: 'ネアルコ',
      color: '#c62828',
      founder: {
        fullName: 'テストシュボバ',
        abilityNo: '0x1234',
        birthYear: 1960,
        sireName: '',
        damName: '',
      },
    });
    const damId = await addStarter(context, 'オオトリモナーコス');
    const founderId = (await loadStallionOverview(context)).lines[0]?.current[0]?.horseId ?? '';
    const breed = (gameYear: number) =>
      saveBreeding(context, {
        mareId: damId,
        gameYear,
        breedingType: 'designated',
        stallionId: founderId,
        stallionName: '',
        conception: '受胎',
      });

    await breed(1968);
    await changeCurrentYear(context, 1969);
    const filly = await registerFoal(context, foalInput(damId, 1969, { sex: 'female', sp: 60 }));
    const coltBreeding = await breed(1969);
    await setPlannedSuccessor(context, { position: 1, breedingId: coltBreeding.id });
    await changeCurrentYear(context, 1970);
    const colt = await registerFoal(context, foalInput(damId, 1970, { sp: 72 }));
    await confirmPlannedBirth(context, 1);

    await nameFoal(context, { foalId: filly.horse.id, officialName: 'テストムスメ' });
    const converted = await convertFoalToMare(context, { foalId: filly.horse.id, site: 32 });
    expect(converted).toMatchObject({
      mare: { id: filly.horse.id, group: { kind: 'own', position: 1, generation: 1 } },
      establishedGeneration: true,
    });
    await nameFoal(context, { foalId: colt.horse.id, officialName: 'テストムスコ' });
    const duty = await assignCurrentStallion(context, {
      horseId: colt.horse.id,
      stallionNo: '0x0201',
    });
    expect(duty).toMatchObject({ horseId: colt.horse.id, position: 1, generation: 1 });
    await saveMatingRating(context, {
      mareId: filly.horse.id,
      stallionId: colt.horse.id,
      overallGrade: 'A',
      explosivePower: 15,
    });
    await sellMare(context, damId);

    const ids = { damId, fillyId: filly.horse.id, coltId: colt.horse.id };
    const before = await views(context, ids);
    // 識別不變：產駒、馬匹、繁殖牝馬與任期指向同一個內部識別。
    const records = await snapshot(context, game.id);
    expect(records.mares.map((mare) => [mare.id, mare.status])).toEqual(
      sortById([
        { id: damId, status: 'left' },
        { id: filly.horse.id, status: 'producing' },
      ]).map((mare) => [mare.id, mare.status]),
    );
    expect(records.breedings.map((item) => item.foalId)).toEqual(
      expect.arrayContaining([filly.horse.id, colt.horse.id]),
    );
    expect(
      before.stallions.lines[0]?.current.map((item) => [
        item.name,
        item.generation,
        item.dutyStatus,
      ]),
    ).toEqual([
      ['テストムスコ', 1, 'onDuty'],
      ['テストシュボバ', 0, 'onDuty'],
    ]);
    expect(before.pedigree.root).toMatchObject({
      horseId: colt.horse.id,
      sire: { horseId: founderId },
      dam: { horseId: damId, statuses: ['sold'] },
    });
    // 歷程完整：每個步驟都留下事件。
    const eventTypes = records.events.map(
      (event) => `${String(event.type)}:${String(event.subjectId)}`,
    );
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        `lineOpened:${line.id}`,
        `mareAdded:${damId}`,
        `breedingRecorded:${damId}`,
        `foalBorn:${filly.horse.id}`,
        `foalBorn:${colt.horse.id}`,
        `plannedSuccessorChanged:${line.id}`,
        `horseNamed:${filly.horse.id}`,
        `mareAdded:${filly.horse.id}`,
        `lineGenerationEstablished:${line.id}`,
        `becameStallion:${colt.horse.id}`,
        `stallionDutyStarted:${colt.horse.id}`,
        `matingRatingRecorded:${filly.horse.id}`,
        `mareSold:${damId}`,
      ]),
    );

    const file = await exportBackup(context);
    expect(file.fileName).toMatch(/\.json\.gz$/);
    const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes, name: '往返局' });
    expect(restored.id).not.toBe(game.id);
    expect((await getCurrentGame(context))?.id).toBe(restored.id);

    expect(await snapshot(context, restored.id)).toStrictEqual(records);
    const after = await views(context, ids);
    expect(after).toStrictEqual(before);
    expect(
      (await findHorsesByName(context.database, restored.id, 'テストムスメ')).map(
        (horse) => horse.id,
      ),
    ).toEqual([filly.horse.id]);
  });
});
