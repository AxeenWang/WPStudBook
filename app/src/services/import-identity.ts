import { toBaseName, type Horse, type LifeStage, type StageNumber } from '../domain/horse.ts';
import {
  findDuplicateAbilityNos,
  matchHorseIdentity,
  type IdentityCandidate,
  type IdentityConflictReason,
  type KnownHorse,
} from '../domain/identity.ts';
import type { ImportType } from '../domain/import-type.ts';
import type { AppDatabase } from '../storage/database.ts';
import { findIdentityCandidates, type IdentityQuery } from '../storage/horses.ts';

/** 匯入列裡與身分有關的欄位；其餘欄位由各類型自己處理。 */
export interface IdentityRow {
  readonly lineNumber: number;
  readonly abilityNo?: number | undefined;
  readonly birthYear?: number | undefined;
  readonly fullName?: string | undefined;
  readonly baseName?: string | undefined;
  readonly sireName?: string | undefined;
  readonly damName?: string | undefined;
}

export type IdentityResolution =
  | { readonly kind: 'same'; readonly horse: Horse }
  /** 既有紀錄沒有能力番号，以唯一馬名輔助配對並補入（需求規格 6.2、ID-07）。 */
  | { readonly kind: 'fillAbilityNo'; readonly horse: Horse }
  | {
      readonly kind: 'conflict';
      readonly horse: Horse;
      readonly reason: IdentityConflictReason;
    }
  | { readonly kind: 'ambiguous'; readonly horses: readonly Horse[] }
  | { readonly kind: 'new' };

/**
 * 匯入類型對應的生命階段，決定馬番号記在哪一個階段的歷程（需求規格 6.4、ID-01）。
 * 候選 TXT 與十月全世界總表都是繁殖牝馬的資料。
 */
const STAGE_OF_IMPORT: Readonly<Record<ImportType, LifeStage>> = {
  jan2yo: 'racehorse',
  aprFoals: 'foal',
  mayMares: 'broodmare',
  julMares: 'broodmare',
  candidateFile: 'broodmare',
  octWorldMares: 'broodmare',
  mayStallions: 'stallion',
  targetStallion: 'stallion',
};

export function stageOfImport(type: ImportType): LifeStage {
  return STAGE_OF_IMPORT[type];
}

export function importedStageNumber(
  type: ImportType,
  horseNo: number,
  gameYear: number,
): StageNumber {
  return { stage: stageOfImport(type), number: horseNo, gameYear, source: type };
}

/** 比對用的名稱：完整馬名與基本馬名；沒有基本馬名時由完整馬名去除前綴。 */
export function namesOf(row: IdentityRow): string[] {
  const names = [row.fullName, row.baseName ?? (row.fullName && toBaseName(row.fullName))]
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return [...new Set(names)];
}

/** 同一匯入檔內能力番号重複 → 整份停止套用（需求規格 6.2、ID-06）。 */
export function duplicateAbilityNosIn(rows: readonly IdentityRow[]): number[] {
  return findDuplicateAbilityNos(rows);
}

function toCandidate(row: IdentityRow): IdentityCandidate {
  return {
    abilityNo: row.abilityNo,
    birthYear: row.birthYear,
    names: namesOf(row),
    sireName: row.sireName,
    damName: row.damName,
  };
}

function toKnown(horse: Horse): KnownHorse {
  const names = [
    horse.fullName,
    horse.baseName,
    horse.officialName,
    ...horse.aliases.map((a) => a.name),
  ]
    .filter((name): name is string => typeof name === 'string')
    .filter((name) => name.trim() !== '');
  return {
    id: horse.id,
    abilityNo: horse.abilityNo,
    birthYear: horse.birthYear,
    names,
    sireName: horse.sireName,
    damName: horse.damName,
  };
}

/**
 * 把 6.2 的同一匹馬判斷接上匯入：先一次查出每一列的候選馬匹，再逐列套用純函式。
 * 只查目前遊戲局，不同遊戲局一律不互相配對（ID-10、DATA-08）。
 */
export async function resolveIdentities(
  database: AppDatabase,
  gameId: string,
  rows: readonly IdentityRow[],
): Promise<IdentityResolution[]> {
  const queries: IdentityQuery[] = rows.map((row) => ({
    abilityNo: row.abilityNo,
    birthYear: row.birthYear,
    names: namesOf(row),
  }));
  const candidates = await findIdentityCandidates(database, gameId, queries);
  return rows.map((row, index) => {
    const known = candidates[index] ?? [];
    const match = matchHorseIdentity(toCandidate(row), known.map(toKnown));
    switch (match.kind) {
      case 'new':
        return { kind: 'new' };
      case 'ambiguous':
        return {
          kind: 'ambiguous',
          horses: known.filter((horse) => match.horseIds.includes(horse.id)),
        };
      default: {
        const horse = known.find((item) => item.id === match.horseId);
        if (horse === undefined) {
          // 候選是從同一份查詢結果來的，找不到代表呼叫端傳錯了。
          throw new Error(`身分配對回傳了不在候選內的馬匹 ${match.horseId}`);
        }
        return match.kind === 'conflict'
          ? { kind: 'conflict', horse, reason: match.reason }
          : { kind: match.kind, horse };
      }
    }
  });
}
