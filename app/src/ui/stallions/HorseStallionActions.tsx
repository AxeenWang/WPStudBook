import { useCallback, useId, useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { PlannedReadiness } from '../../domain/stallion-duty.ts';
import type { ServiceContext } from '../../services/context.ts';
import type { FoalCard } from '../../services/foals.ts';
import {
  SETTABLE_READINESS,
  assignCurrentStallion,
  loadHorseStallionStatus,
  registerAsStallion,
  setPlannedSuccessor,
  type HorseStallionStatus,
} from '../../services/stallions.ts';
import { Feedback, useAction, useErrorLink, type ActionState } from '../actions.tsx';
import { SelectField } from '../fields.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { DUTY_STATUS_LABELS, READINESS_LABELS } from './labels.ts';

export const READINESS_CHOICES = SETTABLE_READINESS.map((readiness) => ({
  value: readiness,
  label: READINESS_LABELS[readiness],
}));

function statusText(status: HorseStallionStatus): string {
  const parts = [
    status.isStallion
      ? `已成為種牡馬${status.stallionNumbers.length === 0 ? '' : `（種牡馬馬番号 ${status.stallionNumbers.join('、')}）`}`
      : '尚未登記成為種牡馬',
    status.current === undefined
      ? undefined
      : `第 ${String(status.current.position)} 系 ${String(status.current.generation)} 代現任（${DUTY_STATUS_LABELS[status.current.dutyStatus]}）`,
    status.planned === undefined
      ? undefined
      : `第 ${String(status.planned.position)} 系預定後繼（${READINESS_LABELS[status.planned.readiness]}）`,
  ];
  return parts.filter((part) => part !== undefined).join('・');
}

function StallionNoField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <TextField value={value} onChange={onChange}>
      <Label>種牡馬馬番号（選填，例如 0x0000）</Label>
      <Input />
    </TextField>
  );
}

interface FormProps {
  readonly card: FoalCard;
  readonly action: ActionState;
  /** 共用的結果訊息與表單的關聯（需求規格 13.5）。 */
  readonly errorLink: ReturnType<typeof useErrorLink>;
}

function RegisterForm({ card, action, errorLink }: FormProps) {
  const { context } = useServices();
  const { busy, run } = action;
  const headingId = useId();
  const [stallionNo, setStallionNo] = useState('');
  return (
    <Form
      aria-labelledby={headingId}
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await registerAsStallion(context, { horseId: card.id, stallionNo });
          return `已登記「${card.name}」成為種牡馬`;
        });
      }}
    >
      <h6 id={headingId}>登記成為種牡馬</h6>
      <p>只記錄去向與馬番号，不影響八系任務；登記後馬名唯讀，請先補登正式馬名。</p>
      <StallionNoField value={stallionNo} onChange={setStallionNo} />
      <Button type="submit" isPending={busy}>
        登記成為種牡馬
      </Button>
    </Form>
  );
}

function AssignForm({ card, action, errorLink }: FormProps) {
  const { context } = useServices();
  const { busy, run } = action;
  const headingId = useId();
  const [stallionNo, setStallionNo] = useState('');
  return (
    <Form
      aria-labelledby={headingId}
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const duty = await assignCurrentStallion(context, { horseId: card.id, stallionNo });
          return `已接任第 ${String(duty.position)} 系 ${String(duty.generation)} 代現任`;
        });
      }}
    >
      <h6 id={headingId}>接任現任</h6>
      <p>接任前會再次核對父母、系與代數；該代已有在崗現任時，請到八系頁更換現任或比較兄弟。</p>
      <StallionNoField value={stallionNo} onChange={setStallionNo} />
      <Button type="submit" isPending={busy}>
        接任現任
      </Button>
    </Form>
  );
}

function PlannedForm({
  card,
  action,
  errorLink,
  position,
}: FormProps & { readonly position: number }) {
  const { context } = useServices();
  const { busy, run } = action;
  const headingId = useId();
  const [readiness, setReadiness] = useState<PlannedReadiness>('racing');
  return (
    <Form
      aria-labelledby={headingId}
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setPlannedSuccessor(context, { position, horseId: card.id, readiness });
          return `已指定為第 ${String(position)} 系預定後繼`;
        });
      }}
    >
      <h6 id={headingId}>設為預定後繼</h6>
      <SelectField
        label="就緒狀態"
        value={readiness}
        options={READINESS_CHOICES}
        onChange={(next) => {
          if (next !== undefined) {
            setReadiness(next);
          }
        }}
      />
      <Button type="submit" isPending={busy}>
        設為預定後繼
      </Button>
    </Form>
  );
}

/** 公駒的種牡馬操作（需求規格 7.7、9.6、9.7）：登記去向、接任現任、設為預定後繼。 */
export function HorseStallionActions({ card }: { readonly card: FoalCard }) {
  const load = useCallback(
    (serviceContext: ServiceContext) => loadHorseStallionStatus(serviceContext, card.id),
    [card.id],
  );
  const { data, error } = useServiceQuery(load);
  const action = useAction();
  const errorLink = useErrorLink(action.error);
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  const { lineage } = card;
  const eligible = !card.freeBred && lineage !== undefined;
  const onDuty = data.current?.dutyStatus === 'onDuty';
  return (
    <section aria-label="種牡馬" className="field-group">
      <h5>種牡馬</h5>
      <p data-testid="horse-stallion-status">{statusText(data)}</p>
      <Feedback message={action.message} error={action.error} id={errorLink.id} />
      {!data.isStallion && <RegisterForm card={card} action={action} errorLink={errorLink} />}
      {eligible && !onDuty && <AssignForm card={card} action={action} errorLink={errorLink} />}
      {eligible && !onDuty && data.planned === undefined && (
        <PlannedForm
          card={card}
          action={action}
          errorLink={errorLink}
          position={lineage.position}
        />
      )}
      {!eligible && <p className="notice">自由配種產駒只能登記去向，不能成為八系後繼。</p>}
    </section>
  );
}
