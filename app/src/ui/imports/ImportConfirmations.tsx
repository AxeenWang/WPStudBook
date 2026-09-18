import type { PreviewRow } from '../../domain/import-batch.ts';
import type { ApplyImportOptions, PreparedImport } from '../../services/imports.ts';
import { OUTCOME_LABELS } from './labels.ts';

/** 套用前要使用者確認的一項（需求規格 5.2、11.1）。 */
export interface PendingConfirmation {
  readonly key: keyof ApplyImportOptions;
  readonly message: string;
}

/**
 * 預覽已經說明了各種狀況；這裡只把需要確認的那幾種挑出來，讓畫面有勾選的地方。
 * 重複匯入（同年同時點同內容）不在此列，那是直接拒絕，不能用勾選繞過（IMP-07）。
 */
export function pendingConfirmations<TRow extends PreviewRow>(
  prepared: PreparedImport<TRow>,
  rows: readonly TRow[],
): PendingConfirmation[] {
  const pending: PendingConfirmation[] = [];
  if (prepared.repeat.kind === 'correction') {
    pending.push({
      key: 'confirmCorrection',
      message: `同年同時點已經匯入過「${prepared.repeat.previous.fileName}」，這份是資料更正`,
    });
  }
  if (prepared.year.kind === 'advance') {
    pending.push({
      key: 'confirmAdvanceYear',
      message: `檔案是 ${String(prepared.year.to)} 年的資料，套用時一起推進遊戲年${
        prepared.year.farFuture ? '（比目前進度晚兩年以上）' : ''
      }`,
    });
  }
  if (prepared.year.kind === 'behind') {
    pending.push({
      key: 'confirmBehindProgress',
      message: `檔案早於目前進度（${String(prepared.year.progress.gameYear)} 年 ${String(
        prepared.year.progress.timing.month,
      )} 月 ${String(prepared.year.progress.timing.week)} 週），建議先回溯到對應的檢查點`,
    });
  }
  // 看更正後的列，不看預覽當下的摘要（STL-10 的逐匹更正會改變警告列數）。
  const warn = rows.filter((row) => row.outcome === 'warn').length;
  if (warn > 0) {
    pending.push({
      key: 'confirmWarnings',
      message: `有 ${String(warn)} 列${OUTCOME_LABELS.warn}，確認後才會套用`,
    });
  }
  return pending;
}

export function confirmationOptions(
  pending: readonly PendingConfirmation[],
  checked: ReadonlySet<string>,
): ApplyImportOptions {
  return Object.fromEntries(
    pending.filter((item) => checked.has(item.key)).map((item) => [item.key, true]),
  );
}

interface ImportConfirmationsProps {
  readonly pending: readonly PendingConfirmation[];
  readonly checked: ReadonlySet<string>;
  readonly onToggle: (key: string, checked: boolean) => void;
}

export function ImportConfirmations(props: ImportConfirmationsProps) {
  if (props.pending.length === 0) {
    return null;
  }
  return (
    <fieldset data-testid="import-confirmations">
      <legend>套用前的確認</legend>
      {props.pending.map((item) => (
        <div className="field" key={item.key}>
          <label>
            <input
              type="checkbox"
              checked={props.checked.has(item.key)}
              onChange={(event) => {
                props.onToggle(item.key, event.target.checked);
              }}
            />
            {item.message}
          </label>
        </div>
      ))}
    </fieldset>
  );
}
