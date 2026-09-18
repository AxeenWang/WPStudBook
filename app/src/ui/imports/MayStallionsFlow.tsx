import { useState } from 'react';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import {
  mayStallionsImportHandler,
  summariseStallionRows,
  withAbsentOverrides,
  type AbsentDisposition,
  type MayStallionRow,
} from '../../services/may-stallions-import.ts';
import { Feedback, useAction } from '../actions.tsx';
import { useServices } from '../ServicesContext.tsx';
import {
  confirmationOptions,
  ImportConfirmations,
  pendingConfirmations,
} from './ImportConfirmations.tsx';
import { summaryText, type ImportFlowProps } from './flow.ts';
import { MayStallionsPreview } from './MayStallionsPreview.tsx';

/**
 * 五月種牡馬總表（需求規格 11.8）：整份對帳，沒有勾選；缺席者的處置可以逐匹更正（STL-10），
 * 結束八系任期要先確認。
 */
export function MayStallionsFlow({ file, choice, onApplied }: ImportFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const [prepared, setPrepared] = useState<PreparedImport<MayStallionRow>>();
  const [overrides, setOverrides] = useState<ReadonlyMap<string, AbsentDisposition>>(new Map());
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());

  const reset = () => {
    setPrepared(undefined);
    setOverrides(new Map());
    setConfirmed(new Set());
  };

  const preview = () => {
    void action.run(async () => {
      const result = await prepareImport(context, mayStallionsImportHandler(), file, choice);
      setPrepared(result);
      setOverrides(new Map());
      setConfirmed(new Set());
      return `預覽完成：${summaryText(result.summary)}`;
    });
  };

  const rows = prepared === undefined ? [] : withAbsentOverrides(prepared.rows, overrides);
  const pending = prepared === undefined ? [] : pendingConfirmations(prepared, rows);

  const apply = () => {
    void action.run(async () => {
      if (prepared === undefined) {
        throw new Error('請先產生預覽');
      }
      const result = await applyImport(
        context,
        mayStallionsImportHandler(),
        { ...prepared, rows },
        confirmationOptions(pending, confirmed),
      );
      reset();
      onApplied();
      return `已套用 ${String(result.appliedRows)} 筆。`;
    });
  };

  return (
    <>
      <button type="button" onClick={preview} disabled={action.busy}>
        產生預覽
      </button>
      <Feedback message={action.message} error={action.error} />

      {prepared !== undefined && (
        <>
          <h3>預覽</h3>
          <p data-testid="import-summary">{summaryText(prepared.summary)}</p>
          <MayStallionsPreview
            rows={rows}
            overview={summariseStallionRows(rows)}
            absentOverrides={overrides}
            onAbsentChange={(key, disposition) => {
              setOverrides((previous) => new Map([...previous, [key, disposition]]));
            }}
          />
          <ImportConfirmations
            pending={pending}
            checked={confirmed}
            onToggle={(key, checked) => {
              setConfirmed((previous) => {
                const next = new Set(previous);
                return checked
                  ? new Set([...next, key])
                  : new Set([...next].filter((item) => item !== key));
              });
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
