import { useState } from 'react';
import { Button } from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import {
  deleteAllData,
  deleteGame,
  previewDeleteAll,
  previewGameDeletion,
  type DeleteAllPreview,
  type GameDeletionPreview,
} from '../../services/games.ts';
import { ConfirmDialog, TypedNameDialog } from '../dialogs.tsx';
import { errorMessage, formatCount } from '../format.ts';
import { useServices } from '../ServicesContext.tsx';

type DeleteAllStep =
  | { readonly step: 'typeName'; readonly preview: DeleteAllPreview }
  | { readonly step: 'final'; readonly preview: DeleteAllPreview; readonly typedName: string };

export function DangerZone({ currentGame }: { readonly currentGame: Game }) {
  const { context, notifyChanged } = useServices();
  const [deletion, setDeletion] = useState<GameDeletionPreview>();
  const [deleteAll, setDeleteAll] = useState<DeleteAllStep>();
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      notifyChanged();
    }
  };

  return (
    <section aria-labelledby="danger-heading" className="danger-zone">
      <h2 id="danger-heading">危險區</h2>
      <p>以下操作會永久刪除本機資料，無法復原。刪除前請先下載備份。</p>
      {error !== undefined && <p role="alert">{error}</p>}
      <div className="actions">
        <Button
          onPress={() => {
            void run(async () => {
              setDeletion(await previewGameDeletion(context, currentGame.id));
            });
          }}
        >
          永久刪除此局
        </Button>
        <Button
          onPress={() => {
            void run(async () => {
              setDeleteAll({ step: 'typeName', preview: await previewDeleteAll(context) });
            });
          }}
        >
          刪除全部存檔
        </Button>
      </div>

      {deletion !== undefined && (
        <TypedNameDialog
          title="永久刪除此局"
          expectedName={deletion.game.name}
          confirmLabel="永久刪除"
          description={
            <p>
              將刪除「{deletion.game.name}」的資料 {formatCount(deletion.recordCount)}、檢查點{' '}
              {deletion.checkpointCount} 個。
            </p>
          }
          onCancel={() => {
            setDeletion(undefined);
          }}
          onConfirm={(typedName) => {
            const gameId = deletion.game.id;
            setDeletion(undefined);
            void run(() => deleteGame(context, gameId, typedName));
          }}
        />
      )}

      {deleteAll?.step === 'typeName' && (
        <TypedNameDialog
          title="刪除全部存檔"
          expectedName={currentGame.name}
          confirmLabel="下一步"
          description={
            <p>
              將刪除全部 {deleteAll.preview.gameCount} 個遊戲局、資料{' '}
              {formatCount(deleteAll.preview.recordCount)}、檢查點{' '}
              {deleteAll.preview.checkpointCount} 個。
            </p>
          }
          onCancel={() => {
            setDeleteAll(undefined);
          }}
          onConfirm={(typedName) => {
            setDeleteAll({ step: 'final', preview: deleteAll.preview, typedName });
          }}
        />
      )}

      {deleteAll?.step === 'final' && (
        <ConfirmDialog
          title="再次確認刪除全部存檔"
          confirmLabel="刪除全部"
          isDestructive
          onCancel={() => {
            setDeleteAll(undefined);
          }}
          onConfirm={() => {
            const { typedName } = deleteAll;
            setDeleteAll(undefined);
            void run(() => deleteAllData(context, typedName));
          }}
        >
          <p>確定要刪除全部 {deleteAll.preview.gameCount} 個遊戲局？此操作無法復原。</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
