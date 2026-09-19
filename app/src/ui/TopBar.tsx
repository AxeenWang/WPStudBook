import { useState } from 'react';
import { Button } from 'react-aria-components';
import type { AppStatus } from '../services/app-status.ts';
import type { PersistenceState, WriteStatus } from '../services/context.ts';
import { CreateGameForm, YearChangeForm } from './data-management/GameSection.tsx';
import { FormDialog } from './dialogs.tsx';
import { formatCount, formatDateTime } from './format.ts';

/** 狀態膠囊只放短字；需要說明的風險另外顯示在提醒橫幅。 */
const PERSISTENCE_TEXT: Readonly<Record<PersistenceState, string>> = {
  unknown: '持久保存確認中',
  persisted: '已取得持久保存',
  notPersisted: '未取得持久保存',
  unsupported: '無法確認持久保存',
};

type Tone = 'ok' | 'warn' | 'error' | 'idle';

function describeWrite(write: WriteStatus): { readonly text: string; readonly tone: Tone } {
  switch (write.state) {
    case 'none':
      return { text: '尚未寫入', tone: 'idle' };
    case 'saved':
      return { text: `已保存（${formatDateTime(write.at)}）`, tone: 'ok' };
    case 'failed':
      return { text: `保存失敗（${formatDateTime(write.at)}）：${write.message}`, tone: 'error' };
  }
}

function describeStatus(status: AppStatus) {
  const { currentGame, lastCheckpoint } = status;
  const lastBackup = currentGame?.lastBackup;
  return {
    game: currentGame?.name ?? '尚未建立遊戲局',
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

/**
 * 資料遺失風險（需求規格 12.1）：沒有持久保存或這一局還沒備份時顯示橫幅。
 * 說明文字原本常駐在狀態列，改成有風險時才出現，平常只留側欄的一行。
 */
function RiskNotice({ status }: { readonly status: AppStatus }) {
  const { currentGame, persistence } = status;
  const notPersisted = persistence === 'notPersisted' || persistence === 'unsupported';
  const noBackup = currentGame !== undefined && currentGame.lastBackup === undefined;
  if (!notPersisted && !noBackup) {
    return null;
  }
  return (
    <aside className="risk-notice" aria-label="資料保存提醒">
      <span className="risk-icon" aria-hidden="true">
        ⚑
      </span>
      <div>
        <p className="risk-title">{noBackup ? '這一局還沒有外部備份' : '瀏覽器沒有給予持久保存'}</p>
        <p>
          資料只存在這個瀏覽器的設定檔：換瀏覽器或設定檔、清除網站資料、關閉
          InPrivate／無痕視窗後都看不到原資料；同一設定檔開啟的本機 HTML
          檔共用同一份資料。請定期下載外部備份。
        </p>
      </div>
    </aside>
  );
}

type TopDialog = 'year' | 'create';

export function TopBar({
  status,
  error,
  eyebrow,
  onOpenBackup,
}: {
  readonly status: AppStatus | undefined;
  readonly error: string | undefined;
  /** 目前頁面的名稱，顯示在遊戲局名上方。 */
  readonly eyebrow: string;
  readonly onOpenBackup: () => void;
}) {
  const [dialog, setDialog] = useState<TopDialog>();
  const text = status === undefined ? undefined : describeStatus(status);
  const write = status === undefined ? undefined : describeWrite(status.write);
  const currentGame = status?.currentGame;
  const close = () => {
    setDialog(undefined);
  };
  return (
    <header className="topbar">
      <div className="topbar-main">
        <div className="topbar-title">
          <p className="eyebrow">{eyebrow}</p>
          <h1 data-testid="status-game">{text?.game ?? 'WPStudBook'}</h1>
          {status !== undefined && text !== undefined && (
            <p className="subtitle">
              目前遊戲年 <strong data-testid="status-year">{text.year}</strong>
              <span aria-hidden="true">・</span>
              領域資料{' '}
              <strong data-testid="status-records">{formatCount(status.recordCount)}</strong>
            </p>
          )}
        </div>
        <div className="top-actions" role="group" aria-label="常用操作">
          {currentGame !== undefined && (
            <Button
              className="button-secondary"
              onPress={() => {
                setDialog('year');
              }}
            >
              更新年份
            </Button>
          )}
          <Button className="button-secondary" onPress={onOpenBackup}>
            備份與還原
          </Button>
          <Button
            className="button-primary"
            onPress={() => {
              setDialog('create');
            }}
          >
            ＋ 新遊戲局
          </Button>
        </div>
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
      {status !== undefined && text !== undefined && write !== undefined && (
        <ul className="status-pills" aria-label="保存狀態">
          <li className="status-pill" data-tone={write.tone}>
            <span className="status-dot" aria-hidden="true" />
            <span className="visually-hidden">保存狀態：</span>
            <span data-testid="status-save">{write.text}</span>
          </li>
          <li
            className="status-pill"
            data-tone={status.persistence === 'persisted' ? 'ok' : 'warn'}
          >
            <span className="status-dot" aria-hidden="true" />
            <span data-testid="status-persistence">{PERSISTENCE_TEXT[status.persistence]}</span>
          </li>
          <li className="status-pill">
            <span className="pill-label">最近備份</span>
            <span data-testid="status-backup">{text.backup}</span>
          </li>
          <li className="status-pill">
            <span className="pill-label">最近檢查點</span>
            <span data-testid="status-checkpoint">{text.checkpoint}</span>
          </li>
        </ul>
      )}
      {status !== undefined && <RiskNotice status={status} />}
      {dialog === 'year' && currentGame !== undefined && (
        <FormDialog
          title="更新目前遊戲年"
          description="遊戲年只由你更新，不會依電腦日期改變。"
          onClose={close}
        >
          <YearChangeForm
            key={`${currentGame.id}-${String(currentGame.currentYear)}`}
            currentGame={currentGame}
            inDialog
            onDone={close}
          />
        </FormDialog>
      )}
      {dialog === 'create' && (
        <FormDialog
          title="建立遊戲局"
          description="每一局的資料各自獨立，不會互相配對或覆寫。"
          onClose={close}
        >
          <CreateGameForm currentGame={currentGame} inDialog onDone={close} />
        </FormDialog>
      )}
    </header>
  );
}
