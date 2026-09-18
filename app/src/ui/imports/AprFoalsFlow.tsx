import { useState } from 'react';
import type { Game } from '../../domain/game.ts';
import {
  aprFoalsImportHandler,
  summariseAprRows,
  withReviewConfirmed,
  type AprFoalRow,
} from '../../services/apr-foals-import.ts';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import { Feedback, useAction } from '../actions.tsx';
import { useServices } from '../ServicesContext.tsx';
import { AprFoalsPreview } from './AprFoalsPreview.tsx';
import {
  confirmationOptions,
  ImportConfirmations,
  pendingConfirmations,
} from './ImportConfirmations.tsx';
import { summaryText, type ImportFlowProps } from './flow.ts';

interface AprFoalsFlowProps extends ImportFlowProps {
  readonly currentGame: Game;
}

/**
 * 四月誕生幼駒總表（需求規格 11.4）：整份對帳。待核對的列逐匹勾選確認後才建立（APR-03），
 * 未見產駒只列出不寫入（APR-05）。
 */
export function AprFoalsFlow({ file, choice, onApplied, currentGame }: AprFoalsFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const [prepared, setPrepared] = useState<PreparedImport<AprFoalRow>>();
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());

  const preview = () => {
    void action.run(async () => {
      const result = await prepareImport(context, aprFoalsImportHandler(), file, choice);
      setPrepared(result);
      setReviewed(new Set());
      setConfirmed(new Set());
      return `預覽完成：${summaryText(result.summary)}`;
    });
  };

  const rows =
    prepared === undefined ? [] : withReviewConfirmed(prepared.rows, reviewed, currentGame);
  const pending = prepared === undefined ? [] : pendingConfirmations(prepared, rows);

  const apply = () => {
    void action.run(async () => {
      if (prepared === undefined) {
        throw new Error('請先產生預覽');
      }
      const result = await applyImport(
        context,
        aprFoalsImportHandler(),
        { ...prepared, rows },
        confirmationOptions(pending, confirmed),
      );
      setPrepared(undefined);
      setReviewed(new Set());
      setConfirmed(new Set());
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
          <AprFoalsPreview
            rows={rows}
            overview={summariseAprRows(rows)}
            confirmed={reviewed}
            onConfirm={(key, checked) => {
              setReviewed((previous) =>
                checked
                  ? new Set([...previous, key])
                  : new Set([...previous].filter((item) => item !== key)),
              );
            }}
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
          <button type="button" onClick={apply} disabled={action.busy}>
            套用這份總表
          </button>
        </>
      )}
    </>
  );
}
