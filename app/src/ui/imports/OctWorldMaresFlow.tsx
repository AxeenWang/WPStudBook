import { useState } from 'react';
import type { ImportProgress } from '../../services/import-progress.ts';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import {
  matchedOctRows,
  octWorldMaresImportHandler,
  summariseOctRows,
  type OctMareRow,
} from '../../services/oct-world-mares-import.ts';
import { Feedback, useAction } from '../actions.tsx';
import { useServices } from '../ServicesContext.tsx';
import {
  confirmationOptions,
  ImportConfirmations,
  pendingConfirmations,
} from './ImportConfirmations.tsx';
import { summaryText, type ImportFlowProps } from './flow.ts';
import { OctWorldMaresPreview } from './OctWorldMaresPreview.tsx';

function countText(value: number): string {
  return value.toLocaleString('zh-TW');
}

/**
 * 十月全世界繁殖牝馬總表（需求規格 11.10，選用）：數千筆分批處理並顯示進度（12.5、OCT-08），
 * 預覽只列出配對到的自家產駒。不建立檢查點，也不列入年度工作清單。
 */
export function OctWorldMaresFlow({ file, choice, onApplied }: ImportFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const [prepared, setPrepared] = useState<PreparedImport<OctMareRow>>();
  const [progress, setProgress] = useState<ImportProgress>();
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());

  const preview = () => {
    void action.run(async () => {
      setPrepared(undefined);
      const result = await prepareImport(context, octWorldMaresImportHandler(), file, choice, {
        onProgress: setProgress,
      });
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
        octWorldMaresImportHandler(),
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
      <button type="button" onClick={preview} disabled={action.busy}>
        產生預覽
      </button>
      {progress !== undefined && (
        <p role="status" data-testid="import-progress">
          處理進度：{countText(progress.done)}／{countText(progress.total)} 筆
        </p>
      )}
      <Feedback message={action.message} error={action.error} />

      {prepared !== undefined && (
        <>
          <h3>預覽</h3>
          <p data-testid="import-summary">{summaryText(prepared.summary)}</p>
          <OctWorldMaresPreview matched={matchedOctRows(rows)} overview={summariseOctRows(rows)} />
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
