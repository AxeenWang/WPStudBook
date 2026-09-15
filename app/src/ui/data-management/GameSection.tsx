import { useState } from 'react';
import {
  Button,
  Form,
  Input,
  Label,
  NumberField,
  RadioButton,
  RadioField,
  RadioGroup,
  TextField,
} from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import type { AppStatus } from '../../services/app-status.ts';
import {
  changeCurrentYear,
  checkNewGameInput,
  createGame,
  previewYearChange,
  switchGame,
  type YearChangePreview,
} from '../../services/games.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { errorMessage, formatDateTime } from '../format.ts';
import { useServices } from '../ServicesContext.tsx';

const YEAR_FORMAT = { useGrouping: false, maximumFractionDigits: 0 } as const;

function GameList({
  games,
  currentGameId,
}: {
  readonly games: readonly Game[];
  readonly currentGameId: string | undefined;
}) {
  const { context, notifyChanged } = useServices();
  const [error, setError] = useState<string>();

  const switchTo = async (gameId: string) => {
    try {
      await switchGame(context, gameId);
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      notifyChanged();
    }
  };

  return (
    <>
      <div className="table-scroll">
        <table>
          <caption>遊戲局列表</caption>
          <thead>
            <tr>
              <th scope="col">名稱</th>
              <th scope="col">起始年</th>
              <th scope="col">目前遊戲年</th>
              <th scope="col">建立時間</th>
              <th scope="col">狀態</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.id}>
                <th scope="row">{game.name}</th>
                <td>{game.startYear} 年</td>
                <td>{game.currentYear} 年</td>
                <td>{formatDateTime(game.createdAt)}</td>
                <td>
                  {game.id === currentGameId ? (
                    '使用中'
                  ) : (
                    <Button
                      onPress={() => {
                        void switchTo(game.id);
                      }}
                    >
                      切換到「{game.name}」
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
    </>
  );
}

function YearChangeForm({ currentGame }: { readonly currentGame: Game }) {
  const { context, notifyChanged } = useServices();
  const [year, setYear] = useState(currentGame.currentYear + 1);
  const [preview, setPreview] = useState<YearChangePreview>();
  const [error, setError] = useState<string>();

  const requestPreview = async () => {
    try {
      setPreview(await previewYearChange(context, year));
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const confirm = async () => {
    setPreview(undefined);
    try {
      await changeCurrentYear(context, year);
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      notifyChanged();
    }
  };

  return (
    <>
      <Form
        aria-labelledby="year-heading"
        onSubmit={(event) => {
          event.preventDefault();
          void requestPreview();
        }}
      >
        <h3 id="year-heading">目前遊戲年</h3>
        <p>
          「{currentGame.name}」目前是 {currentGame.currentYear}{' '}
          年。遊戲年只由你更新，不會依電腦日期改變。
        </p>
        <NumberField value={year} onChange={setYear} formatOptions={YEAR_FORMAT}>
          <Label>新的目前遊戲年</Label>
          <Input />
        </NumberField>
        {error !== undefined && <p role="alert">{error}</p>}
        <Button type="submit">更新遊戲年</Button>
      </Form>
      {preview !== undefined && (
        <ConfirmDialog
          title="確認更新目前遊戲年"
          confirmLabel="確認更新"
          onConfirm={() => {
            void confirm();
          }}
          onCancel={() => {
            setPreview(undefined);
          }}
        >
          <p>
            「{preview.gameName}」的目前遊戲年將從 {preview.fromYear} 年改為 {preview.toYear} 年。
          </p>
          {preview.toYear < preview.fromYear && (
            <p>
              改回較早的年份不會移除已建立的檢查點
              {preview.checkpointsAfterTarget > 0 &&
                `（有 ${String(preview.checkpointsAfterTarget)} 個檢查點晚於 ${String(preview.toYear)} 年）`}
              ；要讓資料回到過去，請使用檢查點回溯。
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function CreateGameForm({ currentGame }: { readonly currentGame: Game | undefined }) {
  const { context, notifyChanged } = useServices();
  const [name, setName] = useState('');
  const [startYear, setStartYear] = useState(1968);
  const [copyMode, setCopyMode] = useState<'blank' | 'copy'>('blank');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const issues = checkNewGameInput({ name, startYear });
    if (issues.length > 0) {
      setError(issues.join('；'));
      return;
    }
    setBusy(true);
    try {
      await createGame(context, {
        name,
        startYear,
        copySettingsFromGameId: copyMode === 'copy' ? currentGame?.id : undefined,
      });
      setName('');
      setCopyMode('blank');
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  return (
    <Form
      aria-labelledby="create-game-heading"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 id="create-game-heading">建立遊戲局</h3>
      <TextField value={name} onChange={setName}>
        <Label>遊戲局名稱</Label>
        <Input />
      </TextField>
      <NumberField value={startYear} onChange={setStartYear} formatOptions={YEAR_FORMAT}>
        <Label>起始年</Label>
        <Input />
      </NumberField>
      {currentGame !== undefined && (
        <RadioGroup
          value={copyMode}
          onChange={(value) => {
            setCopyMode(value === 'copy' ? 'copy' : 'blank');
          }}
        >
          <Label>新局內容</Label>
          <RadioField value="blank">
            <RadioButton>全新空白</RadioButton>
          </RadioField>
          <RadioField value="copy">
            <RadioButton>{`只複製「${currentGame.name}」的系統對照表與顯示設定`}</RadioButton>
          </RadioField>
        </RadioGroup>
      )}
      {error !== undefined && <p role="alert">{error}</p>}
      <Button type="submit" isDisabled={busy}>
        建立遊戲局
      </Button>
    </Form>
  );
}

export function GameSection({ status }: { readonly status: AppStatus }) {
  const { currentGame } = status;
  return (
    <section aria-labelledby="games-heading">
      <h2 id="games-heading">遊戲局</h2>
      {status.games.length === 0 ? (
        <p>還沒有遊戲局，請先建立一局。</p>
      ) : (
        <GameList games={status.games} currentGameId={currentGame?.id} />
      )}
      {currentGame !== undefined && (
        <YearChangeForm
          key={`${currentGame.id}-${String(currentGame.currentYear)}`}
          currentGame={currentGame}
        />
      )}
      <CreateGameForm currentGame={currentGame} />
    </section>
  );
}
