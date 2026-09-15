import { useEffect, useState } from 'react';
import { loadAppStatus } from '../services/app-status.ts';
import {
  closeServiceContext,
  openServiceContext,
  requestPersistentStorage,
  type ServiceContext,
} from '../services/context.ts';
import { DataManagementPage } from './data-management/DataManagementPage.tsx';
import { errorMessage } from './format.ts';
import { ServicesProvider, useServiceQuery } from './ServicesContext.tsx';
import { StatusBar } from './StatusBar.tsx';

type Boot =
  | { readonly state: 'opening' }
  | { readonly state: 'ready'; readonly context: ServiceContext }
  | { readonly state: 'failed'; readonly message: string };

function AppShell() {
  const { data: status, error } = useServiceQuery(loadAppStatus);
  return (
    <>
      <StatusBar status={status} error={error} />
      <main>
        <DataManagementPage status={status} />
      </main>
    </>
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
