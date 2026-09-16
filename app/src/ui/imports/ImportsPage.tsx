import { useState, type DragEvent } from 'react';
import type { Game } from '../../domain/game.ts';
import type { MareSite } from '../../domain/mare.ts';
import type { ImportType } from '../../domain/import-type.ts';
import {
  candidateImportHandler,
  type CandidateRow,
  type CandidateTarget,
} from '../../services/candidate-import.ts';
import {
  applyImport,
  listImportHistory,
  prepareImport,
  readFileNameHint,
  type ImportChoice,
  type PreparedImport,
} from '../../services/imports.ts';
import {
  defaultOriginFor,
  MARE_ORIGIN_OPTIONS,
  MARE_POSITION_OPTIONS,
  MARE_SITE_OPTIONS,
} from '../../services/mares.ts';
import { listLineSlots } from '../../services/lines.ts';
import { Feedback, useAction } from '../actions.tsx';
import { OptionalIntegerField, SelectField, type SelectOption } from '../fields.tsx';
import { formatDateTime } from '../format.ts';
import { ORIGIN_LABELS, SITE_LABELS } from '../mares/labels.ts';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { CandidatePreview } from './CandidatePreview.tsx';
import { IMPORT_TYPE_LABELS, OUTCOME_LABELS, formatTiming } from './labels.ts';

/** 子計畫 4-1 只做候選 TXT；其他類型在後續子計畫加入。 */
const IMPLEMENTED_TYPES: readonly ImportType[] = ['candidateFile'];

const TYPE_OPTIONS: readonly SelectOption<ImportType>[] = (
  Object.keys(IMPORT_TYPE_LABELS) as ImportType[]
).map((value) => ({ value, label: IMPORT_TYPE_LABELS[value] }));

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

interface PickedFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/**
 * 勾選的增減：以重建集合完成。Set 的 delete 會被禁止物理刪除的原始碼檢查誤判（PED-10），
 * 那個檢查是刻意做得很鈍的，不值得為了一個畫面狀態放寬它。
 */
function toggleSelection(
  previous: ReadonlySet<number>,
  lineNumbers: readonly number[],
  checked: boolean,
): ReadonlySet<number> {
  if (checked) {
    return new Set([...previous, ...lineNumbers]);
  }
  const removing = new Set(lineNumbers);
  return new Set([...previous].filter((value) => !removing.has(value)));
}

function summaryText(summary: PreparedImport<CandidateRow>['summary']): string {
  return (Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[])
    .map((key) => `${OUTCOME_LABELS[key]} ${String(summary[key])}`)
    .join('、');
}

function ImportHistory() {
  const { data: history } = useServiceQuery(listImportHistory);
  if (history === undefined || history.length === 0) {
    return <p>這一局還沒有匯入紀錄。</p>;
  }
  return (
    <ul data-testid="import-history">
      {history.map((batch) => (
        <li key={batch.id}>
          {batch.gameYear} 年 {formatTiming(batch.timing.month, batch.timing.week)} ·{' '}
          {IMPORT_TYPE_LABELS[batch.type]} · {batch.fileName} · {formatDateTime(batch.appliedAt)}
          {batch.correctionOf !== undefined && '（資料更正）'}
        </li>
      ))}
    </ul>
  );
}

function ImportsView({ currentGame }: { readonly currentGame: Game }) {
  const { context } = useServices();
  const action = useAction();
  const { data: slots } = useServiceQuery(listLineSlots);
  const [file, setFile] = useState<PickedFile>();
  const [type, setType] = useState<ImportType>();
  const [gameYear, setGameYear] = useState<number | undefined>(currentGame.currentYear);
  const [month, setMonth] = useState<number | undefined>();
  const [week, setWeek] = useState<number | undefined>();
  const [prepared, setPrepared] = useState<PreparedImport<CandidateRow>>();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [position, setPosition] = useState<number>();
  const [generation, setGeneration] = useState<number>();
  const [site, setSite] = useState<MareSite>(32);
  const [origin, setOrigin] = useState(defaultOriginFor(1, 1, []) ?? 'marketMixed');

  const openedPositions = (slots ?? [])
    .filter((slot) => slot.line !== undefined)
    .map((slot) => slot.position);

  const receive = async (picked: File) => {
    const bytes = new Uint8Array(await picked.arrayBuffer());
    setFile({ fileName: picked.name, bytes });
    setPrepared(undefined);
    setSelected(new Set());
    // 檔名只是預選，仍由使用者確認（需求規格 11.1、IMP-02、IMP-03）。
    const hint = readFileNameHint(picked.name);
    setType(hint?.importType);
    setGameYear(hint?.gameYear ?? currentGame.currentYear);
    setMonth(hint?.timing.month);
    setWeek(hint?.timing.week);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files.item(0);
    if (dropped !== null) {
      void receive(dropped);
    }
  };

  const choice: ImportChoice | undefined =
    type === undefined || gameYear === undefined || month === undefined || week === undefined
      ? undefined
      : { type, gameYear, timing: { month, week } };

  const target: CandidateTarget = {
    group:
      position === undefined || generation === undefined ? undefined : { position, generation },
    site,
    origin,
  };

  const preview = () => {
    void action.run(async () => {
      if (file === undefined || choice === undefined) {
        throw new Error('請先選擇檔案、匯入類型、年份與時點');
      }
      if (!IMPLEMENTED_TYPES.includes(choice.type)) {
        throw new Error(`${IMPORT_TYPE_LABELS[choice.type]}的匯入在後續子計畫加入`);
      }
      const result = await prepareImport(context, candidateImportHandler(target), file, choice);
      setPrepared(result);
      setSelected(
        new Set(result.rows.filter((row) => row.outcome === 'apply').map((row) => row.lineNumber)),
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
        selectedLineNumbers: [...selected],
      });
      setPrepared(undefined);
      setSelected(new Set());
      setFile(undefined);
      return `已匯入 ${String(result.appliedRows)} 匹母馬。`;
    });
  };

  return (
    <section aria-labelledby="imports-heading">
      <h2 id="imports-heading">年度匯入</h2>
      <p>
        目前支援候選 TXT；其他年度總表在後續子計畫加入。匯入前會先顯示預覽，有阻擋錯誤時資料不變。
      </p>

      <div
        className="drop-zone"
        data-testid="import-drop-zone"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={onDrop}
      >
        <label htmlFor="import-file">選擇匯入檔（也可以把檔案拖放到這裡）</label>
        <input
          id="import-file"
          type="file"
          accept=".txt,.tsv,.csv"
          onChange={(event) => {
            const picked = event.target.files?.item(0);
            if (picked !== null && picked !== undefined) {
              void receive(picked);
            }
          }}
        />
        {file !== undefined && <p data-testid="import-file-name">已選擇：{file.fileName}</p>}
      </div>

      {file !== undefined && (
        <div className="field-row">
          <SelectField
            label="匯入類型"
            value={type}
            options={TYPE_OPTIONS}
            emptyLabel="請選擇"
            onChange={setType}
          />
          <OptionalIntegerField label="遊戲年" value={gameYear} onChange={setGameYear} />
          <OptionalIntegerField label="月" value={month} onChange={setMonth} />
          <OptionalIntegerField label="週" value={week} onChange={setWeek} />
          <button type="button" onClick={preview} disabled={action.busy}>
            產生預覽
          </button>
        </div>
      )}

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
            onToggle={(lineNumber, checked) => {
              setSelected((previous) => toggleSelection(previous, [lineNumber], checked));
            }}
            onToggleShown={(lineNumbers, checked) => {
              setSelected((previous) => toggleSelection(previous, lineNumbers, checked));
            }}
          />
          <button type="button" onClick={apply} disabled={action.busy || selected.size === 0}>
            匯入勾選的 {selected.size} 匹
          </button>
        </>
      )}

      <h3>匯入歷程</h3>
      <ImportHistory />
    </section>
  );
}

export function ImportsPage({ currentGame }: { readonly currentGame: Game | undefined }) {
  return currentGame === undefined ? (
    <NoGameNotice />
  ) : (
    <ImportsView key={currentGame.id} currentGame={currentGame} />
  );
}
