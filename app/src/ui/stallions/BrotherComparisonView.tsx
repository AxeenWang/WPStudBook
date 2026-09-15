import { useCallback } from 'react';
import { Button } from 'react-aria-components';
import type { ServiceContext } from '../../services/context.ts';
import { SUB_PARAM_KEY_OPTIONS } from '../../services/foals.ts';
import { chooseCurrentFromBrothers, loadBrotherComparison } from '../../services/stallions.ts';
import { Feedback, useAction } from '../actions.tsx';
import { SUB_PARAM_LABELS } from '../foals/labels.ts';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { BROTHER_STATUS_LABELS } from './labels.ts';

function valueText(value: number | string | undefined): string {
  return value === undefined ? '—' : String(value);
}

/**
 * 種牡馬兄弟比較（需求規格 7.7、13.5、LINE-30、LINE-32）：並排同系同代同父兄弟的能力、適性、年齡與狀態，
 * 不標示優劣；由使用者選定現任，原現任標示已被取代。
 */
export function BrotherComparisonView({ horseId }: { readonly horseId: string }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const load = useCallback(
    (serviceContext: ServiceContext) => loadBrotherComparison(serviceContext, horseId),
    [horseId],
  );
  const { data, error: loadError } = useServiceQuery(load);
  if (data === undefined) {
    return loadError === undefined ? <p role="status">載入中…</p> : <p role="alert">{loadError}</p>;
  }
  const caption = `第 ${String(data.position)} 系 ${String(data.generation)} 代・父 ${data.sireName ?? '未取得'} 的種牡馬兄弟`;
  return (
    <section aria-label="兄弟比較">
      <p>系統只並排資料，不判定優劣，也不自動更換現任。ST 是距離定位，不代表越高越好。</p>
      <div className="table-scroll">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">馬名</th>
              <th scope="col">出生年</th>
              <th scope="col">年齡</th>
              <th scope="col">母馬</th>
              <th scope="col">SP</th>
              <th scope="col">ST</th>
              {SUB_PARAM_KEY_OPTIONS.map((key) => (
                <th key={key} scope="col">
                  {SUB_PARAM_LABELS[key]}
                </th>
              ))}
              <th scope="col">サ</th>
              <th scope="col">芝</th>
              <th scope="col">ダ</th>
              <th scope="col">距離適性</th>
              <th scope="col">狀態</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.name}</th>
                <td>{valueText(row.birthYear)}</td>
                <td>{valueText(row.age)}</td>
                <td>{valueText(row.damName)}</td>
                <td>{valueText(row.sp)}</td>
                <td>{valueText(row.st)}</td>
                {SUB_PARAM_KEY_OPTIONS.map((key) => (
                  <td key={key}>{valueText(row.subParams[key])}</td>
                ))}
                <td>{valueText(row.subParamTotal)}</td>
                <td>{valueText(row.turf)}</td>
                <td>{valueText(row.dirt)}</td>
                <td>{valueText(row.distanceText)}</td>
                <td>{BROTHER_STATUS_LABELS[row.status]}</td>
                <td>
                  {row.status !== 'onDuty' && (
                    <Button
                      isPending={busy}
                      aria-label={`選「${row.name}」為現任`}
                      onPress={() => {
                        void run(async () => {
                          await chooseCurrentFromBrothers(context, {
                            position: data.position,
                            generation: data.generation,
                            sireId: data.sireId,
                            horseId: row.id,
                          });
                          return `已選定「${row.name}」為現任`;
                        });
                      }}
                    >
                      選為現任
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Feedback message={message} error={error} />
    </section>
  );
}
