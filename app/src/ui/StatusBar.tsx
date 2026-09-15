import type { AppStatus } from '../services/app-status.ts';
import type { PersistenceState, WriteStatus } from '../services/context.ts';
import { formatCount, formatDateTime } from './format.ts';

const PERSISTENCE_TEXT: Readonly<Record<PersistenceState, string>> = {
  unknown: '確認中',
  persisted: '已取得持久保存',
  notPersisted: '未取得持久保存：空間不足時瀏覽器可能清除資料，務必定期下載外部備份',
  unsupported: '無法確認持久保存：請定期下載外部備份',
};

function describeWrite(write: WriteStatus): string {
  switch (write.state) {
    case 'none':
      return '尚未寫入';
    case 'saved':
      return `已保存（${formatDateTime(write.at)}）`;
    case 'failed':
      return `保存失敗（${formatDateTime(write.at)}）：${write.message}`;
  }
}

function describeStatus(status: AppStatus) {
  const { currentGame, lastCheckpoint } = status;
  const lastBackup = currentGame?.lastBackup;
  return {
    game: currentGame?.name ?? '尚未建立',
    year: currentGame === undefined ? '—' : `${String(currentGame.currentYear)} 年`,
    backup:
      lastBackup === undefined
        ? '尚未備份'
        : `${formatDateTime(lastBackup.exportedAt)}（${lastBackup.fileName}）`,
    checkpoint:
      lastCheckpoint === undefined
        ? '尚無檢查點'
        : [
            `${String(lastCheckpoint.gameYear)} 年`,
            formatDateTime(lastCheckpoint.createdAt),
            ...(lastCheckpoint.note === undefined ? [] : [lastCheckpoint.note]),
          ].join('・'),
  };
}

export function StatusBar({
  status,
  error,
}: {
  readonly status: AppStatus | undefined;
  readonly error: string | undefined;
}) {
  const text = status === undefined ? undefined : describeStatus(status);
  return (
    <header className="status-bar">
      <h1>WPStudBook</h1>
      <p data-testid="app-version">版本 {__APP_VERSION__}</p>
      {error !== undefined && <p role="alert">{error}</p>}
      {status !== undefined && text !== undefined && (
        <dl>
          <div>
            <dt>遊戲局</dt>
            <dd data-testid="status-game">{text.game}</dd>
          </div>
          <div>
            <dt>遊戲年</dt>
            <dd data-testid="status-year">{text.year}</dd>
          </div>
          <div>
            <dt>筆數</dt>
            <dd data-testid="status-records">{formatCount(status.recordCount)}</dd>
          </div>
          <div>
            <dt>保存狀態</dt>
            <dd data-testid="status-save">{describeWrite(status.write)}</dd>
          </div>
          <div>
            <dt>持久保存</dt>
            <dd data-testid="status-persistence">{PERSISTENCE_TEXT[status.persistence]}</dd>
          </div>
          <div>
            <dt>最近備份</dt>
            <dd data-testid="status-backup">{text.backup}</dd>
          </div>
          <div>
            <dt>最近檢查點</dt>
            <dd data-testid="status-checkpoint">{text.checkpoint}</dd>
          </div>
        </dl>
      )}
      <p className="notice">
        資料只存在這個瀏覽器：搬移 HTML
        檔、清除網站資料或換瀏覽器設定檔都會看不到原資料，請定期下載外部備份。
      </p>
    </header>
  );
}
