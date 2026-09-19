import type { Game } from '../../domain/game.ts';
import { correctAnnualWork, loadAnnualWork } from '../../services/annual-work.ts';
import { loadOverviewReminders } from '../../services/reminders.ts';
import { loadStallionOverview } from '../../services/stallions.ts';
import { loadTaskBoard, type LineCardView } from '../../services/tasks.ts';
import { Feedback, useAction } from '../actions.tsx';
import { lineColorStyle } from '../line-color.ts';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { IMPORT_TYPE_LABELS, importSummaryText } from '../import-labels.ts';
import { BLOCKER_LABELS } from './labels.ts';
import { RecoveryPanel } from './RecoveryPanel.tsx';
import { TaskBoard } from './TaskBoard.tsx';

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
      data-testid={`overview-line-${String(card.position)}`}
      style={lineColorStyle(card.color)}
    >
      <h4>第 {card.position} 系</h4>
      {!card.opened ? (
        <p>尚未開啟</p>
      ) : (
        <dl>
          <div>
            <dt>目前子系統</dt>
            <dd>{card.subsystem}</dd>
          </div>
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
            <dt>各代現任種牡馬</dt>
            <dd>{currents.length === 0 ? '尚未指定' : currents.join('、')}</dd>
          </div>
          {card.waitingYears !== undefined && card.waitingYears > 0 && (
            <div>
              <dt>等待年數</dt>
              <dd data-testid="line-waiting-years">{card.waitingYears} 年</dd>
            </div>
          )}
          {card.missing.length > 0 && (
            <div>
              <dt>缺項</dt>
              <dd data-testid="line-missing">
                {card.missing.map((blocker) => BLOCKER_LABELS[blocker]).join('、')}
              </dd>
            </div>
          )}
        </dl>
      )}
      {card.needsReplenish && (
        <p className="notice" data-testid="line-needs-replenish">
          已成立，母馬群待補
        </p>
      )}
    </li>
  );
}

/**
 * 年度工作清單（需求規格 13.2、UI-03）：依匯入紀錄自動標示完成並顯示摘要，可人工更正。
 * 十月全世界繁殖牝馬總表是選用的，不列入清單（11.10）。
 */
function AnnualWorkList() {
  const { context } = useServices();
  const { data: work } = useServiceQuery(loadAnnualWork);
  const action = useAction();
  if (work === undefined) {
    return null;
  }
  return (
    <section aria-labelledby="annual-work-heading">
      <h3 id="annual-work-heading">年度工作清單（{work.gameYear} 年）</h3>
      <ul aria-label="年度工作清單" data-testid="annual-work">
        {work.items.map((item) => {
          const label = IMPORT_TYPE_LABELS[item.type];
          return (
            <li key={item.type} data-testid={`annual-work-${item.type}`}>
              {label}：{item.done ? '已完成' : '未完成'}
              {item.corrected && '（人工更正）'}
              {item.batch !== undefined &&
                `（${item.batch.fileName}：${importSummaryText(item.batch.summary)}）`}{' '}
              <button
                type="button"
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
            </li>
          );
        })}
      </ul>
      <Feedback message={action.message} error={action.error} />
    </section>
  );
}

function OverviewView() {
  const { data: board, error } = useServiceQuery(loadTaskBoard);
  const { data: stallions, error: stallionError } = useServiceQuery(loadStallionOverview);
  const { data: others, error: reminderError } = useServiceQuery(loadOverviewReminders);
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
  return (
    <section aria-labelledby="overview-heading" className="dashboard">
      <h2 id="overview-heading">總覽</h2>
      {error !== undefined && <p role="alert">{error}</p>}
      {stallionError !== undefined && <p role="alert">{stallionError}</p>}
      {reminderError !== undefined && <p role="alert">{reminderError}</p>}

      <AnnualWorkList />

      <section aria-labelledby="reminders-heading">
        <h3 id="reminders-heading">提醒區</h3>
        {reminders.length === 0 ? (
          <p>目前沒有提醒。</p>
        ) : (
          <ul aria-label="提醒" className="reminders" data-testid="reminders">
            {reminders.map((reminder) => (
              <li key={reminder} className="notice">
                {reminder}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="parent-system-heading">
        <h3 id="parent-system-heading">八系親系統狀態</h3>
        <p data-testid="parent-system-count">
          親系統種類數 {board.parentSystem.parentSystemCount}／8
        </p>
        {board.parentSystem.duplicates.length === 0 ? (
          <p>沒有重複的親系統。</p>
        ) : (
          <ul aria-label="重複的親系統" className="reminders">
            {board.parentSystem.duplicates.map((duplicate) => (
              <li key={duplicate.parentSystem} className="notice">
                「{duplicate.parentSystem}」重複於
                {duplicate.positions.map((position) => `第 ${String(position)} 系`).join('、')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecoveryPanel />

      <section aria-labelledby="line-cards-heading">
        <h3 id="line-cards-heading">八系卡片</h3>
        <ul className="line-grid">
          {board.lines.map((card) => (
            <LineCard key={card.position} card={card} currents={currentsOf(card.position)} />
          ))}
        </ul>
      </section>

      <TaskBoard />
    </section>
  );
}

export function OverviewPage({ currentGame }: { readonly currentGame: Game | undefined }) {
  return currentGame === undefined ? <NoGameNotice /> : <OverviewView key={currentGame.id} />;
}
