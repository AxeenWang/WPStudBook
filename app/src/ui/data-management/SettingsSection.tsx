import { useState } from 'react';
import { Button, Form } from 'react-aria-components';
import {
  loadGameRuleSettings,
  updateGameRuleSettings,
  type GameRuleSettings,
} from '../../services/settings.ts';
import { OptionalIntegerField } from '../fields.tsx';
import { errorMessage } from '../format.ts';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';

function GameRuleForm({ initial }: { readonly initial: GameRuleSettings }) {
  const { context, notifyChanged } = useServices();
  const [retirementAge, setRetirementAge] = useState<number | undefined>(initial.retirementAge);
  const [highAgeReminderAge, setHighAgeReminderAge] = useState<number | undefined>(
    initial.highAgeReminderAge,
  );
  const [stallionAgeReminderAge, setStallionAgeReminderAge] = useState<number | undefined>(
    initial.stallionAgeReminderAge,
  );
  const [vitalityThreshold, setVitalityThreshold] = useState(initial.vitalityThreshold);
  // 載入的設定改變時（例如回溯檢查點）重新帶入欄位，避免之後保存時把舊值寫回。
  const [synced, setSynced] = useState(initial);
  if (
    synced.retirementAge !== initial.retirementAge ||
    synced.highAgeReminderAge !== initial.highAgeReminderAge ||
    synced.stallionAgeReminderAge !== initial.stallionAgeReminderAge ||
    synced.vitalityThreshold !== initial.vitalityThreshold
  ) {
    setSynced(initial);
    setRetirementAge(initial.retirementAge);
    setHighAgeReminderAge(initial.highAgeReminderAge);
    setStallionAgeReminderAge(initial.stallionAgeReminderAge);
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
      await updateGameRuleSettings(context, {
        retirementAge,
        highAgeReminderAge,
        stallionAgeReminderAge,
        vitalityThreshold,
      });
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
      <h3 id="reminder-form-heading">遊戲局設定</h3>
      <p>
        定年會改變判斷：達定年的母馬不列入任務，五月匯入時缺席的母馬也依定年決定預設處置。
        其餘三項只影響提示與排序，不會阻止任何操作。
      </p>
      <OptionalIntegerField label="定年" value={retirementAge} onChange={setRetirementAge} />
      <OptionalIntegerField
        label="高齡提醒年齡"
        value={highAgeReminderAge}
        onChange={setHighAgeReminderAge}
      />
      <OptionalIntegerField
        label="種牡馬提醒年齡"
        value={stallionAgeReminderAge}
        onChange={setStallionAgeReminderAge}
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
  const { data, error } = useServiceQuery(loadGameRuleSettings);
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
        <GameRuleForm initial={data} />
      )}
    </section>
  );
}
