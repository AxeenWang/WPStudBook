import { useId, useRef, useState } from 'react';
import { Button, Form } from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import type { SystemMapEntry } from '../../domain/system-map.ts';
import {
  deleteSystemMapEntry,
  listSystemMap,
  listSystemMapHistory,
  saveSystemMapEntry,
  type SystemMapChange,
} from '../../services/system-map.ts';
import { fieldIssuesOf, type FieldIssues } from '../../services/errors.ts';
import { describedByError } from '../actions.tsx';
import { ConfirmDialog } from '../dialogs.tsx';
import { TextInputField, useFocusFirstInvalid } from '../fields.tsx';
import { errorMessage, formatDateTime } from '../format.ts';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';

function describeChange({ before, after }: SystemMapChange): string {
  if (before !== undefined && after !== undefined) {
    return `「${after.subsystem}」的親系統：「${before.parentSystem}」→「${after.parentSystem}」`;
  }
  if (after !== undefined) {
    return `新增「${after.subsystem}」→「${after.parentSystem}」`;
  }
  if (before !== undefined) {
    return `刪除「${before.subsystem}」→「${before.parentSystem}」`;
  }
  return '—';
}

function SystemMapView() {
  const { context, notifyChanged } = useServices();
  const { data: entries, error: loadError } = useServiceQuery(listSystemMap);
  const { data: history } = useServiceQuery(listSystemMapHistory);
  const [subsystem, setSubsystem] = useState('');
  const [parentSystem, setParentSystem] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SystemMapEntry>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<FieldIssues>({});
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  useFocusFirstInvalid(formRef, fields);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      setMessage(await action());
      setError(undefined);
      setFields({});
    } catch (caught) {
      setMessage(undefined);
      setError(errorMessage(caught));
      setFields(fieldIssuesOf(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  const save = () =>
    run(async () => {
      const entry = await saveSystemMapEntry(context, { subsystem, parentSystem });
      setSubsystem('');
      setParentSystem('');
      return `已保存「${entry.subsystem}」→「${entry.parentSystem}」`;
    });

  const remove = (entry: SystemMapEntry) =>
    run(async () => {
      await deleteSystemMapEntry(context, entry.id);
      return `已刪除「${entry.subsystem}」的對照`;
    });

  const shownError = error ?? loadError;

  return (
    <section aria-labelledby="system-map-heading">
      <h2 id="system-map-heading">系統對照表</h2>
      <p>
        記錄子系統所屬的親系統。子系統升格時，輸入同一個子系統與新的親系統即可更新，變更保存在歷程。
      </p>
      <Form
        ref={formRef}
        aria-labelledby="system-map-form-heading"
        {...describedByError(errorId, error)}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3 id="system-map-form-heading">新增或更新對照</h3>
        <TextInputField
          label="子系統"
          value={subsystem}
          onChange={setSubsystem}
          error={fields.subsystem}
        />
        <TextInputField
          label="親系統"
          value={parentSystem}
          onChange={setParentSystem}
          error={fields.parentSystem}
        />
        <Button type="submit" isDisabled={busy}>
          保存對照
        </Button>
      </Form>
      {message !== undefined && <p role="status">{message}</p>}
      {shownError !== undefined && (
        <p role="alert" id={errorId}>
          {shownError}
        </p>
      )}
      {entries?.length === 0 && <p>尚無對照。</p>}
      {entries !== undefined && entries.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption>系統對照表</caption>
            <thead>
              <tr>
                <th scope="col">子系統</th>
                <th scope="col">親系統</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row">{entry.subsystem}</th>
                  <td>{entry.parentSystem}</td>
                  <td>
                    <Button
                      isDisabled={busy}
                      onPress={() => {
                        setPendingDelete(entry);
                      }}
                    >
                      刪除「{entry.subsystem}」
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history !== undefined && history.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption>對照表變更歷程（新到舊）</caption>
            <thead>
              <tr>
                <th scope="col">遊戲年</th>
                <th scope="col">變更</th>
                <th scope="col">時間</th>
              </tr>
            </thead>
            <tbody>
              {history.map((change) => (
                <tr key={change.id}>
                  <td>{change.gameYear} 年</td>
                  <td>{describeChange(change)}</td>
                  <td>{formatDateTime(change.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pendingDelete !== undefined && (
        <ConfirmDialog
          title="刪除對照"
          confirmLabel="刪除"
          onCancel={() => {
            setPendingDelete(undefined);
          }}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(undefined);
            void remove(target);
          }}
        >
          <p>
            確定刪除「{pendingDelete.subsystem}」→「{pendingDelete.parentSystem}
            」？刪除會記錄在歷程。
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

export function SystemMapPage({ currentGame }: { readonly currentGame: Game | undefined }) {
  return currentGame === undefined ? <NoGameNotice /> : <SystemMapView key={currentGame.id} />;
}
