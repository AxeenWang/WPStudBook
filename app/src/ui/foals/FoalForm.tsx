import { useId, useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { Disposition } from '../../domain/foal.ts';
import type { Sex } from '../../domain/horse.ts';
import {
  DISPOSITION_OPTIONS,
  checkRegisterFoal,
  registerFoal,
  type FoalDetailsInput,
  type FoalInput,
  type FoalWarning,
  type RegisteredFoal,
} from '../../services/foals.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { OptionalIntegerField, SelectField } from '../fields.tsx';
import { errorMessage } from '../format.ts';
import { useServices } from '../ServicesContext.tsx';
import { EMPTY_FOAL_DETAILS, FoalDetailsFields } from './FoalDetailsFields.tsx';
import { DISPOSITION_LABELS, SEX_LABELS } from './labels.ts';

const SEX_CHOICES = (['male', 'female'] as const).map((sex) => ({
  value: sex,
  label: SEX_LABELS[sex],
}));
const DISPOSITION_CHOICES = DISPOSITION_OPTIONS.map((disposition) => ({
  value: disposition,
  label: DISPOSITION_LABELS[disposition],
}));

interface FoalFormProps {
  readonly damId: string;
  readonly birthYear: number | undefined;
  readonly onRegistered: (registered: RegisteredFoal) => void;
  readonly onCancel: () => void;
}

/**
 * 登記產駒（需求規格 9.3、BRD-01）：父馬、是否自由配種與系與代數由前一年的受胎紀錄決定；
 * 沒有相符受胎紀錄時確認後比照自由配種產駒。
 */
export function FoalForm(props: FoalFormProps) {
  const { context, notifyChanged } = useServices();
  const [birthYear, setBirthYear] = useState(props.birthYear);
  const [sex, setSex] = useState<Sex>();
  const [sireName, setSireName] = useState('');
  const [disposition, setDisposition] = useState<Disposition>();
  const [details, setDetails] = useState<FoalDetailsInput>(EMPTY_FOAL_DETAILS);
  const [warnings, setWarnings] = useState<readonly FoalWarning[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const headingId = useId();

  const input = (): FoalInput => ({
    damId: props.damId,
    birthYear,
    sex,
    sireName,
    disposition,
    ...details,
  });

  const register = async (acceptedWarnings: FoalInput['acceptedWarnings']) => {
    setBusy(true);
    try {
      const registered = await registerFoal(context, { ...input(), acceptedWarnings });
      setError(undefined);
      props.onRegistered(registered);
    } catch (caught) {
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
      const check = await checkRegisterFoal(context, input());
      setBusy(false);
      if (check.issues.length > 0) {
        setError(check.issues.join('；'));
        return;
      }
      setError(undefined);
      if (check.warnings.length > 0) {
        setWarnings(check.warnings);
        return;
      }
      await register(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <>
      <Form
        aria-labelledby={headingId}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h4 id={headingId}>登記產駒</h4>
        <p>
          前一年受胎紀錄相符時，父馬與系、代數由紀錄帶入；自由配種產駒只能待售或已售出。
          未命名的產駒顯示追蹤名。
        </p>
        <OptionalIntegerField label="出生年" value={birthYear} onChange={setBirthYear} />
        <SelectField
          label="性別"
          value={sex}
          options={SEX_CHOICES}
          emptyLabel="請選擇"
          onChange={setSex}
        />
        <TextField value={sireName} onChange={setSireName}>
          <Label>父馬名（沒有受胎紀錄時填寫，選填）</Label>
          <Input />
        </TextField>
        <SelectField
          label="牧場處置"
          value={disposition}
          options={DISPOSITION_CHOICES}
          emptyLabel="自動（自由配種待售，其他保留）"
          onChange={setDisposition}
        />
        <FoalDetailsFields value={details} onChange={setDetails} />
        {error !== undefined && <p role="alert">{error}</p>}
        <div className="actions">
          <Button type="submit" isPending={busy}>
            登記產駒
          </Button>
          <Button onPress={props.onCancel}>取消</Button>
        </div>
      </Form>
      {warnings !== undefined && (
        <ConfirmDialog
          title="確認登記產駒"
          confirmLabel="確認並登記"
          onCancel={() => {
            setWarnings(undefined);
          }}
          onConfirm={() => {
            const accepted = warnings.map((warning) => warning.code);
            setWarnings(undefined);
            void register(accepted);
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
