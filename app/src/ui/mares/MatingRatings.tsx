import { useCallback, useId, useState } from 'react';
import { Button, Form } from 'react-aria-components';
import type { OverallGrade } from '../../domain/mating-rating.ts';
import type { ServiceContext } from '../../services/context.ts';
import {
  OVERALL_GRADE_OPTIONS,
  loadMareMatingRatings,
  saveMatingRating,
  type MareMatingRatings,
} from '../../services/mating-ratings.ts';
import { Feedback, useAction, useErrorLink } from '../actions.tsx';
import { OptionalIntegerField, SelectField } from '../fields.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';

const GRADE_CHOICES = OVERALL_GRADE_OPTIONS.map((grade) => ({ value: grade, label: grade }));

function RatingForm({
  mareId,
  data,
}: {
  readonly mareId: string;
  readonly data: MareMatingRatings;
}) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const errorLink = useErrorLink(error);
  const headingId = useId();
  const [stallionId, setStallionId] = useState(data.stallionOptions[0]?.id);
  const currentOf = (id: string | undefined) =>
    data.rows.find((row) => row.stallionId === id && row.gameYear === data.currentYear);
  const [grade, setGrade] = useState<OverallGrade | undefined>(currentOf(stallionId)?.overallGrade);
  const [power, setPower] = useState<number | undefined>(currentOf(stallionId)?.explosivePower);
  const choices = data.stallionOptions.map((option) => ({ value: option.id, label: option.name }));
  return (
    <Form
      aria-labelledby={headingId}
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const saved = await saveMatingRating(context, {
            mareId,
            stallionId: stallionId ?? '',
            overallGrade: grade,
            explosivePower: power,
          });
          return `已保存 ${String(saved.gameYear)} 年的配種評價`;
        });
      }}
    >
      <h4 id={headingId}>配種評價</h4>
      <p>
        {`記錄在目前遊戲年（${String(data.currentYear)} 年）；同年再次保存會更新，其他年份的評價保留。`}
        總合評價與爆發力屬於這組種牡馬＋繁殖牝馬，不是母馬固定能力。
      </p>
      <SelectField
        label="評價的種牡馬"
        value={stallionId}
        options={choices}
        emptyLabel="請選擇"
        onChange={(next) => {
          setStallionId(next);
          setGrade(currentOf(next)?.overallGrade);
          setPower(currentOf(next)?.explosivePower);
        }}
      />
      <SelectField
        label="總合評價"
        value={grade}
        options={GRADE_CHOICES}
        emptyLabel="未填"
        onChange={setGrade}
      />
      <OptionalIntegerField label="爆發力" value={power} onChange={setPower} />
      <Feedback message={message} error={error} id={errorLink.id} />
      <Button type="submit" isPending={busy}>
        保存配種評價
      </Button>
    </Form>
  );
}

/** 配種頁籤的總合評價與爆發力（需求規格 9.2、BRD-17、BRD-18）：可隨時新增或編輯，跨年舊值可查。 */
export function MatingRatings({ mareId }: { readonly mareId: string }) {
  const load = useCallback(
    (serviceContext: ServiceContext) => loadMareMatingRatings(serviceContext, mareId),
    [mareId],
  );
  const { data, error } = useServiceQuery(load);
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  return (
    <section aria-label="配種評價紀錄">
      {data.rows.length === 0 ? (
        <p>尚無配種評價。</p>
      ) : (
        <ol className="breeding-list" aria-label="配種評價">
          {data.rows.map((row) => (
            <li
              key={row.id}
              className="breeding-row"
              aria-label={`${String(row.gameYear)} 年 ${row.stallionName}`}
            >
              {`${String(row.gameYear)} 年・${row.stallionName}・總合評價 ${row.overallGrade ?? '—'}・爆發力 ${row.explosivePower === undefined ? '—' : String(row.explosivePower)}`}
            </li>
          ))}
        </ol>
      )}
      <RatingForm key={data.currentYear} mareId={mareId} data={data} />
    </section>
  );
}
