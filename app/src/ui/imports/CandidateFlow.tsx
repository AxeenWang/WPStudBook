import { useState } from 'react';
import type { MareSite } from '../../domain/mare.ts';
import {
  candidateImportHandler,
  type CandidateRow,
  type CandidateTarget,
} from '../../services/candidate-import.ts';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import { listLineSlots } from '../../services/lines.ts';
import {
  defaultOriginFor,
  MARE_ORIGIN_OPTIONS,
  MARE_POSITION_OPTIONS,
  MARE_SITE_OPTIONS,
} from '../../services/mares.ts';
import { Feedback, useAction } from '../actions.tsx';
import { OptionalIntegerField, SelectField, type SelectOption } from '../fields.tsx';
import { ORIGIN_LABELS, SITE_LABELS } from '../mares/labels.ts';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { CandidatePreview } from './CandidatePreview.tsx';
import { summaryText, type ImportFlowProps } from './flow.ts';

const SITE_OPTIONS: readonly SelectOption<MareSite>[] = MARE_SITE_OPTIONS.map((value) => ({
  value,
  label: SITE_LABELS[value],
}));

const ORIGIN_OPTIONS = MARE_ORIGIN_OPTIONS.map((value) => ({
  value,
  label: ORIGIN_LABELS[value],
}));

const POSITION_OPTIONS: readonly SelectOption<number>[] = MARE_POSITION_OPTIONS.map((value) => ({
  value,
  label: `第 ${String(value)} 系`,
}));

/**
 * 勾選的增減：以重建集合完成。Set 的 delete 會被禁止物理刪除的原始碼檢查誤判（PED-10），
 * 那個檢查是刻意做得很鈍的，不值得為了一個畫面狀態放寬它。
 */
function toggleSelection(
  previous: ReadonlySet<string>,
  keys: readonly string[],
  checked: boolean,
): ReadonlySet<string> {
  if (checked) {
    return new Set([...previous, ...keys]);
  }
  const removing = new Set(keys);
  return new Set([...previous].filter((value) => !removing.has(value)));
}

/** 候選 TXT（需求規格 11.7）：整份共用一組用途，逐匹勾選要建立的母馬。 */
export function CandidateFlow({ file, choice, onApplied }: ImportFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const { data: slots } = useServiceQuery(listLineSlots);
  const [prepared, setPrepared] = useState<PreparedImport<CandidateRow>>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [position, setPosition] = useState<number>();
  const [generation, setGeneration] = useState<number>();
  const [site, setSite] = useState<MareSite>(32);
  const [origin, setOrigin] = useState(defaultOriginFor(1, 1, []) ?? 'marketMixed');

  const openedPositions = (slots ?? [])
    .filter((slot) => slot.line !== undefined)
    .map((slot) => slot.position);

  const target: CandidateTarget = {
    group:
      position === undefined || generation === undefined ? undefined : { position, generation },
    site,
    origin,
  };

  const preview = () => {
    void action.run(async () => {
      const result = await prepareImport(context, candidateImportHandler(target), file, choice);
      setPrepared(result);
      setSelected(
        new Set(result.rows.filter((row) => row.outcome === 'apply').map((row) => row.key)),
      );
      return `預覽完成：${summaryText(result.summary)}`;
    });
  };

  const apply = () => {
    void action.run(async () => {
      if (prepared === undefined) {
        throw new Error('請先產生預覽');
      }
      const result = await applyImport(context, candidateImportHandler(target), prepared, {
        selectedKeys: [...selected],
      });
      setPrepared(undefined);
      setSelected(new Set());
      onApplied();
      return `已匯入 ${String(result.appliedRows)} 匹母馬。`;
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
          <h3>用途</h3>
          <p>原牧場只記為來源，據點由你選（需求規格 11.7）。</p>
          <div className="field-row">
            <SelectField
              label="母馬群"
              value={position}
              options={POSITION_OPTIONS}
              emptyLabel="待指定用途"
              onChange={(value) => {
                setPosition(value);
                if (value !== undefined && generation !== undefined) {
                  setOrigin(defaultOriginFor(value, generation, openedPositions) ?? origin);
                }
              }}
            />
            <OptionalIntegerField
              label="代數"
              value={generation}
              onChange={(value) => {
                setGeneration(value);
                if (position !== undefined && value !== undefined) {
                  setOrigin(defaultOriginFor(position, value, openedPositions) ?? origin);
                }
              }}
            />
            <SelectField
              label="據點"
              value={site}
              options={SITE_OPTIONS}
              onChange={(value) => {
                setSite(value ?? 32);
              }}
            />
            <SelectField
              label="來源"
              value={origin}
              options={ORIGIN_OPTIONS}
              onChange={(value) => {
                setOrigin(value ?? 'marketMixed');
              }}
            />
          </div>

          <h3>預覽</h3>
          <p data-testid="import-summary">{summaryText(prepared.summary)}</p>
          <CandidatePreview
            rows={prepared.rows}
            selected={selected}
            onToggle={(key, checked) => {
              setSelected((previous) => toggleSelection(previous, [key], checked));
            }}
            onToggleShown={(keys, checked) => {
              setSelected((previous) => toggleSelection(previous, keys, checked));
            }}
          />
          <button type="button" onClick={apply} disabled={action.busy || selected.size === 0}>
            匯入勾選的 {selected.size} 匹
          </button>
        </>
      )}
    </>
  );
}
