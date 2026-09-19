import { useId, useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { LinePosition } from '../../domain/line.ts';
import {
  checkUpdateLineSystems,
  updateLineSystems,
  type OpenLineWarning,
} from '../../services/lines.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { errorMessage } from '../format.ts';
import { useErrorLink } from '../actions.tsx';
import { useServices } from '../ServicesContext.tsx';

/**
 * 更新某系目前的子系統與親系統（需求規格 7.1、LINE-06）：位置、配種、代數與任務不變，
 * 歷程保存舊名與年份。親系統與既有系重複或與對照表不同時確認後才寫入（LINE-03、LINE-04）。
 */
export function LineSystemsForm({
  position,
  subsystem: currentSubsystem,
  parentSystem: currentParentSystem,
}: {
  readonly position: LinePosition;
  readonly subsystem: string;
  readonly parentSystem: string;
}) {
  const { context, notifyChanged } = useServices();
  const headingId = useId();
  const [subsystem, setSubsystem] = useState(currentSubsystem);
  const [parentSystem, setParentSystem] = useState(currentParentSystem);
  const [warnings, setWarnings] = useState<readonly OpenLineWarning[]>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const errorLink = useErrorLink(error);
  const [busy, setBusy] = useState(false);

  const save = async (acceptedWarnings: readonly OpenLineWarning['code'][] | undefined) => {
    setBusy(true);
    try {
      const line = await updateLineSystems(context, {
        position,
        subsystem,
        parentSystem,
        acceptedWarnings,
      });
      setMessage(`第 ${String(position)} 系已更新為「${line.subsystem}」`);
      setError(undefined);
    } catch (caught) {
      setMessage(undefined);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  const submit = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const check = await checkUpdateLineSystems(context, { position, subsystem, parentSystem });
      if (check.issues.length > 0) {
        setMessage(undefined);
        setError(check.issues.join('；'));
        setBusy(false);
        return;
      }
      setError(undefined);
      if (check.warnings.length > 0) {
        setWarnings(check.warnings);
        setBusy(false);
        return;
      }
      await save(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <>
      <Form
        aria-labelledby={headingId}
        {...errorLink.formProps}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h4 id={headingId}>更新系統名稱</h4>
        <TextField value={subsystem} onChange={setSubsystem}>
          <Label>第 {position} 系目前子系統</Label>
          <Input />
        </TextField>
        <TextField value={parentSystem} onChange={setParentSystem}>
          <Label>第 {position} 系親系統</Label>
          <Input />
        </TextField>
        {message !== undefined && <p role="status">{message}</p>}
        {error !== undefined && (
          <p role="alert" id={errorLink.id}>
            {error}
          </p>
        )}
        <Button type="submit" isDisabled={busy}>
          更新第 {position} 系系統名稱
        </Button>
      </Form>
      {warnings !== undefined && (
        <ConfirmDialog
          title={`確認更新第 ${String(position)} 系系統名稱`}
          confirmLabel="確認並更新"
          onCancel={() => {
            setWarnings(undefined);
          }}
          onConfirm={() => {
            const accepted = warnings.map((warning) => warning.code);
            setWarnings(undefined);
            void save(accepted);
          }}
        >
          <ul>
            {warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </>
  );
}
