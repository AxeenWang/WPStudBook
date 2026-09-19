import { useId, useState } from 'react';
import type { AppStatus } from '../services/app-status.ts';
import { switchGame } from '../services/games.ts';
import { errorMessage } from './format.ts';
import { PAGE_GROUPS, type PageKey } from './pages.ts';
import { useServices } from './ServicesContext.tsx';

/**
 * 側欄的遊戲局切換；與資料管理頁的遊戲局列表做同一件事。選好後按「切換」才生效：原生下拉選單
 * 收合時按方向鍵就會觸發 change，直接切換會讓瀏覽選項變成一連串切局（WCAG 3.2.2）。
 */
function GameSwitcher({ status }: { readonly status: AppStatus | undefined }) {
  const { context, notifyChanged } = useServices();
  const [error, setError] = useState<string>();
  const id = useId();
  const games = status?.games ?? [];
  const current = status?.currentGame;
  const [chosen, setChosen] = useState(current?.id ?? '');

  const switchTo = async (gameId: string) => {
    try {
      await switchGame(context, gameId);
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      notifyChanged();
    }
  };

  return (
    <div className="game-switcher">
      <label htmlFor={id}>目前遊戲局</label>
      <div className="game-switcher-row">
        <select
          id={id}
          value={chosen}
          disabled={games.length === 0}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
        >
          {current === undefined && <option value="">尚未建立遊戲局</option>}
          {games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name}・{game.currentYear} 年
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="切換遊戲局"
          disabled={chosen === '' || chosen === current?.id}
          onClick={() => {
            void switchTo(chosen);
          }}
        >
          切換
        </button>
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
    </div>
  );
}

export function Sidebar({
  status,
  page,
  onNavigate,
}: {
  readonly status: AppStatus | undefined;
  readonly page: PageKey | undefined;
  readonly onNavigate: (page: PageKey) => void;
}) {
  return (
    <div className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          WP
        </span>
        <div>
          <p className="brand-name">WPStudBook</p>
          <p className="brand-sub">Winning Post 10 2026</p>
        </div>
      </div>
      <GameSwitcher key={status?.currentGame?.id ?? ''} status={status} />
      <nav aria-label="主要頁面" className="main-nav">
        {PAGE_GROUPS.map((group) => (
          <div key={group.label} className="nav-group">
            <p className="sidebar-label">{group.label}</p>
            <ul className="nav-list">
              {group.pages.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-current={page === item.key ? 'page' : undefined}
                    onClick={() => {
                      onNavigate(item.key);
                    }}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <p data-testid="app-version">版本 {__APP_VERSION__}</p>
        <p>離線單檔・不連線、不上傳</p>
      </div>
    </div>
  );
}
