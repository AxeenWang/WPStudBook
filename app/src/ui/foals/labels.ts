import type { BreedingType, Conception } from '../../domain/breeding.ts';
import type { Disposition, SubParamKey, SurfaceSummary } from '../../domain/foal.ts';
import type { Sex } from '../../domain/horse.ts';
import type { Lineage } from '../../domain/lineage.ts';

export const SEX_LABELS: Readonly<Record<Sex, string>> = { male: '牡', female: '牝' };

export const DISPOSITION_LABELS: Readonly<Record<Disposition, string>> = {
  keep: '保留',
  forSale: '待售',
  sold: '已售出',
};

export const BREEDING_TYPE_LABELS: Readonly<Record<BreedingType, string>> = {
  designated: '八系指定配種',
  free: '自由配種',
};

export const SUB_PARAM_LABELS: Readonly<Record<SubParamKey, string>> = {
  power: '力量',
  quickness: '瞬發力',
  guts: '勝負根性',
  flexibility: '柔軟性',
  spirit: '精神力',
  wisdom: '賢明度',
  health: '健康',
};

/** 場地型摘要（推導，不取代芝與ダート的原值）。 */
export const SURFACE_LABELS: Readonly<Record<SurfaceSummary, string>> = {
  turf: '芝型',
  dirt: 'ダート型',
  both: '芝ダート兼用',
  neither: '芝ダート都不擅長',
};

/** 受胎狀態原文顯示；欄位不存在為未登記（需求規格 9.1）。 */
export function conceptionText(conception: Conception | undefined): string {
  return conception ?? '未登記';
}

export function lineageText(lineage: Lineage): string {
  return `第 ${String(lineage.position)} 系 ${String(lineage.generation)} 代`;
}
