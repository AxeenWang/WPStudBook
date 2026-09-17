import type {
  AbsentDisposition,
  MayStallionRow,
  MayStallionsOverview,
  StallionDisposition,
} from '../../services/may-stallions-import.ts';
import { horseNumberText } from '../../services/mares.ts';
import { SelectField, type SelectOption } from '../fields.tsx';
import { OUTCOME_LABELS } from './labels.ts';

export const STALLION_DISPOSITION_LABELS: Readonly<Record<StallionDisposition, string>> = {
  continuing: '在表',
  newStallion: '新建種牡馬紀錄',
  becameStallion: '自家生產（成為種牡馬）',
  inactive: '非現役',
  retired: '已引退',
  conflict: '衝突',
  unmatched: '未配對',
};

const ABSENT_OPTIONS: readonly SelectOption<AbsentDisposition>[] = [
  { value: 'retired', label: STALLION_DISPOSITION_LABELS.retired },
  { value: 'inactive', label: STALLION_DISPOSITION_LABELS.inactive },
];

function overviewText(overview: MayStallionsOverview): string {
  return [
    `總數 ${String(overview.total)}`,
    `在表 ${String(overview.continuing)}`,
    `新建 ${String(overview.newStallion)}`,
    `自家生產 ${String(overview.becameStallion)}`,
    `非現役 ${String(overview.inactive)}`,
    `已引退 ${String(overview.retired)}`,
    `未配對 ${String(overview.unmatched)}`,
    `衝突 ${String(overview.conflict)}`,
  ].join('、');
}

interface MayStallionsPreviewProps {
  readonly rows: readonly MayStallionRow[];
  readonly overview: MayStallionsOverview;
  readonly absentOverrides: ReadonlyMap<string, AbsentDisposition>;
  readonly onAbsentChange: (key: string, disposition: AbsentDisposition) => void;
}

/** 五月種牡馬總表的預覽（需求規格 11.8）：處置、年度快照與缺席者的逐匹更正。 */
export function MayStallionsPreview(props: MayStallionsPreviewProps) {
  return (
    <div className="may-preview">
      <p data-testid="stallion-overview">{overviewText(props.overview)}</p>
      <p data-testid="stallion-unchanged">
        年度資料與前一份相同、這次不重複保存：{props.overview.unchangedYearly} 筆
      </p>

      <table data-testid="stallion-preview-table">
        <caption>種牡馬對帳</caption>
        <thead>
          <tr>
            <th scope="col">馬名</th>
            <th scope="col">處置</th>
            <th scope="col">SP／ST</th>
            <th scope="col">子出</th>
            <th scope="col">種付料</th>
            <th scope="col">能力番号</th>
            <th scope="col">分類與說明</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const absent = row.disposition === 'inactive' || row.disposition === 'retired';
            const disposition = props.absentOverrides.get(row.key) ?? row.disposition;
            return (
              <tr key={row.key} data-testid={`stallion-row-${row.key}`}>
                <th scope="row">{row.label}</th>
                <td>
                  {absent ? (
                    <SelectField
                      label={`${row.label}的處置`}
                      value={disposition === 'retired' ? 'retired' : 'inactive'}
                      options={ABSENT_OPTIONS}
                      onChange={(value) => {
                        props.onAbsentChange(row.key, value ?? 'inactive');
                      }}
                    />
                  ) : (
                    STALLION_DISPOSITION_LABELS[row.disposition]
                  )}
                </td>
                <td>
                  {row.values?.sp ?? '—'}／{row.values?.st ?? '—'}
                </td>
                <td>{row.values?.kodashi ?? '—'}</td>
                <td>{row.values?.studFee ?? '—'}</td>
                <td>
                  {row.values?.abilityNo === undefined
                    ? '—'
                    : horseNumberText(row.values.abilityNo)}
                </td>
                <td>
                  {OUTCOME_LABELS[row.outcome]}
                  {row.issues.length > 0 && <span>：{row.issues[0]?.message}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
