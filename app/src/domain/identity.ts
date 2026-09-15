import type { ImportType } from './import-type.ts';

/** 需求規格 6.3：一月二歲馬為匯出年減 2，四月誕生幼駒為匯出年，其他總表為匯出年減馬齡。 */
export function inferBirthYear(
  type: ImportType,
  exportYear: number,
  age: number | undefined,
): number | undefined {
  switch (type) {
    case 'jan2yo':
      return exportYear - 2;
    case 'aprFoals':
      return exportYear;
    default:
      return age === undefined ? undefined : exportYear - age;
  }
}

export interface IdentityCandidate {
  readonly abilityNo?: number | undefined;
  readonly birthYear?: number | undefined;
  /** 比對用的名稱（完整馬名、基本馬名、正式馬名與別名）。 */
  readonly names: readonly string[];
  readonly sireName?: string | undefined;
  readonly damName?: string | undefined;
}

export interface KnownHorse extends IdentityCandidate {
  readonly id: string;
}

export type IdentityConflictReason = 'nameMismatch' | 'parentMismatch' | 'abilityNoMismatch';

export type IdentityMatch =
  | { readonly kind: 'same'; readonly horseId: string }
  | { readonly kind: 'fillAbilityNo'; readonly horseId: string }
  | {
      readonly kind: 'conflict';
      readonly horseId: string;
      readonly reason: IdentityConflictReason;
    }
  | { readonly kind: 'ambiguous'; readonly horseIds: readonly string[] }
  | { readonly kind: 'new' };

/** 需求規格 11.3：名稱比較可忽略前後空白。 */
function sharesName(a: readonly string[], b: readonly string[]): boolean {
  const names = new Set(a.map((name) => name.trim()));
  return b.some((name) => names.has(name.trim()));
}

function differs(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.trim() !== b.trim();
}

/**
 * 需求規格 6.2 的同一匹馬判斷（呼叫端只傳入同一遊戲局的馬）：
 * 1. 能力番号與出生年都相同：同一匹馬；馬名或父母不符時為衝突。
 * 2. 否則以名稱輔助：馬名相符且出生年相同或任一方未填的既有紀錄，唯一一筆且沒有能力番号時補入；
 *    已有不同能力番号時為衝突；多筆時交給使用者。
 * 3. 能力番号相同、出生年不同的回收番号不視為同一匹馬；沒有其他相符時建立新馬（名稱輔助仍可能補入既有紀錄）。
 */
export function matchHorseIdentity(
  candidate: IdentityCandidate,
  known: readonly KnownHorse[],
): IdentityMatch {
  const { abilityNo, birthYear } = candidate;
  if (abilityNo !== undefined && birthYear !== undefined) {
    const exact = known.find(
      (horse) => horse.abilityNo === abilityNo && horse.birthYear === birthYear,
    );
    if (exact !== undefined) {
      if (
        candidate.names.length > 0 &&
        exact.names.length > 0 &&
        !sharesName(candidate.names, exact.names)
      ) {
        return { kind: 'conflict', horseId: exact.id, reason: 'nameMismatch' };
      }
      if (
        differs(candidate.sireName, exact.sireName) ||
        differs(candidate.damName, exact.damName)
      ) {
        return { kind: 'conflict', horseId: exact.id, reason: 'parentMismatch' };
      }
      return { kind: 'same', horseId: exact.id };
    }
  }
  const byName = known.filter(
    (horse) =>
      sharesName(candidate.names, horse.names) &&
      (horse.birthYear === undefined || birthYear === undefined || horse.birthYear === birthYear),
  );
  if (byName.length > 1) {
    return { kind: 'ambiguous', horseIds: byName.map((horse) => horse.id) };
  }
  const [match] = byName;
  if (match === undefined) {
    return { kind: 'new' };
  }
  if (match.abilityNo === undefined) {
    return abilityNo === undefined
      ? { kind: 'same', horseId: match.id }
      : { kind: 'fillAbilityNo', horseId: match.id };
  }
  if (abilityNo === undefined || match.abilityNo === abilityNo) {
    return { kind: 'same', horseId: match.id };
  }
  return { kind: 'conflict', horseId: match.id, reason: 'abilityNoMismatch' };
}

/** 需求規格 6.2：同一匯入檔內能力番号重複時整份停止；回傳重複的能力番号（依第一次重複的順序）。 */
export function findDuplicateAbilityNos(
  rows: readonly { readonly abilityNo?: number | undefined }[],
): number[] {
  const seen = new Set<number>();
  const duplicated = new Set<number>();
  for (const { abilityNo } of rows) {
    if (abilityNo === undefined) {
      continue;
    }
    if (seen.has(abilityNo)) {
      duplicated.add(abilityNo);
    }
    seen.add(abilityNo);
  }
  return [...duplicated];
}
