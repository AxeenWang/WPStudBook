import type { Game } from '../../domain/game.ts';
import { lineColorLabel, listLineSlots, type LineSlot } from '../../services/lines.ts';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery } from '../ServicesContext.tsx';
import { OpenFirstLineForm } from './OpenFirstLineForm.tsx';

function LineCard({ slot }: { readonly slot: LineSlot }) {
  const { line } = slot;
  return (
    <li
      className="line-card"
      data-testid={`line-slot-${String(slot.position)}`}
      style={line === undefined ? undefined : { borderLeftColor: line.color }}
    >
      <h3>第 {slot.position} 系</h3>
      {line === undefined ? (
        <p>尚未開啟</p>
      ) : (
        <dl>
          <div>
            <dt>目前子系統</dt>
            <dd>{line.subsystem}</dd>
          </div>
          <div>
            <dt>親系統</dt>
            <dd>{line.parentSystem}</dd>
          </div>
          <div>
            <dt>零代市場種牡馬</dt>
            <dd>{slot.founderName ?? '—'}</dd>
          </div>
          <div>
            <dt>開啟年份</dt>
            <dd>{line.branch.openedYear} 年</dd>
          </div>
          <div>
            <dt>代表色</dt>
            <dd>
              <span
                className="color-swatch"
                style={{ background: line.color }}
                aria-hidden="true"
              />
              {lineColorLabel(line.color)}
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}

function LinesView() {
  const { data: slots, error } = useServiceQuery(listLineSlots);
  if (slots === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  const firstLineOpened = slots.some((slot) => slot.position === 1 && slot.line !== undefined);
  return (
    <section aria-labelledby="lines-heading">
      <h2 id="lines-heading">八系位置</h2>
      <p>開局時八個位置全部空白。先開啟第 1 系；其他系在建系分支開啟時建立。</p>
      {error !== undefined && <p role="alert">{error}</p>}
      <ul className="line-grid">
        {slots.map((slot) => (
          <LineCard key={slot.position} slot={slot} />
        ))}
      </ul>
      {!firstLineOpened && <OpenFirstLineForm />}
    </section>
  );
}

export function LinesPage({ currentGame }: { readonly currentGame: Game | undefined }) {
  return currentGame === undefined ? <NoGameNotice /> : <LinesView key={currentGame.id} />;
}
