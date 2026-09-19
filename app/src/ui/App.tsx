import { useEffect, useState } from 'react';
import { loadAppStatus } from '../services/app-status.ts';
import {
  closeServiceContext,
  openServiceContext,
  requestPersistentStorage,
  type ServiceContext,
} from '../services/context.ts';
import { DataManagementPage } from './data-management/DataManagementPage.tsx';
import { FoalsPage } from './foals/FoalsPage.tsx';
import { ImportsPage, type ImportRequest } from './imports/ImportsPage.tsx';
import { errorMessage } from './format.ts';
import { LinesPage } from './lines/LinesPage.tsx';
import { MaresPage } from './mares/MaresPage.tsx';
import { OverviewPage, type ImportHandoff } from './overview/OverviewPage.tsx';
import { pageLabel, type PageKey } from './pages.ts';
import { ServicesProvider, useServiceQuery } from './ServicesContext.tsx';
import { Sidebar } from './Sidebar.tsx';
import { SystemMapPage } from './system-map/SystemMapPage.tsx';
import { TopBar } from './TopBar.tsx';

type Boot =
  | { readonly state: 'opening' }
  | { readonly state: 'ready'; readonly context: ServiceContext }
  | { readonly state: 'failed'; readonly message: string };

function AppShell() {
  const { data: status, error } = useServiceQuery(loadAppStatus);
  const [page, setPage] = useState<PageKey>();
  const [focusBackup, setFocusBackup] = useState(false);
  const [importRequest, setImportRequest] = useState<ImportRequest>();
  // 第一次讀到狀態時決定起始頁：還沒有遊戲局就到資料管理建立，已有遊戲局就從總覽開始。
  // 之後建立或切換遊戲局都不再自動換頁。
  if (page === undefined && status !== undefined) {
    setPage(status.currentGame === undefined ? 'data' : 'overview');
  }
  useEffect(() => {
    if (focusBackup && page === 'data') {
      const heading = document.getElementById('backup-heading');
      heading?.scrollIntoView({ block: 'start' });
      heading?.focus({ preventScroll: true });
      setFocusBackup(false);
    }
  }, [focusBackup, page]);
  const currentGame = status?.currentGame;
  const handOffImport = (handoff: ImportHandoff) => {
    if (currentGame === undefined) {
      return;
    }
    setImportRequest((previous) => ({
      ...handoff,
      id: (previous?.id ?? 0) + 1,
      gameId: currentGame.id,
    }));
    setPage('imports');
  };
  // 交接的檔案只屬於交接時的那一局；在年度匯入頁切換遊戲局後不再帶入。
  const activeImportRequest = importRequest?.gameId === currentGame?.id ? importRequest : undefined;
  return (
    <div className="app-shell">
      <Sidebar
        status={status}
        page={page}
        onNavigate={(key) => {
          // 從側欄進年度匯入頁是重新開始，不再帶入總覽卡片交接過的檔案。
          setImportRequest(undefined);
          setPage(key);
        }}
      />
      <div className="workspace">
        <TopBar
          status={status}
          error={error}
          eyebrow={page === undefined ? '八系繁殖管理' : pageLabel(page)}
          onOpenBackup={() => {
            setPage('data');
            setFocusBackup(true);
          }}
        />
        <main>
          {page === 'overview' && (
            <OverviewPage currentGame={currentGame} onImport={handOffImport} />
          )}
          {page === 'lines' && <LinesPage currentGame={currentGame} />}
          {page === 'mares' && <MaresPage currentGame={currentGame} />}
          {page === 'foals' && <FoalsPage currentGame={currentGame} />}
          {page === 'imports' && (
            <ImportsPage currentGame={currentGame} request={activeImportRequest} />
          )}
          {page === 'systemMap' && <SystemMapPage currentGame={currentGame} />}
          {page === 'data' && <DataManagementPage status={status} />}
        </main>
      </div>
    </div>
  );
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'opening' });
  const [blocked, setBlocked] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 用函式包住 cancelled 的讀取，避免 TypeScript 把 await 前後兩次檢查的結果
    // 窄化成同一個字面值（strictTypeChecked 的 no-unnecessary-condition 會誤報）。
    const isCancelled = () => cancelled;
    let opened: ServiceContext | undefined;
    const start = async () => {
      try {
        const context = await openServiceContext({
          appVersion: __APP_VERSION__,
          onBlocked: () => {
            setBlocked(true);
          },
          onConnectionLost: () => {
            setConnectionLost(true);
          },
        });
        if (isCancelled()) {
          closeServiceContext(context);
          return;
        }
        opened = context;
        await requestPersistentStorage(context);
        if (!isCancelled()) {
          setBoot({ state: 'ready', context });
        }
      } catch (error) {
        if (!isCancelled()) {
          setBoot({ state: 'failed', message: errorMessage(error) });
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      if (opened !== undefined) {
        closeServiceContext(opened);
      }
    };
  }, []);

  return (
    <div className="app">
      {blocked && boot.state === 'opening' && (
        <p role="alert">其他分頁仍開著舊版本的 WPStudBook，請關閉其他分頁後重新整理。</p>
      )}
      {connectionLost && (
        <p role="alert">資料庫連線已中斷（可能是其他分頁開啟了新版本），請重新整理頁面。</p>
      )}
      {boot.state === 'opening' && <p role="status">資料庫開啟中…</p>}
      {boot.state === 'failed' && (
        <>
          <h1>WPStudBook</h1>
          <p role="alert">{boot.message}</p>
        </>
      )}
      {boot.state === 'ready' && (
        <ServicesProvider context={boot.context}>
          <AppShell />
        </ServicesProvider>
      )}
    </div>
  );
}
