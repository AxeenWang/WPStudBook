import type { ImportSummary } from '../../domain/import-batch.ts';
import type { ImportChoice, ImportSource } from '../../services/imports.ts';
import { OUTCOME_LABELS } from './labels.ts';

export interface ImportFlowProps {
  readonly file: ImportSource;
  readonly choice: ImportChoice;
  /** 套用成功後通知外層重新載入歷程。 */
  readonly onApplied: () => void;
}

export function summaryText(summary: ImportSummary): string {
  return (Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[])
    .map((key) => `${OUTCOME_LABELS[key]} ${String(summary[key])}`)
    .join('、');
}
