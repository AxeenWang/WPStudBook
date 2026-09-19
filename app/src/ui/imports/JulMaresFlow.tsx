import { useState } from 'react';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import {
  julMaresImportHandler,
  summariseJulRows,
  type JulMareRow,
} from '../../services/jul-mares-import.ts';
import { useAction } from '../actions.tsx';
import { PreviewControls } from './PreviewControls.tsx';
import { useServices } from '../ServicesContext.tsx';
import {
  confirmationOptions,
  ImportConfirmations,
  pendingConfirmations,
} from './ImportConfirmations.tsx';
import { summaryText, type ImportFlowProps } from './flow.ts';
import { JulMaresPreview } from './JulMaresPreview.tsx';

/**
 * 七月繁殖牝馬總表（需求規格 11.6）：整份對帳，沒有勾選。自動建立的配種紀錄與偏離規則的
 * 差異都要確認過才寫入（JUL-04、JUL-09）。
 */
export function JulMaresFlow({ file, choice, onApplied }: ImportFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const [prepared, setPrepared] = useState<PreparedImport<JulMareRow>>();
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());

  const preview = () => {
    void action.run(async () => {
      const result = await prepareImport(context, julMaresImportHandler(), file, choice);
      setPrepared(result);
      setConfirmed(new Set());
      return `預覽完成：${summaryText(result.summary)}`;
    });
  };

  const rows = prepared?.rows ?? [];
  const pending = prepared === undefined ? [] : pendingConfirmations(prepared, rows);

  const apply = () => {
    void action.run(async () => {
      if (prepared === undefined) {
        throw new Error('請先產生預覽');
      }
      const result = await applyImport(
        context,
        julMaresImportHandler(),
        prepared,
        confirmationOptions(pending, confirmed),
      );
      setPrepared(undefined);
      setConfirmed(new Set());
      onApplied();
      return `已套用 ${String(result.appliedRows)} 筆。`;
    });
  };

  return (
    <>
      <PreviewControls action={action} onPreview={preview} />

      {prepared !== undefined && (
        <>
          <h3>預覽</h3>
          <p data-testid="import-summary">{summaryText(prepared.summary)}</p>
          <JulMaresPreview rows={rows} overview={summariseJulRows(rows)} />
          <ImportConfirmations
            pending={pending}
            checked={confirmed}
            onToggle={(key, checked) => {
              setConfirmed((previous) =>
                checked
                  ? new Set([...previous, key])
                  : new Set([...previous].filter((item) => item !== key)),
              );
            }}
          />
          <button type="button" onClick={apply} disabled={action.busy}>
            套用這份總表
          </button>
        </>
      )}
    </>
  );
}
