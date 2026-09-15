import { useState } from 'react';
import { Button, Form } from 'react-aria-components';
import {
  loadReminderSettings,
  updateReminderSettings,
  type ReminderSettings,
} from '../../services/settings.ts';
import { OptionalIntegerField } from '../fields.tsx';
import { errorMessage } from '../format.ts';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';

function ReminderForm({ initial }: { readonly initial: ReminderSettings }) {
  const { context, notifyChanged } = useServices();
  const [highAgeReminderAge, setHighAgeReminderAge] = useState<number | undefined>(
    initial.highAgeReminderAge,
  );
  const [vitalityThreshold, setVitalityThreshold] = useState(initial.vitalityThreshold);
  // 載入的設定改變時（例如回溯檢查點）重新帶入欄位，避免之後保存時把舊值寫回。
  const [synced, setSynced] = useState(initial);
  if (
    synced.highAgeReminderAge !== initial.highAgeReminderAge ||
    synced.vitalityThreshold !== initial.vitalityThreshold
  ) {
    setSynced(initial);
    setHighAgeReminderAge(initial.highAgeReminderAge);
    setVitalityThreshold(initial.vitalityThreshold);
  }
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await updateReminderSettings(context, { highAgeReminderAge, vitalityThreshold });
      setMessage('已保存設定');
      setError(undefined);
    } catch (caught) {
      setMessage(undefined);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };

  return (
    <Form
      aria-labelledby="reminder-form-heading"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3 id="reminder-form-heading">繁殖牝馬提醒</h3>
      <p>提醒設定只影響提示與排序，不會阻止任何操作。</p>
      <OptionalIntegerField
        label="高齡提醒年齡"
        value={highAgeReminderAge}
        onChange={setHighAgeReminderAge}
      />
      <OptionalIntegerField
        label="活力建議門檻（留空＝不使用）"
        value={vitalityThreshold}
        onChange={setVitalityThreshold}
      />
      {message !== undefined && <p role="status">{message}</p>}
      {error !== undefined && <p role="alert">{error}</p>}
      <Button type="submit" isDisabled={busy}>
        保存設定
      </Button>
    </Form>
  );
}

export function SettingsSection() {
  const { data, error } = useServiceQuery(loadReminderSettings);
  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading">遊戲局設定</h2>
      {data === undefined ? (
        error === undefined ? (
          <p role="status">載入中…</p>
        ) : (
          <p role="alert">{error}</p>
        )
      ) : (
        <ReminderForm initial={data} />
      )}
    </section>
  );
}
