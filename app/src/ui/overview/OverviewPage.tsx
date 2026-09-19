import { useState, type DragEvent } from 'react';
import { Button, FileTrigger } from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import type { ImportType } from '../../domain/import-type.ts';
import {
  correctAnnualWork,
  loadAnnualWork,
  type AnnualWork,
  type AnnualWorkItem,
} from '../../services/annual-work.ts';
import { loadOverviewReminders } from '../../services/reminders.ts';
import { loadStallionOverview } from '../../services/stallions.ts';
import {
  loadTaskBoard,
  type LineCardView,
  type TaskBoard as TaskBoardData,
} from '../../services/tasks.ts';
import { Feedback, useAction } from '../actions.tsx';
import { IMPORT_TYPE_LABELS, importSummaryText } from '../import-labels.ts';
import type { ImportRequest } from '../imports/ImportsPage.tsx';
import { lineColorStyle } from '../line-color.ts';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { BLOCKER_LABELS, PHASE_LABELS } from './labels.ts';
import { RecoveryPanel } from './RecoveryPanel.tsx';
import { TaskBoard } from './TaskBoard.tsx';

export type ImportHandoff = Omit<ImportRequest, 'id'>;

/** 年度工作卡的月份徽章；檔名沒有時點時也用這個月的第 1 週預填。 */
const ANNUAL_MONTH: Partial<Readonly<Record<ImportType, number>>> = {
  jan2yo: 1,
  aprFoals: 4,
  mayMares: 5,
  mayStallions: 5,
  julMares: 7,
};

/** 年度工作卡的一句說明（需求規格 11 章各總表的用途）。 */
const ANNUAL_HINT: Partial<Readonly<Record<ImportType, string>>> = {
  jan2yo: '補產駒正式馬名與能力',
  aprFoals: '登記當年出生的幼駒並連回父母',
  mayMares: '繁殖牝馬圈的年度對帳',
  mayStallions: '種牡馬能力與目標種牡馬',
  julMares: '受胎結果與七月活力',
};

function MetricCards({
  board,
  work,
  reminderCount,
}: {
  readonly board: TaskBoardData;
  readonly work: AnnualWork | undefined;
  readonly reminderCount: number;
}) {
  const opened = board.lines.filter((line) => line.opened);
  const mares = opened.reduce((sum, line) => sum + line.mareCount, 0);
  const target = opened.reduce((sum, line) => sum + line.mareTarget, 0);
  const replenish = opened.filter((line) => line.needsReplenish).length;
  const done = work?.items.filter((item) => item.done).length ?? 0;
  const next = work?.items.find((item) => !item.done);
  const highPriority = board.tasks.filter((task) => task.highPriority).length;
  return (
    <ul className="metric-grid" aria-label="總覽摘要">
      <li className="metric-card">
        <p className="metric-label">年度工作（{board.currentYear} 年）</p>
        <p className="metric-value">
          {done}／{work?.items.length ?? 0}
        </p>
        <p className="metric-note">
          {next === undefined ? '今年的總表都已完成' : `下一項：${IMPORT_TYPE_LABELS[next.type]}`}
        </p>
      </li>
      <li className="metric-card">
        <p className="metric-label">八系位置</p>
        <p className="metric-value">{opened.length}／8 系</p>
        <p className="metric-note">親系統 {board.parentSystem.parentSystemCount}／8 種</p>
      </li>
      <li className="metric-card">
        <p className="metric-label">母馬群在圈</p>
        <p className="metric-value">
          {mares}／{target} 匹
        </p>
        <p className="metric-note">
          {replenish === 0 ? '各系母馬群都已達目標' : `${String(replenish)} 系待補`}
        </p>
      </li>
      <li className="metric-card">
        <p className="metric-label">任務與提醒</p>
        <p className="metric-value">{board.tasks.length} 項任務</p>
        <p className="metric-note">
          {highPriority > 0 && `高優先 ${String(highPriority)} 項・`}提醒 {reminderCount} 則
        </p>
      </li>
    </ul>
  );
}

/** 八系位置卡：已開啟的系顯示子系統、代數與母馬群，未開啟的系以虛框表示。 */
function LineCard({
  card,
  currents,
}: {
  readonly card: LineCardView;
  readonly currents: readonly string[];
}) {
  return (
    <li
      className="line-card"
      data-opened={card.opened}
      data-testid={`overview-line-${String(card.position)}`}
      style={lineColorStyle(card.color)}
    >
      <h4>第 {card.position} 系</h4>
      {!card.opened ? (
        <p className="line-card-empty">尚未開啟</p>
      ) : (
        <>
          <p className="line-card-name">{card.subsystem}</p>
          <dl>
            <div>
              <dt>親系統</dt>
              <dd>{card.parentSystem}</dd>
            </div>
            <div>
              <dt>最新代數</dt>
              <dd>
                {card.latestGeneration === undefined
                  ? '尚未成立'
                  : `${String(card.latestGeneration)} 代`}
              </dd>
            </div>
            <div>
              <dt>母馬群</dt>
              <dd>
                {card.mareCount}／{card.mareTarget}
              </dd>
            </div>
            <div>
              <dt>現任種牡馬</dt>
              <dd>{currents.length === 0 ? '尚未指定' : currents.join('、')}</dd>
            </div>
            {card.waitingYears !== undefined && card.waitingYears > 0 && (
              <div>
                <dt>等待年數</dt>
                <dd data-testid="line-waiting-years">{card.waitingYears} 年</dd>
              </div>
            )}
          </dl>
          {card.missing.length > 0 && (
            <p className="line-card-alert" data-testid="line-missing">
              {card.missing.map((blocker) => BLOCKER_LABELS[blocker]).join('、')}
            </p>
          )}
        </>
      )}
      {card.needsReplenish && (
        <p className="tag tag-amber" data-testid="line-needs-replenish">
          已成立，母馬群待補
        </p>
      )}
    </li>
  );
}

function workStatus(item: AnnualWorkItem): string {
  return `${item.done ? '已完成' : '未完成'}${item.corrected ? '（人工更正）' : ''}`;
}

/**
 * 年度工作卡（需求規格 13.2、UI-03）：依匯入紀錄自動標示完成並顯示摘要，可人工更正。
 * 卡片可直接選檔或拖入 TXT，帶到年度匯入頁預覽；十月全世界繁殖牝馬總表是選用的，不列入（11.10）。
 */
function AnnualWorkList({ onImport }: { readonly onImport: (handoff: ImportHandoff) => void }) {
  const { context } = useServices();
  const { data: work } = useServiceQuery(loadAnnualWork);
  const action = useAction();
  const [dragging, setDragging] = useState<ImportType>();
  if (work === undefined) {
    return null;
  }
  const handoff = (item: AnnualWorkItem, file: File | null | undefined) => {
    if (file === null || file === undefined) {
      return;
    }
    onImport({ file, type: item.type, timing: { month: ANNUAL_MONTH[item.type] ?? 1, week: 1 } });
  };
  return (
    <section aria-labelledby="annual-work-heading" className="annual-work">
      <div className="section-head">
        <div>
          <h3 id="annual-work-heading">年度工作清單（{work.gameYear} 年）</h3>
          <p>選檔或把 TXT 拖到卡片上，會帶到年度匯入頁先預覽，確認後才寫入。</p>
        </div>
      </div>
      <ul aria-label="年度工作清單" data-testid="annual-work" className="workflow-grid">
        {work.items.map((item) => {
          const label = IMPORT_TYPE_LABELS[item.type];
          return (
            <li
              key={item.type}
              className="workflow-card"
              data-done={item.done}
              data-dragging={dragging === item.type}
              data-testid={`annual-work-${item.type}`}
              onDragOver={(event: DragEvent<HTMLLIElement>) => {
                event.preventDefault();
                setDragging(item.type);
              }}
              onDragLeave={() => {
                setDragging(undefined);
              }}
              onDrop={(event: DragEvent<HTMLLIElement>) => {
                event.preventDefault();
                setDragging(undefined);
                handoff(item, event.dataTransfer.files.item(0));
              }}
            >
              <span className="workflow-month" aria-hidden="true">
                {ANNUAL_MONTH[item.type]}月
              </span>
              <p className="workflow-title">{label}</p>
              <p className="workflow-hint">{ANNUAL_HINT[item.type]}</p>
              <p className={`tag ${item.done ? 'tag-green' : ''}`}>{workStatus(item)}</p>
              {item.batch !== undefined && (
                <p className="workflow-batch">
                  {item.batch.fileName}：{importSummaryText(item.batch.summary)}
                </p>
              )}
              <div className="workflow-actions">
                <FileTrigger
                  acceptedFileTypes={['.txt', '.tsv', '.csv']}
                  onSelect={(files) => {
                    handoff(item, files?.item(0));
                  }}
                >
                  <Button className={item.done ? 'button-small' : 'button-small button-primary'}>
                    {item.done ? `重新匯入${label}` : `匯入${label}`}
                  </Button>
                </FileTrigger>
                <button
                  type="button"
                  className="button-small button-quiet"
                  disabled={action.busy}
                  onClick={() => {
                    void action.run(async () => {
                      await correctAnnualWork(context, { type: item.type, done: !item.done });
                      return `${label}已標示為${item.done ? '未完成' : '已完成'}。`;
                    });
                  }}
                >
                  {item.done ? '標示為未完成' : '標示為已完成'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Feedback message={action.message} error={action.error} />
    </section>
  );
}

function OverviewView({ onImport }: { readonly onImport: (handoff: ImportHandoff) => void }) {
  const { data: board, error } = useServiceQuery(loadTaskBoard);
  const { data: stallions, error: stallionError } = useServiceQuery(loadStallionOverview);
  const { data: others, error: reminderError } = useServiceQuery(loadOverviewReminders);
  const { data: work } = useServiceQuery(loadAnnualWork);
  if (board === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  // 提醒區集中所有提醒（需求規格 13.2、UI-06）：八系任務（母馬群待補、缺少種牡馬、等待年數）、
  // 種牡馬提醒年齡、母馬（高齡、最後配種年齡或定年、可出售母親）、對照表待補與備份。
  const reminders = [
    ...board.reminders,
    ...(stallions?.lines ?? []).flatMap((line) => line.reminders),
    ...(others?.mares ?? []),
    ...(others?.systemMap ?? []),
    ...(others?.backup ?? []),
  ];
  const currentsOf = (position: number) =>
    (stallions?.lines.find((line) => line.position === position)?.current ?? [])
      .filter((item) => item.dutyStatus === 'onDuty')
      .map((item) => `${String(item.generation)} 代 ${item.name}`);
  const phase = board.tasks[0]?.phase;
  return (
    <section aria-labelledby="overview-heading" className="dashboard">
      <h2 id="overview-heading" className="visually-hidden">
        總覽
      </h2>
      {error !== undefined && <p role="alert">{error}</p>}
      {stallionError !== undefined && <p role="alert">{stallionError}</p>}
      {reminderError !== undefined && <p role="alert">{reminderError}</p>}

      <MetricCards board={board} work={work} reminderCount={reminders.length} />

      <section aria-labelledby="line-cards-heading" className="lines-panel">
        <div className="section-head">
          <div>
            <h3 id="line-cards-heading">八系卡片</h3>
            <p>系位置由下方任務看板依建系分支開啟；點八系頁可更新系統名稱與種牡馬。</p>
          </div>
          <p className="tag">
            {phase === undefined ? '尚無任務' : PHASE_LABELS[phase]}・{board.currentYear} 年
          </p>
        </div>
        <ul className="line-grid">
          {board.lines.map((card) => (
            <LineCard key={card.position} card={card} currents={currentsOf(card.position)} />
          ))}
        </ul>
        <TaskBoard />
      </section>

      <AnnualWorkList onImport={onImport} />

      <section aria-labelledby="parent-system-heading" className="parent-panel">
        <h3 id="parent-system-heading">八系親系統狀態</h3>
        <p className="metric-value" data-testid="parent-system-count">
          親系統種類數 {board.parentSystem.parentSystemCount}／8
        </p>
        {board.parentSystem.duplicates.length === 0 ? (
          <p className="notice">沒有重複的親系統。</p>
        ) : (
          <ul aria-label="重複的親系統" className="reminders">
            {board.parentSystem.duplicates.map((duplicate) => (
              <li key={duplicate.parentSystem}>
                「{duplicate.parentSystem}」重複於
                {duplicate.positions.map((position) => `第 ${String(position)} 系`).join('、')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="reminders-heading" className="reminders-panel">
        <div className="section-head">
          <h3 id="reminders-heading">提醒區</h3>
          <p className="tag">{reminders.length} 則</p>
        </div>
        {reminders.length === 0 ? (
          <p className="empty-inline">目前沒有提醒。</p>
        ) : (
          <ul aria-label="提醒" className="reminders" data-testid="reminders">
            {reminders.map((reminder) => (
              <li key={reminder}>{reminder}</li>
            ))}
          </ul>
        )}
      </section>

      <RecoveryPanel />
    </section>
  );
}

export function OverviewPage({
  currentGame,
  onImport,
}: {
  readonly currentGame: Game | undefined;
  readonly onImport: (handoff: ImportHandoff) => void;
}) {
  return currentGame === undefined ? (
    <NoGameNotice />
  ) : (
    <OverviewView key={currentGame.id} onImport={onImport} />
  );
}
