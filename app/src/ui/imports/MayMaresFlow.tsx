import { useState } from 'react';
import { applyImport, prepareImport, type PreparedImport } from '../../services/imports.ts';
import {
  mayMaresImportHandler,
  summariseMayRows,
  unknownSubsystemsOf,
  withAbsentOverrides,
  type MayMareRow,
} from '../../services/may-mares-import.ts';
import { saveSystemMapEntry } from '../../services/system-map.ts';
import { Feedback, useAction } from '../actions.tsx';
import { PreviewControls } from './PreviewControls.tsx';
import { useServices } from '../ServicesContext.tsx';
import { summaryText, type ImportFlowProps } from './flow.ts';
import { MayMaresPreview } from './MayMaresPreview.tsx';

/** 補登未登錄子系統的親系統（LINE-05）；未補登仍可匯入，所以這只是預覽旁的一個入口。 */
function SubsystemForm({
  subsystems,
  onSaved,
}: {
  readonly subsystems: readonly string[];
  readonly onSaved: () => void;
}) {
  const { context } = useServices();
  const action = useAction();
  const [parentSystem, setParentSystem] = useState('');
  const [chosen, setChosen] = useState('');
  if (subsystems.length === 0) {
    return null;
  }
  // 補登一個之後清單會變短，選取的可能已經不在裡面，這時候退回第一個。
  const subsystem = subsystems.includes(chosen) ? chosen : (subsystems[0] ?? '');
  return (
    <div className="field-row" data-testid="may-unknown-subsystems">
      <p>
        這些父系還沒登錄在系統對照表：{subsystems.join('、')}。可以現在補登親系統，
        不補登也不影響這次匯入。
      </p>
      <div className="field">
        <label htmlFor="may-subsystem">子系統</label>
        <select
          id="may-subsystem"
          value={subsystem}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
        >
          {subsystems.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="may-parent-system">親系統</label>
        <input
          id="may-parent-system"
          value={parentSystem}
          onChange={(event) => {
            setParentSystem(event.target.value);
          }}
        />
      </div>
      <button
        type="button"
        disabled={action.busy}
        onClick={() => {
          void action.run(async () => {
            const saved = await saveSystemMapEntry(context, { subsystem, parentSystem });
            setParentSystem('');
            onSaved();
            return `已補登「${saved.subsystem}」的親系統「${saved.parentSystem}」`;
          });
        }}
      >
        補登親系統
      </button>
      <Feedback message={action.message} error={action.error} />
    </div>
  );
}

/**
 * 五月繁殖牝馬總表（需求規格 11.5）：整份對帳，沒有勾選；缺席者的處置可以逐匹更正（MARE-09）。
 */
export function MayMaresFlow({ file, choice, onApplied }: ImportFlowProps) {
  const { context } = useServices();
  const action = useAction();
  const [prepared, setPrepared] = useState<PreparedImport<MayMareRow>>();
  const [overrides, setOverrides] = useState<ReadonlyMap<string, 'retired' | 'sold'>>(new Map());

  const preview = () => {
    void action.run(async () => {
      const result = await prepareImport(context, mayMaresImportHandler(), file, choice);
      setPrepared(result);
      setOverrides(new Map());
      return `預覽完成：${summaryText(result.summary)}`;
    });
  };

  const apply = () => {
    void action.run(async () => {
      if (prepared === undefined) {
        throw new Error('請先產生預覽');
      }
      const rows = withAbsentOverrides(prepared.rows, overrides);
      const result = await applyImport(context, mayMaresImportHandler(), { ...prepared, rows }, {});
      setPrepared(undefined);
      setOverrides(new Map());
      onApplied();
      return `已套用 ${String(result.appliedRows)} 筆。`;
    });
  };

  const rows = prepared === undefined ? [] : withAbsentOverrides(prepared.rows, overrides);

  return (
    <>
      <PreviewControls action={action} onPreview={preview} />

      {prepared !== undefined && (
        <>
          <SubsystemForm subsystems={unknownSubsystemsOf(rows)} onSaved={preview} />
          <h3>預覽</h3>
          <p data-testid="import-summary">{summaryText(prepared.summary)}</p>
          <MayMaresPreview
            rows={rows}
            overview={summariseMayRows(rows)}
            absentOverrides={overrides}
            onAbsentChange={(key, disposition) => {
              setOverrides((previous) => new Map([...previous, [key, disposition]]));
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
