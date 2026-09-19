import { useCallback, useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { LinePosition } from '../../domain/line.ts';
import type { RecoverySide } from '../../domain/recovery.ts';
import type { ServiceContext } from '../../services/context.ts';
import {
  declareRecovery,
  finishRecovery,
  loadActiveRecovery,
  RECOVERY_SIDE_OPTIONS,
} from '../../services/recoveries.ts';
import { loadTaskBoard } from '../../services/tasks.ts';
import { Feedback, useAction, useErrorLink } from '../actions.tsx';
import { OptionalIntegerField, SelectField } from '../fields.tsx';
import { lineColorStyle } from '../line-color.ts';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';

const SIDE_LABELS: Readonly<Record<RecoverySide, string>> = {
  sire: '公系',
  dam: '母系',
  both: '公系與母系',
};

const SIDE_CHOICES = RECOVERY_SIDE_OPTIONS.map((side) => ({
  value: side,
  label: SIDE_LABELS[side],
}));

/**
 * 母馬群待補時的三個選擇（需求規格 7.6、LINE-19）：原階段重試、市場補血、宣告斷血並補系。
 * 系統只列出選項與各自的下一步，不代選。
 */
function RecoveryChoices({
  position,
  generation,
}: {
  readonly position: LinePosition;
  readonly generation: number;
}) {
  return (
    <ul className="recovery-choices" aria-label={`第 ${String(position)} 系的處理選擇`}>
      <li>
        <strong>原階段重試</strong>：不做任何登記，等下一年再依任務配種。
      </li>
      <li>
        <strong>市場補血</strong>：到母馬群手動新增替代第 {position} 系 {generation}{' '}
        代的市場母馬，產駒承接下一代。
      </li>
      <li>
        <strong>宣告斷血並補系</strong>
        ：按「宣告斷血並補系…」展開表單登記，補入親馬為零代，產駒承接下一代。
      </li>
    </ul>
  );
}

function DeclareForm({
  position,
  generation,
}: {
  readonly position: LinePosition;
  readonly generation: number;
}) {
  const { context } = useServices();
  const action = useAction();
  const errorLink = useErrorLink(action.error);
  const [side, setSide] = useState<RecoverySide>('dam');
  const [reason, setReason] = useState('');
  const [breakGeneration, setBreakGeneration] = useState<number | undefined>(generation);

  return (
    <Form
      aria-label={`宣告第 ${String(position)} 系斷血`}
      {...errorLink.formProps}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          const recovery = await declareRecovery(context, {
            position,
            generation: breakGeneration,
            side,
            reason,
          });
          return `已宣告第 ${String(position)} 系 ${String(recovery.generation)} 代斷血，補系將產出 ${String(recovery.generation + 1)} 代`;
        });
      }}
    >
      <OptionalIntegerField
        label="斷血的代數"
        value={breakGeneration}
        onChange={setBreakGeneration}
      />
      <SelectField
        label="中斷的一側"
        value={side}
        options={SIDE_CHOICES}
        onChange={(next) => {
          if (next !== undefined) {
            setSide(next);
          }
        }}
      />
      <TextField value={reason} onChange={setReason}>
        <Label>原因</Label>
        <Input />
      </TextField>
      <Feedback message={action.message} error={action.error} id={errorLink.id} />
      <Button type="submit" isDisabled={action.busy}>
        宣告斷血
      </Button>
    </Form>
  );
}

/** 宣告斷血是少用且影響整個循環的操作，表單收在按鈕後，按下才展開。 */
function DeclareToggle({
  position,
  generation,
}: {
  readonly position: LinePosition;
  readonly generation: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        className="button-small"
        aria-expanded={open}
        onPress={() => {
          setOpen(!open);
        }}
      >
        {open ? '收起斷血表單' : '宣告斷血並補系…'}
      </Button>
      {open && <DeclareForm position={position} generation={generation} />}
    </>
  );
}

/** 補系進行中：顯示進度與結束操作（需求規格 7.6、LINE-20、LINE-21）。 */
export function RecoveryPanel() {
  const load = useCallback(
    async (context: ServiceContext) => ({
      active: await loadActiveRecovery(context),
      board: await loadTaskBoard(context),
    }),
    [],
  );
  const { data, error } = useServiceQuery(load);
  const { context } = useServices();
  const action = useAction();
  const [foalId, setFoalId] = useState('');
  if (data === undefined) {
    return error === undefined ? null : <p role="alert">{error}</p>;
  }
  const { active, board } = data;
  const waiting = board.lines.filter((line) => line.needsReplenish);
  if (active === undefined && waiting.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="recovery-heading" className="recovery-panel">
      <div className="section-head">
        <div>
          <h3 id="recovery-heading">母馬群待補與斷血補系</h3>
          <p>已成立的代數母馬群降為 0 時，從三種處理方式中自行選擇，系統不代選。</p>
        </div>
        <p className={`tag ${active === undefined ? 'tag-amber' : 'tag-red'}`}>
          {active === undefined ? `${String(waiting.length)} 系待補` : '補系進行中'}
        </p>
      </div>
      <div data-testid="recovery-feedback">
        <Feedback message={action.message} error={action.error} />
      </div>
      {active === undefined ? (
        <ul className="recovery-grid">
          {waiting.map((line) => (
            <li
              key={line.position}
              className="recovery-card"
              style={lineColorStyle(line.color)}
              data-testid={`recovery-waiting-${String(line.position)}`}
            >
              <h4>
                第 {line.position} 系 {line.latestGeneration} 代已成立，母馬群待補
              </h4>
              <RecoveryChoices position={line.position} generation={line.latestGeneration ?? 1} />
              <DeclareToggle position={line.position} generation={line.latestGeneration ?? 1} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="recovery-active" data-testid="recovery-active">
          <p>
            第 {active.recovery.position} 系 {active.recovery.generation} 代於{' '}
            {active.recovery.gameYear} 年宣告斷血（{SIDE_LABELS[active.recovery.side]}）：
            {active.recovery.reason}
          </p>
          <p className="notice">
            補系進行中：暫停新增下一系與循環換代，補系將產出 {active.targetGeneration} 代。
          </p>
          {active.foalOptions.length === 0 ? (
            <p className="notice">
              第 {active.recovery.position} 系還沒有 {active.targetGeneration}{' '}
              代的自家產駒，先依補系的配對登記產駒再完成補系。
            </p>
          ) : (
            <SelectField
              label="重新加入的產駒"
              value={foalId === '' ? (active.foalOptions[0]?.id ?? '') : foalId}
              options={active.foalOptions.map((option) => ({
                value: option.id,
                label: option.name,
              }))}
              onChange={(next) => {
                if (next !== undefined) {
                  setFoalId(next);
                }
              }}
            />
          )}
          <div className="actions">
            <Button
              type="button"
              isDisabled={action.busy || active.foalOptions.length === 0}
              onPress={() => {
                void action.run(async () => {
                  await finishRecovery(context, {
                    recoveryId: active.recovery.id,
                    foalId: foalId === '' ? active.foalOptions[0]?.id : foalId,
                  });
                  setFoalId('');
                  return `已完成第 ${String(active.recovery.position)} 系的補系`;
                });
              }}
            >
              完成補系
            </Button>
            <Button
              type="button"
              isDisabled={action.busy}
              onPress={() => {
                void action.run(async () => {
                  await finishRecovery(context, {
                    recoveryId: active.recovery.id,
                    cancelled: true,
                  });
                  return `已取消第 ${String(active.recovery.position)} 系的補系`;
                });
              }}
            >
              取消補系
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
