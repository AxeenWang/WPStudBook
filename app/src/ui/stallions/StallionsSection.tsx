import { useId, useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { ReplaceReason, PlannedReadiness } from '../../domain/stallion-duty.ts';
import {
  REPLACE_REASON_OPTIONS,
  assignCurrentStallion,
  changeDutyStatus,
  confirmPlannedBirth,
  endPlannedSuccessor,
  loadStallionOverview,
  replaceCurrentStallion,
  setPlannedSuccessor,
  updatePlannedReadiness,
  type CurrentStallionView,
  type LineStallions,
  type PlannedSuccessorView,
  type SettableDutyStatus,
  type SuccessorOption,
} from '../../services/stallions.ts';
import { Feedback, useAction, type ActionState } from '../actions.tsx';
import { OptionalIntegerField, SelectField, type SelectOption } from '../fields.tsx';
import { SEX_LABELS } from '../foals/labels.ts';
import { PedigreeView } from '../pedigree/PedigreeView.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { BrotherComparisonView } from './BrotherComparisonView.tsx';
import { READINESS_CHOICES } from './HorseStallionActions.tsx';
import { REPLACE_REASON_LABELS, DUTY_STATUS_LABELS, READINESS_LABELS } from './labels.ts';

const REASON_CHOICES = REPLACE_REASON_OPTIONS.map((reason) => ({
  value: reason,
  label: REPLACE_REASON_LABELS[reason],
}));

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

function ReplaceForm({
  item,
  line,
  currentYear,
}: {
  readonly item: CurrentStallionView;
  readonly line: LineStallions;
  readonly currentYear: number;
}) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const headingId = useId();
  const choices = line.successorOptions
    .filter((option) => option.generation === item.generation && option.id !== item.horseId)
    .map((option) => ({ value: option.id, label: option.name }));
  const [successorId, setSuccessorId] = useState<string>();
  const [reason, setReason] = useState<ReplaceReason>();
  const [effectiveYear, setEffectiveYear] = useState<number | undefined>(currentYear);
  const [stallionNo, setStallionNo] = useState('');
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await replaceCurrentStallion(context, {
            position: line.position,
            generation: item.generation,
            successorId: successorId ?? '',
            reason,
            effectiveYear,
            stallionNo,
          });
          return `已更換第 ${String(line.position)} 系 ${String(item.generation)} 代現任`;
        });
      }}
    >
      <h5 id={headingId}>更換現任</h5>
      <p>後任必須是同系同代的自家種牡馬；同父弟弟可以取代哥哥，不要求同母。</p>
      <SelectField
        label="後任"
        value={successorId}
        options={choices}
        emptyLabel="請選擇"
        onChange={setSuccessorId}
      />
      <SelectField
        label="更換原因"
        value={reason}
        options={REASON_CHOICES}
        emptyLabel="請選擇"
        onChange={setReason}
      />
      <OptionalIntegerField label="生效年" value={effectiveYear} onChange={setEffectiveYear} />
      <StallionNoField value={stallionNo} onChange={setStallionNo} />
      <Feedback message={message} error={error} />
      <Button type="submit" isPending={busy}>
        確認更換
      </Button>
    </Form>
  );
}

function StatusForm({
  item,
  currentYear,
}: {
  readonly item: CurrentStallionView;
  readonly currentYear: number;
}) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const headingId = useId();
  const choices: SelectOption<SettableDutyStatus>[] = (
    ['onDuty', 'outOfService', 'retired'] as const
  )
    .filter((status) => status !== item.dutyStatus)
    .map((status) => ({ value: status, label: DUTY_STATUS_LABELS[status] }));
  const [status, setStatus] = useState<SettableDutyStatus>();
  const [year, setYear] = useState<number | undefined>(currentYear);
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          if (status === undefined) {
            throw new Error('請選擇狀態');
          }
          const saved = await changeDutyStatus(context, { dutyId: item.dutyId, status, year });
          return `已將「${item.name}」標示為${DUTY_STATUS_LABELS[saved.dutyStatus]}`;
        });
      }}
    >
      <h5 id={headingId}>標示任期狀態</h5>
      <SelectField
        label="狀態"
        value={status}
        options={choices}
        emptyLabel="請選擇"
        onChange={setStatus}
      />
      {status !== 'onDuty' && <OptionalIntegerField label="年份" value={year} onChange={setYear} />}
      <Feedback message={message} error={error} />
      <Button type="submit" isPending={busy}>
        保存狀態
      </Button>
    </Form>
  );
}

type CurrentPanel = 'pedigree' | 'brothers' | 'replace' | 'status';

function CurrentItem({
  item,
  line,
  currentYear,
}: {
  readonly item: CurrentStallionView;
  readonly line: LineStallions;
  readonly currentYear: number;
}) {
  const [panel, setPanel] = useState<CurrentPanel>();
  const toggle = (next: CurrentPanel) => {
    setPanel(panel === next ? undefined : next);
  };
  const period = `${String(item.startYear)} 年起${item.endYear === undefined ? '' : `～${String(item.endYear)} 年`}`;
  const details = [
    `${String(item.generation)} 代`,
    item.name,
    DUTY_STATUS_LABELS[item.dutyStatus],
    period,
    item.age === undefined ? undefined : `${String(item.age)} 歲`,
    item.replaceReason === undefined
      ? undefined
      : `更換原因 ${REPLACE_REASON_LABELS[item.replaceReason]}`,
    item.successorName === undefined ? undefined : `後任 ${item.successorName}`,
  ].filter((part) => part !== undefined);
  const buttons: [CurrentPanel, string, boolean][] = [
    ['pedigree', '血緣表', true],
    ['brothers', '兄弟比較', item.brotherCount >= 2],
    ['replace', '更換現任', item.dutyStatus === 'onDuty'],
    ['status', '標示狀態', item.dutyStatus !== 'replaced'],
  ];
  return (
    <li aria-label={`${String(item.generation)} 代 ${item.name}`}>
      <p data-testid="current-stallion">
        {details.join('・')}
        {item.reminder && <span className="badge">已達提醒年齡</span>}
      </p>
      <div className="actions">
        {buttons
          .filter(([, , shown]) => shown)
          .map(([key, label]) => (
            <Button
              key={key}
              aria-expanded={panel === key}
              onPress={() => {
                toggle(key);
              }}
            >
              {label}
            </Button>
          ))}
      </div>
      {panel === 'pedigree' && <PedigreeView horseId={item.horseId} />}
      {panel === 'brothers' && <BrotherComparisonView horseId={item.horseId} />}
      {panel === 'replace' && <ReplaceForm item={item} line={line} currentYear={currentYear} />}
      {panel === 'status' && <StatusForm item={item} currentYear={currentYear} />}
    </li>
  );
}

/** 可以直接接任的公駒：該代還沒有在崗現任；已有在崗現任的代數改用更換現任或兄弟比較。 */
function assignableOptions(line: LineStallions): readonly SuccessorOption[] {
  return line.successorOptions.filter(
    (option) =>
      !line.current.some(
        (item) => item.dutyStatus === 'onDuty' && item.generation === option.generation,
      ),
  );
}

interface LineFormProps {
  readonly line: LineStallions;
  /** 由系卡片持有：送出後這個表單可能消失（例如沒有可選的公駒），訊息仍要留在畫面上。 */
  readonly action: ActionState;
}

function AssignForm({ line, action }: LineFormProps) {
  const { context } = useServices();
  const { busy, run } = action;
  const headingId = useId();
  const [horseId, setHorseId] = useState<string>();
  const [stallionNo, setStallionNo] = useState('');
  const choices = assignableOptions(line).map((option) => ({
    value: option.id,
    label: `${option.name}（${String(option.generation)} 代）`,
  }));
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const duty = await assignCurrentStallion(context, {
            horseId: horseId ?? '',
            stallionNo,
          });
          return `已接任第 ${String(duty.position)} 系 ${String(duty.generation)} 代現任`;
        });
      }}
    >
      <h5 id={headingId}>自家種牡馬接任</h5>
      <SelectField
        label="接任的公駒"
        value={horseId}
        options={choices}
        emptyLabel="請選擇"
        onChange={setHorseId}
      />
      <StallionNoField value={stallionNo} onChange={setStallionNo} />
      <Button type="submit" isPending={busy}>
        接任現任
      </Button>
    </Form>
  );
}

function PlannedBlock({
  planned,
  position,
  action,
}: {
  readonly planned: PlannedSuccessorView;
  readonly position: number;
  readonly action: ActionState;
}) {
  const { context } = useServices();
  const { busy, run } = action;
  const [readiness, setReadiness] = useState<PlannedReadiness>(
    planned.readiness === 'retiredPending' ? 'retiredPending' : 'racing',
  );
  const { birth, horse } = planned;
  const target =
    horse?.name ??
    (birth === undefined
      ? '—'
      : `${birth.label}${birth.expectedBirthYear === undefined ? '' : `・預定 ${String(birth.expectedBirthYear)} 年出生`}`);
  return (
    <div data-testid="planned-successor">
      <p>
        {`${String(planned.generation)} 代・${target}・${READINESS_LABELS[planned.readiness]}・${String(planned.startYear)} 年指定`}
      </p>
      {birth?.born !== undefined && (
        <p className="notice">
          {`已出生：${birth.born.name}（${SEX_LABELS[birth.born.sex]}）`}
          {birth.born.sex === 'female' && '，預定後繼失效，請重新指定或取消'}
        </p>
      )}
      <div className="actions">
        {horse !== undefined && (
          <>
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
            <Button
              isPending={busy}
              onPress={() => {
                void run(async () => {
                  await updatePlannedReadiness(context, { position, readiness });
                  return `已更新就緒狀態為${READINESS_LABELS[readiness]}`;
                });
              }}
            >
              更新就緒狀態
            </Button>
          </>
        )}
        {birth?.born?.sex === 'male' && (
          <Button
            isPending={busy}
            onPress={() => {
              void run(async () => {
                await confirmPlannedBirth(context, position);
                return '已確認產駒為預定後繼';
              });
            }}
          >
            確認產駒
          </Button>
        )}
        <Button
          isPending={busy}
          onPress={() => {
            void run(async () => {
              await endPlannedSuccessor(context, position);
              return '已取消預定後繼';
            });
          }}
        >
          取消預定後繼
        </Button>
      </div>
    </div>
  );
}

function PlannedForm({ line, action }: LineFormProps) {
  const { context } = useServices();
  const { busy, run } = action;
  const headingId = useId();
  const choices = [
    ...line.successorOptions.map((option) => ({
      value: `horse:${option.id}`,
      label: `${option.name}（${String(option.generation)} 代）`,
    })),
    ...line.breedingOptions.map((option) => ({
      value: `breeding:${option.id}`,
      label: `尚未誕生：${option.name}`,
    })),
  ];
  const [target, setTarget] = useState<string>();
  const [readiness, setReadiness] = useState<PlannedReadiness>('racing');
  const horseId = target?.startsWith('horse:') === true ? target.slice(6) : undefined;
  const breedingId = target?.startsWith('breeding:') === true ? target.slice(9) : undefined;
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setPlannedSuccessor(context, {
            position: line.position,
            horseId,
            breedingId,
            readiness: horseId === undefined ? undefined : readiness,
          });
          return `已指定第 ${String(line.position)} 系預定後繼`;
        });
      }}
    >
      <h5 id={headingId}>指定預定後繼</h5>
      <p>可以指定既有公駒，或已受胎、產駒尚未出生的八系指定配種；已有預定後繼時會改為新的指定。</p>
      <SelectField
        label="預定後繼"
        value={target}
        options={choices}
        emptyLabel="請選擇"
        onChange={setTarget}
      />
      {breedingId === undefined && (
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
      )}
      <Button type="submit" isPending={busy}>
        指定預定後繼
      </Button>
    </Form>
  );
}

function LineStallionsCard({
  line,
  currentYear,
}: {
  readonly line: LineStallions;
  readonly currentYear: number;
}) {
  const title = `第 ${String(line.position)} 系種牡馬`;
  const action = useAction();
  return (
    <article aria-label={title} className="stallion-card">
      <h3>{title}</h3>
      <div data-testid="line-stallion-feedback">
        <Feedback message={action.message} error={action.error} />
      </div>
      {line.reminders.length > 0 && (
        <ul aria-label="提醒" className="reminders">
          {line.reminders.map((reminder) => (
            <li key={reminder} className="notice">
              {reminder}
            </li>
          ))}
        </ul>
      )}
      <h4>現任</h4>
      {line.current.length === 0 ? (
        <p>沒有現任紀錄。</p>
      ) : (
        <ul className="stallion-list" aria-label="現任">
          {line.current.map((item) => (
            <CurrentItem key={item.dutyId} item={item} line={line} currentYear={currentYear} />
          ))}
        </ul>
      )}
      {assignableOptions(line).length > 0 && <AssignForm line={line} action={action} />}
      <h4>預定後繼</h4>
      {line.planned === undefined ? (
        <p>尚未指定。</p>
      ) : (
        <PlannedBlock planned={line.planned} position={line.position} action={action} />
      )}
      {(line.successorOptions.length > 0 || line.breedingOptions.length > 0) && (
        <PlannedForm line={line} action={action} />
      )}
    </article>
  );
}

/** 八系頁的種牡馬區（需求規格 7.7、13.2）：各系現任、預定後繼、提醒與更換操作。 */
export function StallionsSection() {
  const { data, error } = useServiceQuery(loadStallionOverview);
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  if (data.lines.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="stallions-heading">
      <h2 id="stallions-heading">種牡馬</h2>
      <p>
        {`現任達 ${String(data.reminderAge)} 歲時提醒準備後繼（資料管理的提醒設定可調整）。`}
        交接期間同系上下兩代可同時在崗；系統不自動選馬或更換現任。
      </p>
      {error !== undefined && <p role="alert">{error}</p>}
      {data.lines.map((line) => (
        <LineStallionsCard key={line.position} line={line} currentYear={data.currentYear} />
      ))}
    </section>
  );
}
