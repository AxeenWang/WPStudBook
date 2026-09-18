import type {
  OctDisposition,
  OctMareRow,
  OctOverview,
} from '../../services/oct-world-mares-import.ts';
import { horseNumberText } from '../../services/mares.ts';
import { OUTCOME_LABELS } from './labels.ts';

export const OCT_DISPOSITION_LABELS: Readonly<Record<OctDisposition, string>> = {
  new: '新發現',
  continuing: '持續在表',
  moved: '轉場',
  unchanged: '已記錄過',
  conflict: '衝突',
  ownFarm: '自家牧場，略過',
  other: '其他，略過',
};

function overviewText(overview: OctOverview): string {
  return [
    `總數 ${String(overview.total)}`,
    `自家牧場略過 ${String(overview.ownFarm)}`,
    `其他略過 ${String(overview.other)}`,
    `新發現 ${String(overview.new)}`,
    `持續在表 ${String(overview.continuing)}`,
    `轉場 ${String(overview.moved)}`,
    `衝突 ${String(overview.conflict)}`,
  ].join('、');
}

function farmText(row: OctMareRow): string {
  const farm = row.values.farmNo === undefined ? '—' : String(row.values.farmNo);
  const fate = row.horse?.fate;
  return row.disposition === 'moved' && fate?.kind === 'mareElsewhere'
    ? `${String(fate.farmNo)} → ${farm}`
    : farm;
}

interface OctWorldMaresPreviewProps {
  /** 只有配對到的自家產駒；略過的列只算筆數（需求規格 11.10、OCT-08）。 */
  readonly matched: readonly OctMareRow[];
  readonly overview: OctOverview;
}

/** 十月全世界繁殖牝馬總表的預覽（需求規格 11.10）：只為配對到的自家產駒建立畫面元素。 */
export function OctWorldMaresPreview({ matched, overview }: OctWorldMaresPreviewProps) {
  return (
    <div className="may-preview">
      <p data-testid="oct-overview">{overviewText(overview)}</p>
      {matched.length === 0 ? (
        <p>這份總表沒有在其他牧場的自家產駒。</p>
      ) : (
        <table data-testid="oct-preview-table">
          <caption>在其他牧場的自家產駒</caption>
          <thead>
            <tr>
              <th scope="col">總表馬名</th>
              <th scope="col">本局產駒</th>
              <th scope="col">處置</th>
              <th scope="col">所在牧場</th>
              <th scope="col">繁殖牝馬馬番号</th>
              <th scope="col">分類與說明</th>
            </tr>
          </thead>
          <tbody>
            {matched.map((row) => (
              <tr key={row.key} data-testid={`oct-row-${row.key}`}>
                <th scope="row">{row.label}</th>
                <td>{row.foalLabel ?? '—'}</td>
                <td>{OCT_DISPOSITION_LABELS[row.disposition]}</td>
                <td>{farmText(row)}</td>
                <td>
                  {row.values.horseNo === undefined ? '—' : horseNumberText(row.values.horseNo)}
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
