import type { AppDatabase } from '../../src/storage/database.ts';
import { putRecords, type StoredRecord } from '../../src/storage/records.ts';
import { RECORD_COLLECTIONS, type RecordCollection } from '../../src/storage/schema.ts';

/** 虛構設定：0 與 false 都是有效值。 */
export const SYNTHETIC_SETTINGS = {
  retirementAge: 24,
  highAgeReminderAge: 17,
  stallionAgeReminderAge: 25,
  vitalityThreshold: 0,
  checkpointRetention: 15,
  display: { compact: false, theme: 'ダーク' },
};

/**
 * 涵蓋全部資料表的虛構資料，欄位名依設計決策第 6 節：日文馬名、中文備註、特殊字元、
 * 能力番号 0 與 65535、空字串、false、巢狀狀態，以及省略的未知欄位（例如 horse-foal 沒有能力番号）。
 */
export const SYNTHETIC_RECORDS: Readonly<Record<RecordCollection, readonly StoredRecord[]>> = {
  lines: [
    {
      id: 'line-1',
      position: 1,
      subsystem: 'ネアルコ',
      parentSystem: 'ネアルコ',
      color: '#1f6feb',
    },
  ],
  systemMap: [
    { id: 'map-1', subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
    { id: 'map-2', subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
  ],
  horses: [
    {
      id: 'horse-sire',
      abilityNo: 0,
      birthYear: 1960,
      sex: 'male',
      fullName: 'テストシュボバ',
      baseName: 'テストシュボバ',
      sireName: '(外)ソトノチチ',
      damName: 'ソトノハハ',
      sireSubsystem: 'ネアルコ',
      stageNumbers: [{ stage: 'stallion', number: 0, gameYear: 1968, source: 'mayStallions' }],
      aliases: [],
    },
    {
      id: 'horse-dam',
      abilityNo: 65535,
      birthYear: 1962,
      sex: 'female',
      fullName: '[地]テストヒンバ「特殊」&<>"\\/',
      baseName: 'テストヒンバ',
      sireSubsystem: 'マンノウォー',
      femaleLine: '',
      aliases: [{ kind: 'manual', name: 'テスト別名', gameYear: 1968 }],
    },
    {
      id: 'horse-foal',
      birthYear: 1969,
      sex: 'female',
      fullName: 'テストヒンバ1969',
      sireId: 'horse-sire',
      damId: 'horse-dam',
      sireSubsystem: 'ネアルコ',
      aliases: [],
    },
  ],
  mares: [
    {
      id: 'horse-dam',
      group: { kind: 'starter', position: 1, generation: 0 },
      origin: 'marketFound',
      status: 'producing',
      site: 32,
      succession: 'confirmed',
      yearPlan: 'designated',
      note: '中文備註：第一行\n第二行',
    },
  ],
  stallionDuties: [
    {
      id: 'duty-1',
      position: 1,
      generation: 0,
      horseId: 'horse-sire',
      role: 'current',
      dutyStatus: 'onDuty',
      startYear: 1968,
    },
  ],
  mareYearly: [
    {
      id: 'mare-yearly-1',
      horseId: 'horse-dam',
      gameYear: 1968,
      vitalityMay: { state: 'confirmed', value: 0, boosted: false },
      vitalityJuly: { state: 'pending' },
      kodashi: 0,
      breedingYears: 1,
      breedingCount: 0,
    },
  ],
  stallionYearly: [
    {
      id: 'stallion-yearly-1',
      horseId: 'horse-sire',
      gameYear: 1968,
      sp: 72,
      st: 60,
      studFee: 2450,
    },
  ],
  breedings: [
    {
      id: 'breeding-1',
      mareId: 'horse-dam',
      gameYear: 1968,
      breedingType: 'designated',
      stallionId: 'horse-sire',
      conception: '受胎',
      expectedBirthYear: 1969,
      deviated: false,
      confirmations: [],
    },
  ],
  matingRatings: [
    {
      id: 'rating-1',
      stallionId: 'horse-sire',
      mareId: 'horse-dam',
      gameYear: 1968,
      overallGrade: 'A',
      explosivePower: 0,
    },
  ],
  foals: [
    {
      id: 'horse-foal',
      damId: 'horse-dam',
      birthYear: 1969,
      lineage: { position: 1, generation: 1 },
      disposition: 'keep',
      freeBred: false,
      turf: '◎',
      dirt: '×',
      distanceText: '',
    },
  ],
  recoveries: [
    { id: 'recovery-1', position: 1, status: 'closed', gameYear: 1968, reason: '測試用' },
  ],
  imports: [
    {
      id: 'import-1',
      type: 'mayMares',
      gameYear: 1968,
      timing: { month: 5, week: 1 },
      fileName: '1968年5月1週 繁殖牝馬.txt',
      sha256: 'a'.repeat(64),
      summary: { applied: 1, skipped: 0 },
    },
  ],
  events: [
    {
      id: 'event-1',
      subjectId: 'horse-dam',
      type: 'siteChanged',
      gameYear: 1968,
      timing: { month: 5, week: 1 },
      before: { site: 32 },
      after: { site: 33 },
      source: 'user',
      occurredAt: '2026-09-14T12:00:00.000Z',
    },
  ],
};

/** 寫入合成資料；horses 另加含 gameId 的 nameKeys，模擬階段 2 的索引欄位（備份時應被剔除）。 */
export async function seedSyntheticGame(database: AppDatabase, gameId: string): Promise<void> {
  await database.put('gameSettings', { ...SYNTHETIC_SETTINGS, gameId });
  for (const collection of RECORD_COLLECTIONS) {
    const records =
      collection === 'horses'
        ? SYNTHETIC_RECORDS.horses.map((horse) => ({
            ...horse,
            nameKeys: [`${gameId}${typeof horse.fullName === 'string' ? horse.fullName : ''}`],
          }))
        : SYNTHETIC_RECORDS[collection];
    await putRecords(database, gameId, collection, records);
  }
}
