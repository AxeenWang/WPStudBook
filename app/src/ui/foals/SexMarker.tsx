import type { Sex } from '../../domain/horse.ts';
import { SEX_LABELS } from './labels.ts';

/**
 * 性別標記（需求規格 9.3、BRD-21）：牡為藍色方形、牝為洋紅色圓形，形狀與顏色都能區分；
 * 輔助技術讀到「牡」「牝」文字。
 */
export function SexMarker({ sex }: { readonly sex: Sex }) {
  return (
    <span className={`sex-marker sex-${sex}`} role="img" aria-label={SEX_LABELS[sex]}>
      <span aria-hidden="true">{sex === 'male' ? '■' : '●'}</span>
    </span>
  );
}
