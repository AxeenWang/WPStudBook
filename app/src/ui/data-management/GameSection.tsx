import { useId, useRef, useState } from 'react';
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  NumberField,
  RadioButton,
  RadioField,
  RadioGroup,
} from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import type { AppStatus } from '../../services/app-status.ts';
import { fieldIssuesOf, type FieldIssues } from '../../services/errors.ts';
import {
  changeCurrentYear,
  createGame,
  inspectNewGameInput,
  previewYearChange,
  switchGame,
  type YearChangePreview,
} from '../../services/games.ts';
import { describedByError } from '../actions.tsx';
import { ConfirmDialog } from '../dialogs.tsx';
import { TextInputField, useFocusFirstInvalid } from '../fields.tsx';
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
  const [fields, setFields] = useState<FieldIssues>({});
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  useFocusFirstInvalid(formRef, fields);

  const requestPreview = async () => {
    try {
      setPreview(await previewYearChange(context, year));
      setError(undefined);
      setFields({});
    } catch (caught) {
      setError(errorMessage(caught));
      setFields(fieldIssuesOf(caught));
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
        ref={formRef}
        aria-labelledby="year-heading"
        {...describedByError(errorId, error)}
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
        <NumberField
          value={year}
          onChange={setYear}
          formatOptions={YEAR_FORMAT}
          isInvalid={fields.toYear !== undefined}
        >
          <Label>新的目前遊戲年</Label>
          <Input />
          <FieldError>{fields.toYear}</FieldError>
        </NumberField>
        {error !== undefined && (
          <p role="alert" id={errorId}>
            {error}
          </p>
        )}
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
  const [fields, setFields] = useState<FieldIssues>({});
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  useFocusFirstInvalid(formRef, fields);

  const submit = async () => {
    const issues = inspectNewGameInput({ name, startYear });
    if (!issues.isEmpty) {
      setError(issues.messages.join('；'));
      setFields(issues.fields);
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
      setFields({});
    } catch (caught) {
      setError(errorMessage(caught));
      setFields(fieldIssuesOf(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  return (
    <Form
      ref={formRef}
      aria-labelledby="create-game-heading"
      {...describedByError(errorId, error)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 id="create-game-heading">建立遊戲局</h3>
      <TextInputField label="遊戲局名稱" value={name} onChange={setName} error={fields.name} />
      <NumberField
        value={startYear}
        onChange={setStartYear}
        formatOptions={YEAR_FORMAT}
        isInvalid={fields.startYear !== undefined}
      >
        <Label>起始年</Label>
        <Input />
        <FieldError>{fields.startYear}</FieldError>
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
      {error !== undefined && (
        <p role="alert" id={errorId}>
          {error}
        </p>
      )}
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
