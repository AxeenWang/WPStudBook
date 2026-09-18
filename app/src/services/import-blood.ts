import type { Horse } from '../domain/horse.ts';

/** 匯入列裡的血統欄位；繁殖牝馬總表與種牡馬總表都是這四欄。 */
export interface BloodValues {
  readonly sireName?: string | undefined;
  readonly damName?: string | undefined;
  readonly sireSubsystem?: string | undefined;
  readonly femaleLine?: string | undefined;
}

/** 這次要補上的空白欄位；沒有要補的欄位就不出現。 */
export interface BloodFills {
  readonly sireName?: string;
  readonly damName?: string;
  readonly sireSubsystem?: string;
  readonly femaleLine?: string;
}

export interface BloodComparison {
  readonly fills: BloodFills;
  readonly conflict: boolean;
}

/**
 * 父馬、母馬、父系與牝系只補空白，不同值為衝突並略過（需求規格 11.5、11.8、MAY-05、STL-13）。
 * 父系保存原文，不寫成替代系。
 *
 * 已經連到內部馬匹的父母不補也不比對：`sireId`／`damId` 是這一局裡的事實，總表的父馬欄只是
 * 遊戲當下的顯示名稱。拿名稱去覆蓋或推翻一個已連結的父母，只會讓資料互相矛盾。
 */
export function compareBlood(values: BloodValues, horse: Horse | undefined): BloodComparison {
  const fills: Record<string, string> = {};
  let conflict = false;
  const fields = [
    ['sireName', values.sireName, horse?.sireName, horse?.sireId !== undefined],
    ['damName', values.damName, horse?.damName, horse?.damId !== undefined],
    ['sireSubsystem', values.sireSubsystem, horse?.sireSubsystem, false],
    ['femaleLine', values.femaleLine, horse?.femaleLine, false],
  ] as const;
  for (const [field, incoming, existing, linked] of fields) {
    if (incoming === undefined || linked) {
      continue;
    }
    if (existing === undefined) {
      fills[field] = incoming;
    } else if (existing.trim() !== incoming.trim()) {
      conflict = true;
    }
  }
  return { fills, conflict };
}
