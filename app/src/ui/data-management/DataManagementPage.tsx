import type { AppStatus } from '../../services/app-status.ts';
import { EnvironmentPanel } from '../EnvironmentPanel.tsx';
import { ArchiveSection } from './ArchiveSection.tsx';
import { BackupSection } from './BackupSection.tsx';
import { CheckpointSection } from './CheckpointSection.tsx';
import { DangerZone } from './DangerZone.tsx';
import { GameSection } from './GameSection.tsx';
import { SettingsSection } from './SettingsSection.tsx';

export function DataManagementPage({ status }: { readonly status: AppStatus | undefined }) {
  if (status === undefined) {
    return <p role="status">載入中…</p>;
  }
  const { currentGame } = status;
  return (
    <div className="page-grid">
      <GameSection status={status} />
      {currentGame !== undefined && <SettingsSection key={currentGame.id} />}
      <BackupSection currentGame={currentGame} />
      <ArchiveSection status={status} />
      {currentGame !== undefined && <CheckpointSection key={currentGame.id} />}
      <EnvironmentPanel />
      {currentGame !== undefined && <DangerZone currentGame={currentGame} />}
    </div>
  );
}
