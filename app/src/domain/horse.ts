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

const NAME_PREFIXES = /^(?:\(外\)|\[地\])+/u;

/** 基本馬名：去除開頭的 `(外)`、`[地]` 前綴（需求規格 6.4）。 */
export function toBaseName(fullName: string): string {
  return fullName.replace(NAME_PREFIXES, '');
}
