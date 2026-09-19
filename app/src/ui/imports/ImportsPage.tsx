import { useEffect, useState, type DragEvent } from 'react';
import type { Game } from '../../domain/game.ts';
import type { ImportType } from '../../domain/import-type.ts';
import type { Timing } from '../../domain/timing.ts';
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
import { Jan2yoFlow } from './Jan2yoFlow.tsx';
import { JulMaresFlow } from './JulMaresFlow.tsx';
import { MayMaresFlow } from './MayMaresFlow.tsx';
import { MayStallionsFlow } from './MayStallionsFlow.tsx';
import { OctWorldMaresFlow } from './OctWorldMaresFlow.tsx';
import { TargetStallionFlow } from './TargetStallionFlow.tsx';

const TYPE_OPTIONS: readonly SelectOption<ImportType>[] = (
  Object.keys(IMPORT_TYPE_LABELS) as ImportType[]
).map((value) => ({ value, label: IMPORT_TYPE_LABELS[value] }));

function ImportHistory() {
  const { data: history } = useServiceQuery(listImportHistory);
  if (history === undefined || history.length === 0) {
    return <p>這一局還沒有匯入紀錄。</p>;
  }
  return (
    // 歷程在固定高度的框內捲動；可捲動區域要能用鍵盤聚焦（axe scrollable-region-focusable）。
    <ul data-testid="import-history" tabIndex={0} aria-labelledby="import-history-heading">
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

/** 從總覽年度工作卡選好的檔案：卡片的類型是使用者明確的選擇，時點在檔名沒有時用卡片的月份。 */
export interface ImportRequest {
  readonly id: number;
  /** 交接時的遊戲局；換局後這個請求不再適用。 */
  readonly gameId: string;
  readonly file: File;
  readonly type: ImportType;
  readonly timing: Timing;
}

function ImportsView({
  currentGame,
  request,
}: {
  readonly currentGame: Game;
  readonly request: ImportRequest | undefined;
}) {
  const { notifyChanged } = useServices();
  const [file, setFile] = useState<ImportSource>();
  const [type, setType] = useState<ImportType>();
  const [gameYear, setGameYear] = useState<number | undefined>(currentGame.currentYear);
  const [month, setMonth] = useState<number | undefined>();
  const [week, setWeek] = useState<number | undefined>();

  const receive = async (picked: File, preset?: Pick<ImportRequest, 'type' | 'timing'>) => {
    const bytes = new Uint8Array(await picked.arrayBuffer());
    setFile({ fileName: picked.name, bytes });
    // 檔名只是預選，仍由使用者確認（需求規格 11.1、IMP-02、IMP-03）。
    const hint = readFileNameHint(picked.name);
    setType(preset?.type ?? hint?.importType);
    setGameYear(hint?.gameYear ?? currentGame.currentYear);
    setMonth(hint?.timing.month ?? preset?.timing.month);
    setWeek(hint?.timing.week ?? preset?.timing.week);
  };

  const requestId = request?.id;
  useEffect(() => {
    if (request !== undefined) {
      void receive(request.file, request);
    }
    // 同一個請求只接收一次；換請求時 id 會變。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

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
      <div className="section-head">
        <div>
          <h2 id="imports-heading">年度匯入</h2>
          <p>
            支援一月二歲馬總表、四月誕生幼駒總表、五月繁殖牝馬總表、七月繁殖牝馬總表、
            五月種牡馬總表、候選 TXT、目標種牡馬 TXT 與選用的十月全世界繁殖牝馬總表。
            匯入前會先顯示預覽，有阻擋錯誤時資料不變。
          </p>
        </div>
      </div>

      <div
        className="drop-zone"
        data-testid="import-drop-zone"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={onDrop}
      >
        <span className="drop-icon" aria-hidden="true">
          ⇩
        </span>
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

      {ready && choice.type === 'candidateFile' && (
        <CandidateFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
      )}
      {ready && choice.type === 'jan2yo' && (
        <Jan2yoFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
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
      {ready && choice.type === 'octWorldMares' && (
        <OctWorldMaresFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
      )}
      {ready && choice.type === 'targetStallion' && (
        <TargetStallionFlow key={flowKey} file={file} choice={choice} onApplied={notifyChanged} />
      )}

      <section aria-labelledby="import-history-heading" className="import-history">
        <h3 id="import-history-heading">匯入歷程</h3>
        <ImportHistory />
      </section>
    </section>
  );
}

export function ImportsPage({
  currentGame,
  request,
}: {
  readonly currentGame: Game | undefined;
  readonly request?: ImportRequest | undefined;
}) {
  return currentGame === undefined ? (
    <NoGameNotice />
  ) : (
    <ImportsView key={currentGame.id} currentGame={currentGame} request={request} />
  );
}
