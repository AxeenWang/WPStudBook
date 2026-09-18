import type { ReactNode } from 'react';
import type {
  Jan2yoOverview,
  Jan2yoRow,
  JanDisposition,
  JanFoal,
  JanMatch,
} from '../../services/jan2yo-import.ts';
import { horseNumberText } from '../../services/mares.ts';
import { OUTCOME_LABELS } from './labels.ts';

export const JAN_DISPOSITION_LABELS: Readonly<Record<JanDisposition, string>> = {
  name: '補正式馬名',
  unchanged: '已是最新',
  review: '人工確認',
  conflict: '衝突',
  unseen: '未出現在總表',
  unmanaged: '非管理的馬',
  invalid: '略過',
};

const MATCH_LABELS: Readonly<Record<JanMatch, string>> = {
  abilityNo: '能力番号＋出生年',
  parents: '父馬＋母馬＋出生年',
  confirmed: '人工確認',
};

function overviewText(overview: Jan2yoOverview): string {
  return [
    `總表 ${String(overview.fileRows)} 筆`,
    `補名 ${String(overview.name)}`,
    `取代既有名稱 ${String(overview.replaced)}`,
    `已是最新 ${String(overview.unchanged)}`,
    `人工確認 ${String(overview.review)}`,
    `衝突 ${String(overview.conflict)}`,
    `未出現在總表 ${String(overview.unseen)}`,
  ].join('、');
}

function candidateText(candidate: JanFoal): string {
  return `${candidate.label}（母 ${candidate.damLabel ?? '未取得'}・父 ${candidate.sireLabel ?? '未取得'}）`;
}

interface CandidatePickerProps {
  readonly row: Jan2yoRow;
  readonly chosen: ReadonlyMap<string, string>;
  /** 已經被其他列唯一配對或選定的產駒。 */
  readonly taken: ReadonlySet<string>;
  readonly onChoose: (key: string, foalId: string | undefined) => void;
}

/** 人工確認：從候選中選定一匹產駒（需求規格 11.3、JAN-03）。同一匹產駒只能給一列。 */
function CandidatePicker({ row, chosen, taken, onChoose }: CandidatePickerProps) {
  const current = chosen.get(row.key);
  return (
    <select
      aria-label={`${row.label} 對應的產駒`}
      value={current ?? ''}
      onChange={(event) => {
        onChoose(row.key, event.target.value === '' ? undefined : event.target.value);
      }}
    >
      <option value="">不選（不寫入）</option>
      {row.candidates.map((candidate) => (
        <option
          key={candidate.foal.id}
          value={candidate.foal.id}
          disabled={candidate.foal.id !== current && taken.has(candidate.foal.id)}
        >
          {candidateText(candidate)}
        </option>
      ))}
    </select>
  );
}

function targetCell(row: Jan2yoRow, picker: Omit<CandidatePickerProps, 'row'>): ReactNode {
  // 人工確認選定的列保留選單，讓使用者可以改選或取消。
  if (row.target !== undefined && row.disposition !== 'review' && row.matchedBy !== 'confirmed') {
    const via = row.matchedBy === undefined ? '' : `（${MATCH_LABELS[row.matchedBy]}）`;
    return `${row.target.label}${via}`;
  }
  if (row.candidates.length > 0 || picker.chosen.has(row.key)) {
    return <CandidatePicker row={row} {...picker} />;
  }
  return '—';
}

interface Jan2yoPreviewProps {
  readonly rows: readonly Jan2yoRow[];
  readonly overview: Jan2yoOverview;
  readonly chosen: ReadonlyMap<string, string>;
  readonly onChoose: (key: string, foalId: string | undefined) => void;
}

/**
 * 一月二歲馬總表的預覽（需求規格 11.3）：只列和這一局的產駒有關的列，
 * 非管理的二歲馬只顯示筆數（JAN-02）。
 */
export function Jan2yoPreview(props: Jan2yoPreviewProps) {
  const shown = props.rows.filter((row) => row.disposition !== 'unmanaged');
  const taken = new Set(
    props.rows.flatMap((row) =>
      row.disposition === 'name' && row.target !== undefined ? [row.target.foal.id] : [],
    ),
  );
  for (const foalId of props.chosen.values()) {
    taken.add(foalId);
  }
  return (
    <div className="may-preview">
      <p data-testid="jan-birth-year">
        出生年 {props.overview.birthYear} 年（匯出年減 2）；總表的其他二歲馬{' '}
        {props.overview.unmanaged} 筆不是這一局的產駒，略過。
      </p>
      <p data-testid="jan-overview">{overviewText(props.overview)}</p>

      {shown.length === 0 ? (
        <p>這份總表沒有和這一局的產駒有關的列。</p>
      ) : (
        <table data-testid="jan-preview-table">
          <caption>二歲馬補名</caption>
          <thead>
            <tr>
              <th scope="col">總表馬名</th>
              <th scope="col">處置</th>
              <th scope="col">對應的產駒</th>
              <th scope="col">父馬／母馬</th>
              <th scope="col">競走馬馬番号</th>
              <th scope="col">分類與說明</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} data-testid={`jan-row-${row.key}`}>
                <th scope="row">{row.values === undefined ? '—' : row.label}</th>
                <td>{JAN_DISPOSITION_LABELS[row.disposition]}</td>
                <td>
                  {targetCell(row, { chosen: props.chosen, taken, onChoose: props.onChoose })}
                </td>
                <td>
                  {row.values === undefined
                    ? '—'
                    : `${row.values.sireName ?? '—'}／${row.values.damName ?? '—'}`}
                </td>
                <td>
                  {row.values?.horseNo === undefined ? '—' : horseNumberText(row.values.horseNo)}
                </td>
                <td>
                  {OUTCOME_LABELS[row.outcome]}
                  {row.issues.length > 0 && (
                    <span>：{row.issues.map((issue) => issue.message).join('；')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
