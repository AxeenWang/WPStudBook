import type { AppStatus } from '../../services/app-status.ts';
import { EnvironmentPanel } from '../EnvironmentPanel.tsx';
import { DangerZone } from './DangerZone.tsx';
import { GameSection } from './GameSection.tsx';

export function DataManagementPage({ status }: { readonly status: AppStatus | undefined }) {
  if (status === undefined) {
    return <p role="status">載入中…</p>;
  }
  const { currentGame } = status;
  return (
    <>
      <GameSection status={status} />
      <EnvironmentPanel />
      {currentGame !== undefined && <DangerZone currentGame={currentGame} />}
    </>
  );
}
