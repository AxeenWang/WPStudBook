import { useCallback } from 'react';
import { Button } from 'react-aria-components';
import type { ServiceContext } from '../../services/context.ts';
import { confirmSuccession, loadSisterComparison } from '../../services/succession.ts';
import { Feedback, useAction } from '../actions.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { SUCCESSION_LABELS, formatStatus } from './labels.ts';

function valueText(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}

/**
 * 姊妹接替（需求規格 8.9、MARE-12）：並排比較同父同母姊妹的出生年、父母、能力與狀態，
 * 由使用者選定正式保留；其他列入任務的姊妹改為已被取代，紀錄保留。
 */
export function SisterComparison({ mareId }: { readonly mareId: string }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const load = useCallback(
    (serviceContext: ServiceContext) => loadSisterComparison(serviceContext, mareId),
    [mareId],
  );
  const { data, error: loadError } = useServiceQuery(load);
  if (data === undefined) {
    return loadError === undefined ? null : <p role="alert">{loadError}</p>;
  }
  return (
    <section aria-label="姊妹接替">
      <h4>姊妹接替</h4>
      {data.length === 1 ? (
        <p>沒有已轉入的同父同母姊妹。</p>
      ) : (
        <p>同父同母的姊妹可先後轉入；比較後只選一匹正式保留。</p>
      )}
      <ul className="sister-list">
        {data.map((row) => (
          <li key={row.id} aria-label={row.name}>
            <p>
              <strong>{row.name}</strong>・{row.birthYear ?? '出生年未取得'} 年生・父{' '}
              {row.sireName ?? '未取得'}・母 {row.damName ?? '未取得'}
            </p>
            <p>
              SP {valueText(row.sp)}・ST {valueText(row.st)}・サ {valueText(row.subParamTotal)}・
              {formatStatus(row.status, row.leftReason)}・
              <span data-testid="sister-succession">
                {row.succession === undefined ? '—' : SUCCESSION_LABELS[row.succession]}
              </span>
            </p>
            {row.canConfirm && (
              <Button
                isPending={busy}
                onPress={() => {
                  void run(async () => {
                    await confirmSuccession(context, row.id);
                    return `已選定「${row.name}」為正式保留`;
                  });
                }}
              >
                選為正式保留
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Feedback message={message} error={error} />
    </section>
  );
}
