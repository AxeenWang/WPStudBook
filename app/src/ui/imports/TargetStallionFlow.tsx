import { useState } from 'react';
import type { LinePosition } from '../../domain/line.ts';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import { defaultLineColor, LINE_COLOR_OPTIONS } from '../../services/lines.ts';
import {
  targetStallionImportHandler,
  type TargetStallionRow,
  type TargetStallionTarget,
} from '../../services/target-stallion-import.ts';
import { Feedback, useAction } from '../actions.tsx';
import { SelectField, type SelectOption } from '../fields.tsx';
import { useServices } from '../ServicesContext.tsx';
import {
  confirmationOptions,
  ImportConfirmations,
  pendingConfirmations,
} from './ImportConfirmations.tsx';
import { OUTCOME_LABELS } from './labels.ts';
import { summaryText, type ImportFlowProps } from './flow.ts';

type TargetKind = TargetStallionTarget['kind'];

const KIND_OPTIONS: readonly SelectOption<TargetKind>[] = [
  { value: 'openLine', label: '開啟建立新系的分支' },
  { value: 'replaceFounder', label: '替換提前引退的零代種牡馬' },
];

const POSITION_OPTIONS: readonly SelectOption<LinePosition>[] = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (value) => ({ value: value as LinePosition, label: `第 ${String(value)} 系` }),
);

const COLOR_OPTIONS: readonly SelectOption<string>[] = LINE_COLOR_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

/** 預覽只有一列，所以直接把那一匹的資料攤開來看（需求規格 11.9）。 */
function TargetStallionPreview({ row }: { readonly row: TargetStallionRow }) {
  const { values } = row;
  return (
    <dl data-testid="target-stallion-preview">
      <div>
        <dt>馬名</dt>
        <dd>{row.label}</dd>
      </div>
      <div>
        <dt>能力</dt>
        <dd>
          SP {values.sp ?? '—'}／ST {values.st ?? '—'}／サ {values.subParamTotal ?? '—'}
        </dd>
      </div>
      <div>
        <dt>父母</dt>
        <dd>
          {values.sireName ?? '—'} × {values.damName ?? '—'}
        </dd>
      </div>
      <div>
        <dt>父系</dt>
        <dd>{values.sireSubsystem ?? '—'}</dd>
      </div>
      <div>
        <dt>要連結的系</dt>
        <dd>
          第 {row.position} 系
          {row.replacement === undefined ? '（建立新系）' : '（替換零代種牡馬）'}
        </dd>
      </div>
      <div>
        <dt>沿用既有紀錄</dt>
        <dd>
          {row.reuse === undefined ? '否，會建立新的種牡馬紀錄' : '是，沿用五月總表建立的那一筆'}
        </dd>
      </div>
      <div>
        <dt>分類與說明</dt>
        <dd data-testid="target-stallion-outcome">
          {OUTCOME_LABELS[row.outcome]}
          {row.issues.length > 0 && `：${row.issues.map((issue) => issue.message).join('；')}`}
        </dd>
      </div>
    </dl>
  );
}

/**
 * 目標種牡馬 TXT（需求規格 11.9）：整份一匹，用途是開啟建立新系的分支或替換提前引退的
 * 零代種牡馬。不是年度總表，所以不推進年份、不建立檢查點。
 */
export function TargetStallionFlow({ file, choice, onApplied }: ImportFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const [prepared, setPrepared] = useState<PreparedImport<TargetStallionRow>>();
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [kind, setKind] = useState<TargetKind>('openLine');
  const [position, setPosition] = useState<LinePosition>(1);
  const [subsystem, setSubsystem] = useState('');
  const [parentSystem, setParentSystem] = useState('');
  const [color, setColor] = useState(defaultLineColor());

  const target: TargetStallionTarget =
    kind === 'openLine' ? { kind, position, subsystem, parentSystem, color } : { kind, position };

  const preview = () => {
    void action.run(async () => {
      const result = await prepareImport(
        context,
        targetStallionImportHandler(target),
        file,
        choice,
      );
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
        targetStallionImportHandler(target),
        prepared,
        confirmationOptions(pending, confirmed),
      );
      setPrepared(undefined);
      setConfirmed(new Set());
      onApplied();
      return `已套用 ${String(result.appliedRows)} 匹目標種牡馬。`;
    });
  };

  return (
    <>
      <h3>用途</h3>
      <div className="field-row">
        <SelectField
          label="用途"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(value) => {
            setKind(value ?? 'openLine');
            setPrepared(undefined);
          }}
        />
        <SelectField
          label="系位置"
          value={position}
          options={POSITION_OPTIONS}
          onChange={(value) => {
            setPosition(value ?? 1);
            setPrepared(undefined);
          }}
        />
        {kind === 'openLine' && (
          <>
            <div className="field">
              <label htmlFor="target-subsystem">目前子系統</label>
              <input
                id="target-subsystem"
                value={subsystem}
                placeholder="留白時取檔案的父系"
                onChange={(event) => {
                  setSubsystem(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="target-parent-system">親系統</label>
              <input
                id="target-parent-system"
                value={parentSystem}
                placeholder="留白時取系統對照表"
                onChange={(event) => {
                  setParentSystem(event.target.value);
                }}
              />
            </div>
            <SelectField
              label="代表色"
              value={color}
              options={COLOR_OPTIONS}
              onChange={(value) => {
                setColor(value ?? defaultLineColor());
              }}
            />
          </>
        )}
      </div>

      <button type="button" onClick={preview} disabled={action.busy}>
        產生預覽
      </button>
      <Feedback message={action.message} error={action.error} />

      {prepared !== undefined && rows[0] !== undefined && (
        <>
          <h3>預覽</h3>
          <p data-testid="import-summary">{summaryText(prepared.summary)}</p>
          <TargetStallionPreview row={rows[0]} />
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
            套用這匹目標種牡馬
          </button>
        </>
      )}
    </>
  );
}
