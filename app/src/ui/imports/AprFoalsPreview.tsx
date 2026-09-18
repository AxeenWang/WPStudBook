import type {
  AprDisposition,
  AprFoalRow,
  AprFoalsOverview,
} from '../../services/apr-foals-import.ts';
import { horseNumberText } from '../../services/mares.ts';
import { OUTCOME_LABELS } from './labels.ts';

export const APR_DISPOSITION_LABELS: Readonly<Record<AprDisposition, string>> = {
  create: '建立幼駒',
  review: '待核對',
  confirmed: '已確認（比照自由配種）',
  fill: '補齊既有產駒',
  missing: '未見產駒',
  conflict: '衝突',
};

function overviewText(overview: AprFoalsOverview): string {
  return [
    `總數 ${String(overview.total)}`,
    `牡 ${String(overview.male)}`,
    `牝 ${String(overview.female)}`,
    `建立 ${String(overview.create)}`,
    `待核對 ${String(overview.review)}`,
    `已確認 ${String(overview.confirmed)}`,
    `補齊 ${String(overview.fill)}`,
    `未見產駒 ${String(overview.missing)}`,
    `衝突 ${String(overview.conflict)}`,
  ].join('、');
}

function sexText(sex: 'male' | 'female' | undefined): string {
  if (sex === undefined) {
    return '—';
  }
  return sex === 'male' ? '牡' : '牝';
}

interface AprFoalsPreviewProps {
  readonly rows: readonly AprFoalRow[];
  readonly overview: AprFoalsOverview;
  readonly confirmed: ReadonlySet<string>;
  readonly onConfirm: (key: string, checked: boolean) => void;
}

/**
 * 四月誕生幼駒總表的預覽（需求規格 11.4）：處置、追蹤名與能力；待核對的列可以逐匹勾選確認
 * （APR-03），未見產駒不能勾——那要人工去查，不是匯入能決定的。
 */
export function AprFoalsPreview(props: AprFoalsPreviewProps) {
  return (
    <div className="may-preview">
      <p data-testid="apr-overview">{overviewText(props.overview)}</p>

      <table data-testid="apr-preview-table">
        <caption>誕生幼駒對帳</caption>
        <thead>
          <tr>
            <th scope="col">馬名</th>
            <th scope="col">處置</th>
            <th scope="col">確認建立</th>
            <th scope="col">追蹤名</th>
            <th scope="col">性別</th>
            <th scope="col">SP／ST</th>
            <th scope="col">幼駒馬番号</th>
            <th scope="col">分類與說明</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.key} data-testid={`apr-row-${row.key}`}>
              <th scope="row">{row.label}</th>
              <td>{APR_DISPOSITION_LABELS[row.disposition]}</td>
              <td>
                {row.confirmable ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={props.confirmed.has(row.key)}
                      onChange={(event) => {
                        props.onConfirm(row.key, event.target.checked);
                      }}
                    />
                    確認建立
                  </label>
                ) : (
                  '—'
                )}
              </td>
              <td>{row.plan?.preview?.trackingName ?? '—'}</td>
              <td>{sexText(row.values?.sex)}</td>
              <td>
                {row.values?.sp ?? '—'}／{row.values?.st ?? '—'}
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
    </div>
  );
}
