import { useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { Checkpoint } from '../../domain/checkpoint.ts';
import {
  createCheckpoint,
  listGameCheckpoints,
  previewRollback,
  rollbackToCheckpoint,
  setCheckpointPinned,
  type RollbackPreview,
} from '../../services/checkpoints.ts';
import { COLLECTION_LABELS } from '../collection-labels.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { downloadFile } from '../download.ts';
import { errorMessage, formatBytes, formatDateTime } from '../format.ts';
import { useErrorLink } from '../actions.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';

function checkpointLabel(checkpoint: Checkpoint): string {
  return checkpoint.note ?? formatDateTime(checkpoint.createdAt);
}

function changedCounts(preview: RollbackPreview) {
  const names = new Set([
    ...Object.keys(preview.currentCounts),
    ...Object.keys(preview.checkpoint.counts),
  ]);
  return [...names]
    .map((name) => ({
      name,
      current: preview.currentCounts[name] ?? 0,
      target: preview.checkpoint.counts[name] ?? 0,
    }))
    .filter((row) => row.current !== row.target);
}

function RollbackDialog({
  preview,
  onConfirm,
  onCancel,
}: {
  readonly preview: RollbackPreview;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const rows = changedCounts(preview);
  return (
    <ConfirmDialog
      title="回溯到檢查點"
      confirmLabel="下載備份並回溯"
      isDestructive
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        「{preview.gameName}」將回溯到「{checkpointLabel(preview.checkpoint)}」：目前遊戲年{' '}
        {`${String(preview.currentYear)} 年 → ${String(preview.targetYear)} 年`}。
      </p>
      <p>確認後會先自動下載目前資料的備份，再驗證檢查點；驗證失敗時停止回溯，資料不變。</p>
      <h3>將捨棄的資料</h3>
      {rows.length === 0 ? (
        <p>各資料表筆數相同；檢查點之後的修改仍會被捨棄。</p>
      ) : (
        <table>
          <caption>筆數變化</caption>
          <thead>
            <tr>
              <th scope="col">資料表</th>
              <th scope="col">目前</th>
              <th scope="col">回溯後</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{COLLECTION_LABELS[row.name] ?? row.name}</th>
                <td>{row.current}</td>
                <td>{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview.laterCheckpoints.length > 0 && (
        <>
          <h3>將移除的較晚檢查點</h3>
          <ul>
            {preview.laterCheckpoints.map((item) => (
              <li key={item.id}>{`${String(item.gameYear)} 年・${checkpointLabel(item)}`}</li>
            ))}
          </ul>
        </>
      )}
    </ConfirmDialog>
  );
}

export function CheckpointSection() {
  const { context, notifyChanged } = useServices();
  const { data: checkpoints, error: loadError } = useServiceQuery(listGameCheckpoints);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<RollbackPreview>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<string | undefined>) => {
    setBusy(true);
    try {
      setMessage(await action());
      setError(undefined);
    } catch (caught) {
      setMessage(undefined);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  const create = () =>
    run(async () => {
      const { prunedIds } = await createCheckpoint(context, { note });
      setNote('');
      return prunedIds.length > 0
        ? `已建立檢查點，並依保留數清除 ${String(prunedIds.length)} 個舊檢查點`
        : '已建立檢查點';
    });

  const togglePinned = (checkpoint: Checkpoint) =>
    run(async () => {
      await setCheckpointPinned(context, checkpoint.id, !checkpoint.pinned);
      return undefined;
    });

  const openPreview = async (checkpoint: Checkpoint) => {
    try {
      setPreview(await previewRollback(context, checkpoint.id));
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const rollback = (target: RollbackPreview) =>
    run(async () => {
      const result = await rollbackToCheckpoint(context, target.checkpoint.id, {
        deliverBackup: (file) => {
          downloadFile(file);
          return Promise.resolve();
        },
      });
      return `已回溯到 ${String(result.game.currentYear)} 年的檢查點，回溯前的資料已下載為備份`;
    });

  const shownError = error ?? loadError;
  const errorLink = useErrorLink(error);

  return (
    <section aria-labelledby="checkpoint-heading">
      <h2 id="checkpoint-heading">檢查點</h2>
      <p>檢查點是遊戲局某個時點的完整快照，可以回溯；超過保留數時自動清除最舊且未釘選的檢查點。</p>
      <Form
        aria-labelledby="checkpoint-create-heading"
        {...errorLink.formProps}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h3 id="checkpoint-create-heading">建立檢查點</h3>
        <TextField value={note} onChange={setNote}>
          <Label>檢查點註記（選填，例如遊戲存檔名稱）</Label>
          <Input />
        </TextField>
        <Button type="submit" isDisabled={busy}>
          建立檢查點
        </Button>
      </Form>
      {message !== undefined && <p role="status">{message}</p>}
      {shownError !== undefined && (
        <p role="alert" id={errorLink.id}>
          {shownError}
        </p>
      )}
      {checkpoints?.length === 0 && <p>尚無檢查點。</p>}
      {checkpoints !== undefined && checkpoints.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption>檢查點列表（新到舊）</caption>
            <thead>
              <tr>
                <th scope="col">遊戲年</th>
                <th scope="col">建立時間</th>
                <th scope="col">註記</th>
                <th scope="col">大小</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((checkpoint) => (
                <tr key={checkpoint.id}>
                  <td>{checkpoint.gameYear} 年</td>
                  <td>{formatDateTime(checkpoint.createdAt)}</td>
                  <td>
                    {checkpoint.note ?? '—'}
                    {checkpoint.pinned && '（已釘選）'}
                  </td>
                  <td>{formatBytes(checkpoint.sizeBytes)}</td>
                  <td className="actions">
                    <Button
                      isDisabled={busy}
                      onPress={() => {
                        void togglePinned(checkpoint);
                      }}
                    >
                      {checkpoint.pinned ? '取消釘選' : '釘選'}
                    </Button>
                    <Button
                      isDisabled={busy}
                      onPress={() => {
                        void openPreview(checkpoint);
                      }}
                    >
                      回溯到此
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview !== undefined && (
        <RollbackDialog
          preview={preview}
          onCancel={() => {
            setPreview(undefined);
          }}
          onConfirm={() => {
            setPreview(undefined);
            void rollback(preview);
          }}
        />
      )}
    </section>
  );
}
