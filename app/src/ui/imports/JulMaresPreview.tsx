import type {
  JulDisposition,
  JulMareRow,
  JulMaresOverview,
} from '../../services/jul-mares-import.ts';
import { horseNumberText } from '../../services/mares.ts';
import { formatVitality } from '../mares/labels.ts';
import { OUTCOME_LABELS } from './labels.ts';

export const JUL_DISPOSITION_LABELS: Readonly<Record<JulDisposition, string>> = {
  update: '更新受胎結果',
  create: '自動建立配種紀錄',
  deviate: '與指定配種有差異',
  vitalityOnly: '只保存活力',
  unmatched: '待處理',
  absent: '七月缺席',
  conflict: '衝突',
};

function overviewText(overview: JulMaresOverview): string {
  return [
    `總數 ${String(overview.total)}`,
    `更新 ${String(overview.update)}`,
    `自動建立 ${String(overview.create)}`,
    `差異 ${String(overview.deviate)}`,
    `只保存活力 ${String(overview.vitalityOnly)}`,
    `待處理 ${String(overview.unmatched)}`,
    `七月缺席 ${String(overview.absent)}`,
    `衝突 ${String(overview.conflict)}`,
  ].join('、');
}

function conceptionsText(overview: JulMaresOverview): string {
  return (Object.keys(overview.conceptions) as (keyof JulMaresOverview['conceptions'])[])
    .map((status) => `${status} ${String(overview.conceptions[status])}`)
    .join('、');
}

interface JulMaresPreviewProps {
  readonly rows: readonly JulMareRow[];
  readonly overview: JulMaresOverview;
}

/** 七月繁殖牝馬總表的預覽（需求規格 11.6）：四種狀態統計，以及未配對、差異與錯誤。 */
export function JulMaresPreview(props: JulMaresPreviewProps) {
  return (
    <div className="may-preview">
      <p data-testid="jul-overview">{overviewText(props.overview)}</p>
      <p data-testid="jul-conceptions">狀態分布：{conceptionsText(props.overview)}</p>

      <table data-testid="jul-preview-table">
        <caption>受胎結果對帳</caption>
        <thead>
          <tr>
            <th scope="col">馬名</th>
            <th scope="col">處置</th>
            <th scope="col">狀態</th>
            <th scope="col">種付け種牡馬</th>
            <th scope="col">7 月活力</th>
            <th scope="col">能力番号</th>
            <th scope="col">分類與說明</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.key} data-testid={`jul-row-${row.key}`}>
              <th scope="row">{row.label}</th>
              <td>{JUL_DISPOSITION_LABELS[row.disposition]}</td>
              <td>{row.conception ?? '—'}</td>
              <td>
                {row.stallionName ?? (row.stallionId === undefined ? '—' : '已對應到內部紀錄')}
              </td>
              <td>{row.vitality === undefined ? '—' : formatVitality(row.vitality, 7)}</td>
              <td>
                {row.values?.abilityNo === undefined ? '—' : horseNumberText(row.values.abilityNo)}
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
    </div>
  );
}
