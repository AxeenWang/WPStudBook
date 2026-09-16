import type { Game } from '../../domain/game.ts';
import { loadStallionOverview } from '../../services/stallions.ts';
import { loadTaskBoard, type LineCardView } from '../../services/tasks.ts';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery } from '../ServicesContext.tsx';
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
      style={card.color === undefined ? undefined : { borderLeftColor: card.color }}
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
        </dl>
      )}
    </li>
  );
}

function OverviewView() {
  const { data: board, error } = useServiceQuery(loadTaskBoard);
  const { data: stallions, error: stallionError } = useServiceQuery(loadStallionOverview);
  if (board === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  const reminders = (stallions?.lines ?? []).flatMap((line) => line.reminders);
  const currentsOf = (position: number) =>
    (stallions?.lines.find((line) => line.position === position)?.current ?? [])
      .filter((item) => item.dutyStatus === 'onDuty')
      .map((item) => `${String(item.generation)} 代 ${item.name}`);
  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading">總覽</h2>
      {error !== undefined && <p role="alert">{error}</p>}
      {stallionError !== undefined && <p role="alert">{stallionError}</p>}

      <section aria-labelledby="reminders-heading">
        <h3 id="reminders-heading">提醒區</h3>
        {reminders.length === 0 ? (
          <p>目前沒有提醒。</p>
        ) : (
          <ul aria-label="提醒" className="reminders">
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
