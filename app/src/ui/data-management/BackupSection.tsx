import { useState } from 'react';
import { Button, FileTrigger, Input, Label, TextField } from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import {
  exportBackup,
  previewBackupFile,
  restoreBackupAsNewGame,
  type BackupPreview,
  type BackupSummary,
} from '../../services/backup.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { downloadFile } from '../download.ts';
import { errorMessage, formatBytes, formatCount, formatDateTime } from '../format.ts';
import { useServices } from '../ServicesContext.tsx';

type AcceptedPreview = Extract<BackupPreview, { ok: true }>;

interface PendingRestore {
  readonly preview: AcceptedPreview;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

interface Problem {
  readonly title: string;
  readonly details: readonly string[];
}

function BackupSummaryList({
  summary,
  testId,
}: {
  readonly summary: BackupSummary;
  readonly testId: string;
}) {
  return (
    <dl data-testid={testId}>
      <div>
        <dt>檔名</dt>
        <dd>{summary.fileName}</dd>
      </div>
      <div>
        <dt>遊戲局</dt>
        <dd>{summary.gameName}</dd>
      </div>
      <div>
        <dt>筆數</dt>
        <dd>{formatCount(summary.recordCount)}</dd>
      </div>
      <div>
        <dt>大小</dt>
        <dd>{formatBytes(summary.sizeBytes)}</dd>
      </div>
      <div>
        <dt>版本</dt>
        <dd>
          程式 {summary.appVersion}・結構第 {summary.schemaVersion} 版
        </dd>
      </div>
      <div>
        <dt>時間</dt>
        <dd>{formatDateTime(summary.exportedAt)}</dd>
      </div>
      <div>
        <dt>格式</dt>
        <dd>{summary.compressed ? 'JSON.GZ' : 'JSON'}</dd>
      </div>
    </dl>
  );
}

export function BackupSection({ currentGame }: { readonly currentGame: Game | undefined }) {
  const { context, notifyChanged } = useServices();
  const [exported, setExported] = useState<BackupSummary>();
  const [pending, setPending] = useState<PendingRestore>();
  const [restoreName, setRestoreName] = useState('');
  const [message, setMessage] = useState<string>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const file = await exportBackup(context);
      downloadFile(file);
      setExported(file.summary);
      setProblem(undefined);
    } catch (caught) {
      setProblem({ title: '備份失敗', details: errorMessage(caught).split('\n') });
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  const inspect = async (file: File) => {
    setMessage('正在驗證備份檔…');
    setProblem(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const preview = await previewBackupFile(context, file.name, bytes);
      if (!preview.ok) {
        setProblem({
          title: `「${file.name}」無法使用，資料未變更`,
          details: preview.issues.map((item) => item.message),
        });
        return;
      }
      setRestoreName(preview.game.name);
      setPending({ preview, bytes });
    } catch (caught) {
      setProblem({
        title: `「${file.name}」無法讀取，資料未變更`,
        details: [errorMessage(caught)],
      });
    } finally {
      setMessage(undefined);
    }
  };

  const restore = async (target: PendingRestore) => {
    setPending(undefined);
    try {
      const game = await restoreBackupAsNewGame(context, {
        bytes: target.bytes,
        name: restoreName,
      });
      setMessage(`已還原為新遊戲局「${game.name}」`);
      setProblem(undefined);
    } catch (caught) {
      setProblem({ title: '還原失敗，資料未變更', details: errorMessage(caught).split('\n') });
    } finally {
      notifyChanged();
    }
  };

  return (
    <section aria-labelledby="backup-heading">
      <h2 id="backup-heading">備份與還原</h2>
      <p>備份檔為 JSON.GZ 或 JSON。還原一律建立新遊戲局，不會覆蓋現有資料。</p>
      <div className="actions">
        {currentGame !== undefined && (
          <Button
            isDisabled={busy}
            onPress={() => {
              void download();
            }}
          >
            下載備份
          </Button>
        )}
        <FileTrigger
          onSelect={(files) => {
            const file = files?.[0];
            if (file !== undefined) {
              void inspect(file);
            }
          }}
        >
          <Button>選擇備份檔</Button>
        </FileTrigger>
      </div>
      {exported !== undefined && (
        <div role="status">
          <h3>匯出完成</h3>
          <BackupSummaryList summary={exported} testId="export-summary" />
        </div>
      )}
      {message !== undefined && <p role="status">{message}</p>}
      {problem !== undefined && (
        <div role="alert">
          <p>{problem.title}</p>
          <ul>
            {problem.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        </div>
      )}
      {pending !== undefined && (
        <ConfirmDialog
          title="還原備份為新遊戲局"
          confirmLabel="還原為新遊戲局"
          isConfirmDisabled={restoreName.trim() === ''}
          onCancel={() => {
            setPending(undefined);
          }}
          onConfirm={() => {
            void restore(pending);
          }}
        >
          <BackupSummaryList summary={pending.preview.summary} testId="restore-summary" />
          {pending.preview.migrated && (
            <p>
              此備份是第 {pending.preview.sourceSchemaVersion}{' '}
              版結構，還原時會遷移到目前版本並留下紀錄。
            </p>
          )}
          <TextField value={restoreName} onChange={setRestoreName}>
            <Label>新遊戲局名稱</Label>
            <Input />
          </TextField>
        </ConfirmDialog>
      )}
    </section>
  );
}
