import type {
  MayDisposition,
  MayMareRow,
  MayMaresOverview,
} from '../../services/may-mares-import.ts';
import { horseNumberText } from '../../services/mares.ts';
import { SelectField, type SelectOption } from '../fields.tsx';
import { formatVitality, SITE_LABELS } from '../mares/labels.ts';
import { OUTCOME_LABELS } from './labels.ts';

export const DISPOSITION_LABELS: Readonly<Record<MayDisposition, string>> = {
  continuing: '繼續在圈',
  newOwnFoal: '新進（自家產駒）',
  newOther: '新進（其他）',
  returning: '回歸',
  retired: '定年引退',
  sold: '售出',
  unmatched: '未配對',
  conflict: '衝突',
};

const ABSENT_OPTIONS: readonly SelectOption<'retired' | 'sold'>[] = [
  { value: 'retired', label: DISPOSITION_LABELS.retired },
  { value: 'sold', label: DISPOSITION_LABELS.sold },
];

function overviewText(overview: MayMaresOverview): string {
  return [
    `總數 ${String(overview.total)}`,
    `繼續在圈 ${String(overview.continuing)}（其中轉場 ${String(overview.transferred)}）`,
    `新進（自家產駒）${String(overview.newOwnFoal)}`,
    `新進（其他）${String(overview.newOther)}`,
    `回歸 ${String(overview.returning)}`,
    `定年引退 ${String(overview.retired)}`,
    `售出 ${String(overview.sold)}`,
    `未配對 ${String(overview.unmatched)}`,
    `衝突 ${String(overview.conflict)}`,
  ].join('、');
}

function sitesText(overview: MayMaresOverview): string {
  return (Object.keys(overview.sites) as unknown as (keyof MayMaresOverview['sites'])[])
    .map((site) => `${SITE_LABELS[site]} ${String(overview.sites[site])}`)
    .join('、');
}

interface MayMaresPreviewProps {
  readonly rows: readonly MayMareRow[];
  readonly overview: MayMaresOverview;
  readonly absentOverrides: ReadonlyMap<string, 'retired' | 'sold'>;
  readonly onAbsentChange: (key: string, disposition: 'retired' | 'sold') => void;
}

/** 五月繁殖牝馬總表的預覽（需求規格 11.5、MAY-02）：處置、據點分布與缺席者的逐匹更正。 */
export function MayMaresPreview(props: MayMaresPreviewProps) {
  return (
    <div className="may-preview">
      <p data-testid="may-overview">{overviewText(props.overview)}</p>
      <p data-testid="may-sites">據點分布：{sitesText(props.overview)}</p>

      <table data-testid="may-preview-table">
        <caption>繁殖牝馬圈對帳</caption>
        <thead>
          <tr>
            <th scope="col">馬名</th>
            <th scope="col">處置</th>
            <th scope="col">據點</th>
            <th scope="col">活力</th>
            <th scope="col">仔出</th>
            <th scope="col">能力番号</th>
            <th scope="col">分類與說明</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const absent = row.disposition === 'retired' || row.disposition === 'sold';
            const disposition = props.absentOverrides.get(row.key) ?? row.disposition;
            return (
              <tr key={row.key} data-testid={`may-row-${row.key}`}>
                <th scope="row">{row.label}</th>
                <td>
                  {absent ? (
                    <SelectField
                      label={`${row.label}的處置`}
                      value={disposition === 'retired' ? 'retired' : 'sold'}
                      options={ABSENT_OPTIONS}
                      onChange={(value) => {
                        props.onAbsentChange(row.key, value ?? 'sold');
                      }}
                    />
                  ) : (
                    DISPOSITION_LABELS[row.disposition]
                  )}
                </td>
                <td>{row.site === undefined ? '—' : SITE_LABELS[row.site]}</td>
                <td>
                  {row.values?.vitality === undefined
                    ? '—'
                    : formatVitality(row.values.vitality, 5)}
                </td>
                <td>{row.values?.kodashi ?? '—'}</td>
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
