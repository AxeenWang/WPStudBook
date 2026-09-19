import { useState } from 'react';
import { Button, Form } from 'react-aria-components';
import type { MareSite, YearPlan } from '../../domain/mare.ts';
import type { MareYearly, Vitality } from '../../domain/mare-yearly.ts';
import {
  MARE_POSITION_OPTIONS,
  MARE_SITE_OPTIONS,
  YEAR_PLAN_OPTIONS,
  assignMareGroup,
  checkAssignMareGroup,
  horseNumberText,
  isCeExtended,
  saveMareYearly,
  setYearPlan,
  transferMare,
  type AddMareWarning,
  type MareDetail,
  type VitalityInput,
} from '../../services/mares.ts';
import { ServiceError } from '../../services/errors.ts';
import { CheckboxField, OptionalIntegerField, SelectField } from '../fields.tsx';
import { Feedback, useAction, useErrorLink } from '../actions.tsx';
import { formatGeneration } from '../format.ts';
import { useServices } from '../ServicesContext.tsx';
import { SisterComparison } from './SisterComparison.tsx';
import {
  ORIGIN_LABELS,
  SITE_LABELS,
  STAGE_LABELS,
  SUCCESSION_LABELS,
  YEAR_PLAN_LABELS,
  formatMareGroup,
  formatStatus,
  formatVitality,
} from './labels.ts';

const PLAN_CHOICES = YEAR_PLAN_OPTIONS.map((plan) => ({
  value: plan,
  label: YEAR_PLAN_LABELS[plan],
}));
const SITE_CHOICES = MARE_SITE_OPTIONS.map((site) => ({ value: site, label: SITE_LABELS[site] }));
const POSITION_CHOICES = MARE_POSITION_OPTIONS.map((position) => ({
  value: position,
  label: `第 ${String(position)} 系`,
}));

function YearPlanForm({ detail }: { readonly detail: MareDetail }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const errorLink = useErrorLink(error);
  const [plan, setPlan] = useState<YearPlan>(detail.card.yearPlan);
  return (
    <Form
      aria-labelledby="mare-plan-heading"
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setYearPlan(context, { mareId: detail.card.id, plan });
          return `已設定今年計畫為「${YEAR_PLAN_LABELS[plan]}」`;
        });
      }}
    >
      <h4 id="mare-plan-heading">今年計畫</h4>
      <SelectField
        label="計畫"
        value={plan}
        options={PLAN_CHOICES}
        onChange={(next) => {
          if (next !== undefined) {
            setPlan(next);
          }
        }}
      />
      <Feedback message={message} error={error} id={errorLink.id} />
      <Button type="submit" isPending={busy}>
        保存計畫
      </Button>
    </Form>
  );
}

function TransferForm({ detail }: { readonly detail: MareDetail }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const errorLink = useErrorLink(error);
  const [site, setSite] = useState<MareSite>();
  const [month, setMonth] = useState<number>();
  const [week, setWeek] = useState<number>();
  return (
    <Form
      aria-labelledby="mare-transfer-heading"
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const moved = await transferMare(context, {
            mareId: detail.card.id,
            site: site ?? Number.NaN,
            month,
            week,
          });
          setSite(undefined);
          return `已轉場到${SITE_LABELS[moved.site]}`;
        });
      }}
    >
      <h4 id="mare-transfer-heading">轉場</h4>
      <p>目前據點：{SITE_LABELS[detail.card.site]}。時點填寫轉場發生的月與週，年份為目前遊戲年。</p>
      <SelectField
        label="新據點"
        value={site}
        options={SITE_CHOICES.filter((choice) => choice.value !== detail.card.site)}
        emptyLabel="請選擇"
        onChange={setSite}
      />
      <OptionalIntegerField label="月" value={month} onChange={setMonth} />
      <OptionalIntegerField label="週" value={week} onChange={setWeek} />
      <Feedback message={message} error={error} id={errorLink.id} />
      <Button type="submit" isPending={busy}>
        執行轉場
      </Button>
    </Form>
  );
}

function vitalityInputOf(vitality: Vitality | undefined): VitalityInput {
  return vitality?.state === 'confirmed'
    ? { value: vitality.value, boosted: vitality.boosted }
    : { value: undefined, boosted: false };
}

function VitalityFields({
  month,
  value,
  onChange,
}: {
  readonly month: 5 | 7;
  readonly value: VitalityInput;
  readonly onChange: (value: VitalityInput) => void;
}) {
  return (
    <>
      <OptionalIntegerField
        label={`${String(month)} 月活力`}
        value={value.value}
        onChange={(next) => {
          onChange({ ...value, value: next });
        }}
      />
      <CheckboxField
        label={`${String(month)} 月増強中`}
        checked={value.boosted}
        onChange={(boosted) => {
          onChange({ ...value, boosted });
        }}
      />
    </>
  );
}

/**
 * 指定用途（需求規格 11.5「新進（其他）」）：匯入建立的母馬是待指定用途，由使用者事後指定
 * 母馬群；沒有這個入口的話她們在清單上只看得到、動不了。
 */
function AssignGroupSection({ detail }: { readonly detail: MareDetail }) {
  const { context } = useServices();
  // 指定成功後表單會因為不再是待指定用途而卸載，所以訊息由這個不會卸載的外層持有
  // （見 ui/actions.tsx 的 ActionState 說明）。
  const { busy, message, error, run } = useAction();
  const errorLink = useErrorLink(error);
  const [position, setPosition] = useState<number>();
  const [generation, setGeneration] = useState<number>();
  const [pending, setPending] = useState<readonly AddMareWarning[]>([]);
  if (detail.card.group.kind !== 'unassigned') {
    return <Feedback message={message} error={error} />;
  }
  return (
    <Form
      aria-labelledby="mare-assign-heading"
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const input = {
            mareId: detail.card.id,
            position: position ?? Number.NaN,
            generation: generation ?? Number.NaN,
            acceptedWarnings: pending.map((warning) => warning.code),
          };
          const check = await checkAssignMareGroup(context, input);
          if (check.issues.length > 0) {
            setPending([]);
            throw new ServiceError('invalidInput', check.issues.join('；'));
          }
          const unconfirmed = check.warnings.filter(
            (warning) => !input.acceptedWarnings.includes(warning.code),
          );
          if (unconfirmed.length > 0) {
            setPending(check.warnings);
            throw new ServiceError('confirmationRequired', unconfirmed[0]?.message ?? '');
          }
          const assigned = await assignMareGroup(context, input);
          setPending([]);
          return `已指定為${formatMareGroup(assigned.group)}${check.notices.map((notice) => `。提示：${notice}`).join('')}`;
        });
      }}
    >
      <h4 id="mare-assign-heading">指定用途</h4>
      <p>
        這匹母馬是待指定用途，指定前不進入任務。自身父系是馬匹資料，不會因為指定而改變（需求規格
        8.3）。
      </p>
      <SelectField
        label="母馬群的系"
        value={position}
        options={POSITION_CHOICES}
        emptyLabel="請選擇"
        onChange={setPosition}
      />
      <OptionalIntegerField
        label="母馬群的代數（0＝第 1 系起點）"
        value={generation}
        onChange={setGeneration}
      />
      <Feedback message={message} error={error} id={errorLink.id} />
      <Button type="submit" isPending={busy}>
        {pending.length > 0 ? '確認並指定用途' : '指定用途'}
      </Button>
    </Form>
  );
}

function YearlyForm({ detail }: { readonly detail: MareDetail }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const errorLink = useErrorLink(error);
  const record = detail.currentYearly;
  const [may, setMay] = useState(vitalityInputOf(record?.vitalityMay));
  const [july, setJuly] = useState(vitalityInputOf(record?.vitalityJuly));
  const [kodashi, setKodashi] = useState(record?.kodashi);
  const [breedingYears, setBreedingYears] = useState(record?.breedingYears);
  const [breedingCount, setBreedingCount] = useState(record?.breedingCount);
  return (
    <Form
      aria-labelledby="mare-yearly-heading"
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await saveMareYearly(context, {
            mareId: detail.card.id,
            vitalityMay: may,
            vitalityJuly: july,
            kodashi,
            breedingYears,
            breedingCount,
          });
          return '已保存年度資料';
        });
      }}
    >
      <h4 id="mare-yearly-heading">今年年度資料</h4>
      <p>空白表示沒有資料：活力空白顯示「待更新」，不是 0。仔出 11～15 是 CE 擴充值，可以保存。</p>
      <VitalityFields month={5} value={may} onChange={setMay} />
      <VitalityFields month={7} value={july} onChange={setJuly} />
      <OptionalIntegerField label="仔出（0～15）" value={kodashi} onChange={setKodashi} />
      <OptionalIntegerField label="繁殖年數" value={breedingYears} onChange={setBreedingYears} />
      <OptionalIntegerField label="繁殖頭數" value={breedingCount} onChange={setBreedingCount} />
      <Feedback message={message} error={error} id={errorLink.id} />
      <Button type="submit" isPending={busy}>
        保存年度資料
      </Button>
    </Form>
  );
}

function snapshotText(vitality: Vitality | undefined): string {
  return vitality === undefined ? '—' : formatVitality(vitality, undefined);
}

function tallyText(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}

function YearlyTable({ records }: { readonly records: readonly MareYearly[] }) {
  if (records.length === 0) {
    return <p>尚無年度資料。</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <caption>年度資料（新到舊）</caption>
        <thead>
          <tr>
            <th scope="col">年</th>
            <th scope="col">5 月活力</th>
            <th scope="col">7 月活力</th>
            <th scope="col">仔出</th>
            <th scope="col">繁殖年數</th>
            <th scope="col">繁殖頭數</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <th scope="row">{record.gameYear} 年</th>
              <td>{snapshotText(record.vitalityMay)}</td>
              <td>{snapshotText(record.vitalityJuly)}</td>
              <td>
                {tallyText(record.kodashi)}
                {record.kodashi !== undefined && isCeExtended(record.kodashi) && (
                  <span className="badge">CE 擴充值</span>
                )}
              </td>
              <td>{tallyText(record.breedingYears)}</td>
              <td>{tallyText(record.breedingCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 概要頁籤（需求規格 13.4）：父母、自身父系、階段馬番号歷程與年度資料，以及操作表單。 */
export function MareSummary({ detail }: { readonly detail: MareDetail }) {
  const { card } = detail;
  const producing = card.status === 'producing';
  return (
    <>
      <dl className="detail-list">
        <div>
          <dt>父馬</dt>
          <dd>{detail.sireName ?? '未取得'}</dd>
        </div>
        <div>
          <dt>母馬</dt>
          <dd>{detail.damName ?? '未取得'}</dd>
        </div>
        <div>
          <dt>自身父系</dt>
          <dd>{card.sireSubsystem ?? '未填'}</dd>
        </div>
        <div>
          <dt>用途與代數</dt>
          <dd>
            {formatMareGroup(card.group)}・
            {card.generation === undefined ? '—' : formatGeneration(card.generation)}
          </dd>
        </div>
        <div>
          <dt>能力番号</dt>
          <dd>{detail.abilityNo ?? '未取得'}</dd>
        </div>
        <div>
          <dt>出生年</dt>
          <dd>{detail.birthYear === undefined ? '未取得' : `${String(detail.birthYear)} 年`}</dd>
        </div>
        <div>
          <dt>據點</dt>
          <dd data-testid="detail-site">{SITE_LABELS[card.site]}</dd>
        </div>
        <div>
          <dt>狀態與來源</dt>
          <dd>
            {formatStatus(card.status, card.leftReason)}・{ORIGIN_LABELS[card.origin]}
            {detail.originNote === undefined ? '' : `（${detail.originNote}）`}
          </dd>
        </div>
        <div>
          <dt>今年活力</dt>
          <dd>{formatVitality(card.vitality.vitality, card.vitality.month)}</dd>
        </div>
        {card.succession !== undefined && (
          <div>
            <dt>接替狀態</dt>
            <dd data-testid="detail-succession">{SUCCESSION_LABELS[card.succession]}</dd>
          </div>
        )}
      </dl>
      {card.origin === 'ownRetired' && card.group.kind === 'own' && (
        <p className="notice">自家母駒的自身父系由父馬決定，不能改宣告。</p>
      )}
      {card.suggestSellMother && (
        <p className="notice">女兒已轉入且今年已生產，可考慮出售這匹母馬（只是提示）。</p>
      )}
      <h4>階段馬番号歷程</h4>
      {detail.stageNumbers.length === 0 ? (
        <p>尚無階段馬番号。</p>
      ) : (
        <ul>
          {detail.stageNumbers.map((item) => (
            <li key={`${item.stage}-${String(item.number)}-${String(item.gameYear)}`}>
              {STAGE_LABELS[item.stage]} {horseNumberText(item.number)}（{item.gameYear} 年）
            </li>
          ))}
        </ul>
      )}
      {card.succession !== undefined && <SisterComparison mareId={card.id} />}
      <YearlyTable records={detail.yearly} />
      {producing && <AssignGroupSection detail={detail} />}
      {producing && <YearPlanForm detail={detail} />}
      {producing && <TransferForm detail={detail} />}
      <YearlyForm detail={detail} />
    </>
  );
}
