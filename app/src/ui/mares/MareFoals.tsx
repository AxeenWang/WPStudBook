import { useCallback, useState } from 'react';
import { Button } from 'react-aria-components';
import type { FoalTimelineEntry } from '../../domain/breeding.ts';
import type { ServiceContext } from '../../services/context.ts';
import {
  loadMareFoals,
  type FoalCard,
  type MareFoals as MareFoalsData,
} from '../../services/foals.ts';
import { FoalForm } from '../foals/FoalForm.tsx';
import { FoalSummary } from '../foals/FoalSummary.tsx';
import { useServiceQuery } from '../ServicesContext.tsx';

function EntryBody({
  entry,
  cards,
  currentYear,
  onConfirmBirth,
}: {
  readonly entry: FoalTimelineEntry;
  readonly cards: readonly FoalCard[];
  readonly currentYear: number;
  readonly onConfirmBirth: (birthYear: number) => void;
}) {
  switch (entry.kind) {
    case 'foal': {
      const card = cards.find((item) => item.id === entry.foalId);
      return card === undefined ? <p>找不到產駒資料。</p> : <FoalSummary card={card} />;
    }
    case 'expected':
      return entry.birthYear > currentYear ? (
        <p>預定 {entry.birthYear} 年 4 月 1 週出生</p>
      ) : (
        <>
          <p>已受胎，預定 {entry.birthYear} 年 4 月 1 週出生，尚未確認出生。</p>
          <Button
            onPress={() => {
              onConfirmBirth(entry.birthYear);
            }}
          >
            確認出生
          </Button>
        </>
      );
    case 'idle':
      return <p>輪空（{entry.conception}）</p>;
    case 'unconfirmed':
      return <p>受胎未確認，不推定結果</p>;
    case 'conceptionPending':
      return <p>已登記配種，尚未登記受胎狀態</p>;
    case 'unregistered':
      return <p className="notice">未登記繁殖紀錄</p>;
  }
}

function Timeline({ data, mareId }: { readonly data: MareFoalsData; readonly mareId: string }) {
  const [formYear, setFormYear] = useState<number | 'open'>();
  const [message, setMessage] = useState<string>();
  return (
    <>
      {message !== undefined && <p role="status">{message}</p>}
      {data.timeline.length === 0 ? (
        <p>尚無產駒紀錄。加入母馬群當年的幼駒來自加入前的配種，沒有自產幼駒是正常的。</p>
      ) : (
        <ol className="foal-timeline" aria-label="產駒時間軸">
          {data.timeline.map((entry) => (
            <li key={entry.birthYear} data-kind={entry.kind}>
              <h4 className="timeline-year">{entry.birthYear} 年</h4>
              <EntryBody
                entry={entry}
                cards={data.cards}
                currentYear={data.currentYear}
                onConfirmBirth={(birthYear) => {
                  setMessage(undefined);
                  setFormYear(birthYear);
                }}
              />
            </li>
          ))}
        </ol>
      )}
      {formYear === undefined ? (
        <Button
          onPress={() => {
            setMessage(undefined);
            setFormYear('open');
          }}
        >
          手動登記產駒
        </Button>
      ) : (
        <FoalForm
          key={String(formYear)}
          damId={mareId}
          birthYear={formYear === 'open' ? data.currentYear : formYear}
          onRegistered={(registered) => {
            setFormYear(undefined);
            setMessage(`已登記產駒「${registered.trackingName ?? ''}」`);
          }}
          onCancel={() => {
            setFormYear(undefined);
          }}
        />
      )}
    </>
  );
}

/** 產駒頁籤（需求規格 13.4、BRD-04）：依年份排列的產駒卡時間軸，含輪空、未登記與預定出生年度（新到舊）。 */
export function MareFoals({ mareId }: { readonly mareId: string }) {
  const load = useCallback(
    (serviceContext: ServiceContext) => loadMareFoals(serviceContext, mareId),
    [mareId],
  );
  const { data, error } = useServiceQuery(load);
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  return <Timeline data={data} mareId={mareId} />;
}
