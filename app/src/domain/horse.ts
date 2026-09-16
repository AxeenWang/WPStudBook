import type { ImportType } from './import-type.ts';

export type Sex = 'male' | 'female';

export type LifeStage = 'foal' | 'racehorse' | 'broodmare' | 'stallion';

/** 資料來源：手動輸入或匯入類型。 */
export type RecordSource = 'manual' | ImportType;

/** 階段馬番号（需求規格 6.4）：只記在歷程，不作為身分判斷。 */
export interface StageNumber {
  readonly stage: LifeStage;
  readonly number: number;
  readonly gameYear: number;
  readonly source: RecordSource;
}

export type AliasKind = 'manual' | 'imported';

/** 名稱別名（需求規格 9.4）：被取代的正式馬名。 */
export interface HorseAlias {
  readonly kind: AliasKind;
  readonly name: string;
  readonly gameYear: number;
}

/**
 * 自家產駒的去向（需求規格 9.7）：成為種牡馬。只作紀錄，不影響八系任務、代數或後繼；
 * 在其他牧場成為繁殖牝馬（11.10）於階段 4 加入。
 */
export interface HorseFate {
  readonly kind: 'becameStallion';
  readonly gameYear: number;
}

/** 設計決策 5.2、6.3 節。父母可以同時有內部 id 與匯入的外部名稱。 */
export interface Horse {
  readonly id: string;
  readonly sex: Sex;
  readonly abilityNo?: number;
  readonly birthYear?: number;
  readonly fullName?: string;
  readonly baseName?: string;
  readonly officialName?: string;
  readonly sireId?: string;
  readonly sireName?: string;
  readonly damId?: string;
  readonly damName?: string;
  readonly sireSubsystem?: string;
  /** 空字串＝不屬於具名牝系（需求規格 8.8）；欄位不存在＝未取得。 */
  readonly femaleLine?: string;
  readonly stageNumbers: readonly StageNumber[];
  readonly aliases: readonly HorseAlias[];
  readonly fate?: HorseFate;
}

/** 取得新階段馬番号（需求規格 6.4）：同一階段已有相同馬番号時不重複記錄，回傳原馬匹。 */
export function withStageNumber(horse: Horse, stageNumber: StageNumber): Horse {
  const exists = horse.stageNumbers.some(
    (item) => item.stage === stageNumber.stage && item.number === stageNumber.number,
  );
  return exists ? horse : { ...horse, stageNumbers: [...horse.stageNumbers, stageNumber] };
}

/** 繁殖牝馬與種牡馬馬名唯讀（需求規格 6.4）；此處判斷已成為種牡馬的馬。 */
export function isStallionHorse(horse: Horse): boolean {
  return horse.fate?.kind === 'becameStallion';
}

export const ABILITY_NO_MAX = 0xffff;

const ABILITY_NO_TEXT = /^(?:0x)?([0-9a-f]{1,4})$/i;

/** 能力番号文字轉整數：接受 `0x` 開頭或不帶前綴的 1～4 位十六進位；`0x0000` 是有效值 0。 */
export function parseAbilityNo(text: string): number | undefined {
  const digits = ABILITY_NO_TEXT.exec(text.trim())?.[1];
  return digits === undefined ? undefined : Number.parseInt(digits, 16);
}

/** 設計決策 5.3 節：顯示為 `0x` 開頭的 4 位大寫十六進位。 */
export function formatAbilityNo(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 開頭連續的 `(外)`、`[地]` 前綴，連同前綴前後的空白。 */
const NAME_PREFIXES = /^(?:\s*(?:\(外\)|\[地\]))+\s*/u;

/**
 * 基本馬名：去除開頭的 `(外)`、`[地]` 前綴與前綴前後的空白（需求規格 6.4）。
 * 沒有前綴的馬名保持原文，不做全面修剪（需求規格 11.1）。
 */
export function toBaseName(fullName: string): string {
  return fullName.replace(NAME_PREFIXES, '');
}

/** 追蹤名使用的母馬名：基本馬名優先，其次正式馬名，最後由完整馬名去除前綴。 */
export function nameForTracking(horse: Horse): string | undefined {
  const name =
    horse.baseName ??
    horse.officialName ??
    (horse.fullName === undefined ? undefined : toBaseName(horse.fullName));
  return name === '' ? undefined : name;
}

/** 主要顯示名稱：完整馬名、正式馬名、基本馬名，都沒有時使用追蹤名（需求規格 9.4）。 */
export function horseDisplayName(horse: Horse, tracking: string | undefined): string | undefined {
  return horse.fullName ?? horse.officialName ?? horse.baseName ?? tracking;
}
