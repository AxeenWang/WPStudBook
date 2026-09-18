import { useState, type DragEvent } from 'react';
import type { Game } from '../../domain/game.ts';
import type { ImportType } from '../../domain/import-type.ts';
import {
  listImportHistory,
  readFileNameHint,
  type ImportChoice,
  type ImportSource,
} from '../../services/imports.ts';
import { OptionalIntegerField, SelectField, type SelectOption } from '../fields.tsx';
import { formatDateTime } from '../format.ts';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { CandidateFlow } from './CandidateFlow.tsx';
import { IMPORT_TYPE_LABELS } from '../import-labels.ts';
import { formatTiming } from './labels.ts';
import { AprFoalsFlow } from './AprFoalsFlow.tsx';
import { JulMaresFlow } from './JulMaresFlow.tsx';
import { MayMaresFlow } from './MayMaresFlow.tsx';
import { MayStallionsFlow } from './MayStallionsFlow.tsx';
import { TargetStallionFlow } from './TargetStallionFlow.tsx';

/** 已經做到的匯入類型；其餘在後續子計畫加入。 */
const IMPLEMENTED_TYPES: readonly ImportType[] = [
  'candidateFile',
  'aprFoals',
  'mayMares',
  'julMares',
  'mayStallions',
  'targetStallion',
];

const TYPE_OPTIONS: readonly SelectOption<ImportType>[] = (
  Object.keys(IMPORT_TYPE_LABELS) as ImportType[]
).map((value) => ({ value, label: IMPORT_TYPE_LABELS[value] }));

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
  const { notifyChanged } = useServices();
  const [file, setFile] = useState<ImportSource>();
  const [type, setType] = useState<ImportType>();
  const [gameYear, setGameYear] = useState<number | undefined>(currentGame.currentYear);
  const [month, setMonth] = useState<number | undefined>();
  const [week, setWeek] = useState<number | undefined>();

  const receive = async (picked: File) => {
    const bytes = new Uint8Array(await picked.arrayBuffer());
    setFile({ fileName: picked.name, bytes });
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
  const ready = file !== undefined && choice !== undefined;
  // 換檔案、類型或時點時整個流程重來，不留上一次的預覽。
  const flowKey = `${file?.fileName ?? ''}:${type ?? ''}:${String(gameYear)}:${String(month)}:${String(week)}`;

  return (
    <section aria-labelledby="imports-heading">
      <h2 id="imports-heading">年度匯入</h2>
      <p>
        目前支援候選 TXT、五月繁殖牝馬總表、七月繁殖牝馬總表、五月種牡馬總表與 目標種牡馬
        TXT；其他年度總表在後續子計畫加入。 匯入前會先顯示預覽，有阻擋錯誤時資料不變。
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
        </div>
      )}

      {ready && !IMPLEMENTED_TYPES.includes(choice.type) && (
        <p role="alert">{IMPORT_TYPE_LABELS[choice.type]}的匯入在後續子計畫加入。</p>
      )}
      {ready && choice.type === 'candidateFile' && (
        <CandidateFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
      )}
      {ready && choice.type === 'aprFoals' && (
        <AprFoalsFlow
          key={flowKey}
          file={file}
          choice={choice}
          onApplied={notifyChanged}
          currentGame={currentGame}
        />
      )}
      {ready && choice.type === 'mayMares' && (
        <MayMaresFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
      )}
      {ready && choice.type === 'julMares' && (
        <JulMaresFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
      )}
      {ready && choice.type === 'mayStallions' && (
        <MayStallionsFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
      )}
      {ready && choice.type === 'targetStallion' && (
        <TargetStallionFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
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
