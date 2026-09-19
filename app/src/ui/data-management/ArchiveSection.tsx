import { useState } from 'react';
import {
  Button,
  FileTrigger,
  Input,
  Label,
  RadioButton,
  RadioField,
  RadioGroup,
  TextField,
} from 'react-aria-components';
import type { ArchiveEntry } from '../../domain/archive.ts';
import type { Game } from '../../domain/game.ts';
import type { AppStatus } from '../../services/app-status.ts';
import {
  completeArchive,
  listArchiveEntries,
  prepareArchive,
  previewArchiveRestore,
  removeArchiveEntry,
  restoreArchive,
  verifyArchiveFile,
  type ArchiveFile,
  type ArchiveRestorePreview,
  type ArchiveVerification,
  type ChosenFile,
} from '../../services/archives.ts';
import { ConfirmDialog, TypedNameDialog } from '../dialogs.tsx';
import { downloadFile } from '../download.ts';
import { errorMessage, formatBytes, formatCount, formatDateTime } from '../format.ts';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { BackupSummaryList } from './BackupSection.tsx';

interface Problem {
  readonly title: string;
  readonly details: readonly string[];
}

function problemFrom(title: string, caught: unknown): Problem {
  return { title, details: errorMessage(caught).split('\n') };
}

async function readChosenFile(file: File): Promise<ChosenFile> {
  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function shortDigest(sha256: string): string {
  return `${sha256.slice(0, 12)}…`;
}

function yearRange(startYear: number, endYear: number): string {
  return `${String(startYear)}～${String(endYear)} 年`;
}

function ProblemAlert({ problem }: { readonly problem: Problem }) {
  return (
    <div role="alert">
      <p>{problem.title}</p>
      {problem.details.length > 0 && (
        <ul>
          {problem.details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Prepared {
  readonly game: Game;
  readonly archive: ArchiveFile;
}

interface Verified {
  readonly verification: ArchiveVerification;
  readonly file: ChosenFile;
}

function ArchiveForm({
  games,
  currentGameId,
}: {
  readonly games: readonly Game[];
  readonly currentGameId: string | undefined;
}) {
  const { context, notifyChanged } = useServices();
  const [selectedId, setSelectedId] = useState<string>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [verified, setVerified] = useState<Verified>();
  const [message, setMessage] = useState<string>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);

  // 預設選擇目前遊戲局以外、最早建立的一局（封存的多半是舊局）；選到的局被移除後回到預設。
  const fallback = games.find((game) => game.id !== currentGameId) ?? games[0];
  const selected = games.find((game) => game.id === selectedId) ?? fallback;
  const activePrepared = prepared?.game.id === selected?.id ? prepared : undefined;

  const generate = async (game: Game) => {
    setBusy(true);
    setMessage(undefined);
    setProblem(undefined);
    try {
      const archive = await prepareArchive(context, game.id);
      downloadFile(archive);
      setPrepared({ game, archive });
    } catch (caught) {
      setPrepared(undefined);
      setProblem(problemFrom('無法產生封存檔，本機資料未變更', caught));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (target: Prepared, file: File) => {
    setBusy(true);
    setProblem(undefined);
    try {
      const chosen = await readChosenFile(file);
      const verification = await verifyArchiveFile(context, target.game.id, chosen);
      setVerified({ verification, file: chosen });
    } catch (caught) {
      setProblem(problemFrom('封存檔核對未通過，本機資料未變更', caught));
    } finally {
      setBusy(false);
    }
  };

  const complete = async (target: Verified, typedName: string) => {
    setVerified(undefined);
    setBusy(true);
    try {
      const entry = await completeArchive(context, {
        gameId: target.verification.game.id,
        file: target.file,
        typedName,
      });
      setPrepared(undefined);
      setSelectedId(undefined);
      setProblem(undefined);
      setMessage(`已封存「${entry.gameName}」：本機明細已移除，保留封存索引`);
    } catch (caught) {
      setProblem(problemFrom('封存未完成，本機資料未變更', caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  if (selected === undefined) {
    return null;
  }
  return (
    <>
      <RadioGroup
        value={selected.id}
        onChange={(value) => {
          setSelectedId(value);
          setMessage(undefined);
          setProblem(undefined);
        }}
      >
        <Label>要封存的遊戲局</Label>
        {games.map((game) => (
          <RadioField key={game.id} value={game.id}>
            <RadioButton>
              {`${game.name}（${yearRange(game.startYear, game.currentYear)}）${
                game.id === currentGameId ? '・使用中' : ''
              }`}
            </RadioButton>
          </RadioField>
        ))}
      </RadioGroup>
      <div className="actions">
        <Button
          isDisabled={busy}
          onPress={() => {
            void generate(selected);
          }}
        >
          產生並下載「{selected.name}」的封存檔
        </Button>
      </div>
      {activePrepared !== undefined && (
        <div data-testid="archive-prepared">
          <h3>封存檔已下載</h3>
          <BackupSummaryList summary={activePrepared.archive.summary} testId="archive-summary" />
          <p>
            確認封存檔已存到安全的位置後，選擇剛下載的封存檔核對。核對通過並輸入局名後，才會移除「
            {activePrepared.game.name}」的本機明細；在那之前資料都不會變更。
          </p>
          <div className="actions">
            <FileTrigger
              onSelect={(files) => {
                const file = files?.[0];
                if (file !== undefined) {
                  void verify(activePrepared, file);
                }
              }}
            >
              <Button isDisabled={busy}>選擇下載的封存檔核對</Button>
            </FileTrigger>
            <Button
              isDisabled={busy}
              onPress={() => {
                downloadFile(activePrepared.archive);
              }}
            >
              再次下載封存檔
            </Button>
          </div>
        </div>
      )}
      {message !== undefined && <p role="status">{message}</p>}
      {problem !== undefined && <ProblemAlert problem={problem} />}
      {verified !== undefined && (
        <TypedNameDialog
          title="移除本機明細"
          expectedName={verified.verification.game.name}
          confirmLabel="移除本機明細"
          description={
            <>
              <p>
                封存檔「{verified.file.fileName}」核對通過（驗證摘要{' '}
                {shortDigest(verified.verification.sha256)}）。
              </p>
              <p>
                將移除「{verified.verification.game.name}」的資料{' '}
                {formatCount(verified.verification.recordCount)}、檢查點{' '}
                {verified.verification.checkpointCount} 個，只保留封存索引。檢查點不收錄在封存檔中。
              </p>
            </>
          }
          onCancel={() => {
            setVerified(undefined);
          }}
          onConfirm={(typedName) => {
            void complete(verified, typedName);
          }}
        />
      )}
    </>
  );
}

interface PendingRestore {
  readonly preview: ArchiveRestorePreview;
  readonly file: ChosenFile;
}

function ArchiveIndex() {
  const { context, notifyChanged } = useServices();
  const { data: entries, error } = useServiceQuery(listArchiveEntries);
  const [pending, setPending] = useState<PendingRestore>();
  const [restoreName, setRestoreName] = useState('');
  const [removing, setRemoving] = useState<ArchiveEntry>();
  const [message, setMessage] = useState<string>();
  const [problem, setProblem] = useState<Problem>();

  const inspect = async (entry: ArchiveEntry, file: File) => {
    setMessage(undefined);
    setProblem(undefined);
    try {
      const chosen = await readChosenFile(file);
      const preview = await previewArchiveRestore(context, entry.id, chosen);
      setRestoreName(entry.gameName);
      setPending({ preview, file: chosen });
    } catch (caught) {
      setProblem(problemFrom('無法從這個檔案還原，資料未變更', caught));
    }
  };

  const restore = async (target: PendingRestore) => {
    setPending(undefined);
    try {
      const game = await restoreArchive(context, {
        archiveId: target.preview.entry.id,
        file: target.file,
        name: restoreName,
      });
      setProblem(undefined);
      setMessage(`已從封存檔還原為新遊戲局「${game.name}」`);
    } catch (caught) {
      setProblem(problemFrom('還原失敗，資料未變更', caught));
    } finally {
      notifyChanged();
    }
  };

  const remove = async (entry: ArchiveEntry) => {
    setRemoving(undefined);
    try {
      await removeArchiveEntry(context, entry.id);
      setProblem(undefined);
      setMessage(`已移除「${entry.gameName}」的封存索引`);
    } catch (caught) {
      setProblem(problemFrom('無法移除封存索引', caught));
    } finally {
      notifyChanged();
    }
  };

  return (
    <>
      <h3 id="archive-index-heading">封存索引</h3>
      {error !== undefined && <p role="alert">{error}</p>}
      {entries !== undefined && entries.length === 0 && <p>還沒有封存的遊戲局。</p>}
      {entries !== undefined && entries.length > 0 && (
        <div className="table-scroll">
          <table aria-labelledby="archive-index-heading">
            <thead>
              <tr>
                <th scope="col">名稱</th>
                <th scope="col">年份範圍</th>
                <th scope="col">版本</th>
                <th scope="col">封存時間</th>
                <th scope="col">檔名</th>
                <th scope="col">筆數</th>
                <th scope="col">驗證摘要</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row">{entry.gameName}</th>
                  <td>{yearRange(entry.startYear, entry.endYear)}</td>
                  <td>
                    程式 {entry.appVersion}・結構第 {entry.schemaVersion} 版
                  </td>
                  <td>{formatDateTime(entry.archivedAt)}</td>
                  <td>
                    {entry.fileName}（{formatBytes(entry.sizeBytes)}）
                  </td>
                  <td>{formatCount(entry.recordCount)}</td>
                  <td>
                    <code title={entry.sha256}>{shortDigest(entry.sha256)}</code>
                  </td>
                  <td>
                    <div className="actions">
                      <FileTrigger
                        onSelect={(files) => {
                          const file = files?.[0];
                          if (file !== undefined) {
                            void inspect(entry, file);
                          }
                        }}
                      >
                        <Button>從封存檔還原「{entry.gameName}」</Button>
                      </FileTrigger>
                      <Button
                        onPress={() => {
                          setRemoving(entry);
                        }}
                      >
                        移除「{entry.gameName}」的索引
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message !== undefined && <p role="status">{message}</p>}
      {problem !== undefined && <ProblemAlert problem={problem} />}
      {pending !== undefined && (
        <ConfirmDialog
          title="從封存檔還原為新遊戲局"
          confirmLabel="還原為新遊戲局"
          isConfirmDisabled={restoreName.trim() === ''}
          onCancel={() => {
            setPending(undefined);
          }}
          onConfirm={() => {
            void restore(pending);
          }}
        >
          <p>
            封存檔核對通過，是「{pending.preview.entry.gameName}」的封存檔。還原會建立新的遊戲局，
            封存索引保留。
          </p>
          <BackupSummaryList summary={pending.preview.summary} testId="archive-restore-summary" />
          {pending.preview.migrated && (
            <p>
              此封存檔是第 {pending.preview.sourceSchemaVersion}{' '}
              版結構，還原時會遷移到目前版本並留下紀錄。
            </p>
          )}
          <TextField value={restoreName} onChange={setRestoreName}>
            <Label>新遊戲局名稱</Label>
            <Input />
          </TextField>
        </ConfirmDialog>
      )}
      {removing !== undefined && (
        <ConfirmDialog
          title="移除封存索引"
          confirmLabel="移除索引"
          isDestructive
          onCancel={() => {
            setRemoving(undefined);
          }}
          onConfirm={() => {
            void remove(removing);
          }}
        >
          <p>
            只移除「{removing.gameName}」的封存索引。封存檔「{removing.fileName}
            」不在瀏覽器內，不受影響；之後仍可在「備份與還原」選擇它還原為新遊戲局。
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

export function ArchiveSection({ status }: { readonly status: AppStatus }) {
  return (
    <section aria-labelledby="archive-heading">
      <h2 id="archive-heading">封存</h2>
      <p>
        封存把一局的完整資料存成 .json.gz 封存檔。選回下載的封存檔核對無誤、輸入局名後，
        才移除這一局的本機明細（含檢查點），只保留輕量索引；之後可從封存檔還原為獨立的遊戲局。
      </p>
      {status.games.length > 0 && (
        <ArchiveForm games={status.games} currentGameId={status.currentGame?.id} />
      )}
      <ArchiveIndex />
    </section>
  );
}
