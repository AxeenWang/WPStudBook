import type { AppStatus } from '../../services/app-status.ts';
import { EnvironmentPanel } from '../EnvironmentPanel.tsx';
import { BackupSection } from './BackupSection.tsx';
import { CheckpointSection } from './CheckpointSection.tsx';
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
      <BackupSection currentGame={currentGame} />
      {currentGame !== undefined && <CheckpointSection key={currentGame.id} />}
      <EnvironmentPanel />
      {currentGame !== undefined && <DangerZone currentGame={currentGame} />}
    </>
  );
}
