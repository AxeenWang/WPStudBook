import { useState } from 'react';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import {
  jan2yoImportHandler,
  summariseJanRows,
  withCandidatesChosen,
  type Jan2yoRow,
} from '../../services/jan2yo-import.ts';
import { useAction } from '../actions.tsx';
import { PreviewControls } from './PreviewControls.tsx';
import { CheckboxField } from '../fields.tsx';
import { useServices } from '../ServicesContext.tsx';
import {
  confirmationOptions,
  ImportConfirmations,
  pendingConfirmations,
} from './ImportConfirmations.tsx';
import { summaryText, type ImportFlowProps } from './flow.ts';
import { Jan2yoPreview } from './Jan2yoPreview.tsx';

/**
 * 一月二歲馬總表（需求規格 11.3）：替既有產駒補正式馬名。出生年＝匯出年減 2，預覽顯示並由使用者
 * 確認；零筆或多筆候選的列由使用者選定產駒後才寫入（JAN-03）。
 */
export function Jan2yoFlow({ file, choice, onApplied }: ImportFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const [prepared, setPrepared] = useState<PreparedImport<Jan2yoRow>>();
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(new Map());
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [birthYearConfirmed, setBirthYearConfirmed] = useState(false);

  const reset = () => {
    setChosen(new Map());
    setConfirmed(new Set());
    setBirthYearConfirmed(false);
  };

  const preview = () => {
    void action.run(async () => {
      const result = await prepareImport(context, jan2yoImportHandler(), file, choice);
      setPrepared(result);
      reset();
      return `預覽完成：${summaryText(result.summary)}`;
    });
  };

  const rows =
    prepared === undefined ? [] : withCandidatesChosen(prepared.rows, chosen, choice.gameYear);
  const pending = prepared === undefined ? [] : pendingConfirmations(prepared, rows);
  const overview = summariseJanRows(rows);

  const apply = () => {
    void action.run(async () => {
      if (prepared === undefined) {
        throw new Error('請先產生預覽');
      }
      const result = await applyImport(
        context,
        jan2yoImportHandler(),
        { ...prepared, rows },
        confirmationOptions(pending, confirmed),
      );
      setPrepared(undefined);
      reset();
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
          <Jan2yoPreview
            rows={rows}
            overview={overview}
            chosen={chosen}
            onChoose={(key, foalId) => {
              setChosen(
                (previous) =>
                  new Map([
                    ...[...previous].filter(([item]) => item !== key),
                    ...(foalId === undefined ? [] : [[key, foalId] as const]),
                  ]),
              );
            }}
          />
          <CheckboxField
            label={`出生年 ${String(overview.birthYear)} 年正確（${String(choice.gameYear)} 年的二歲馬）`}
            checked={birthYearConfirmed}
            onChange={setBirthYearConfirmed}
          />
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
          <button type="button" onClick={apply} disabled={action.busy || !birthYearConfirmed}>
            套用這份總表
          </button>
        </>
      )}
    </>
  );
}
