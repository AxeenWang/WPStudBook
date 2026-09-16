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
import {
  LINE_COLOR_OPTIONS,
  checkOpenLine,
  openLine,
  type OpenableLine,
  type OpenLineInput,
  type OpenLineWarning,
} from '../../services/lines.ts';
import { findParentSystem } from '../../services/system-map.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { errorMessage } from '../format.ts';
import { useServices } from '../ServicesContext.tsx';

const YEAR_FORMAT = { useGrouping: false, maximumFractionDigits: 0 } as const;

/** 開啟系位置（需求規格 7.1、7.3、LINE-02）：位置由規則指定，表單只填名稱、種牡馬與代表色。 */
export function OpenLineForm({ slot }: { readonly slot: OpenableLine }) {
  const { context, notifyChanged } = useServices();
  const [subsystem, setSubsystem] = useState('');
  const [parentSystem, setParentSystem] = useState('');
  const [color, setColor] = useState(slot.suggestedColor);
  const [fullName, setFullName] = useState('');
  const [abilityNo, setAbilityNo] = useState('');
  const [birthYear, setBirthYear] = useState<number>();
  const [sireName, setSireName] = useState('');
  const [damName, setDamName] = useState('');
  const [warnings, setWarnings] = useState<readonly OpenLineWarning[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const heading = `開啟第 ${String(slot.position)} 系`;

  const currentInput = (): OpenLineInput => ({
    position: slot.position,
    subsystem,
    parentSystem,
    color,
    founder: { fullName, abilityNo, birthYear, sireName, damName },
  });

  /** 親系統還沒填時，依系統對照表帶入。 */
  const fillParentSystem = async () => {
    if (parentSystem.trim() !== '') {
      return;
    }
    try {
      const found = await findParentSystem(context, subsystem);
      if (found !== undefined) {
        setParentSystem(found);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const open = async (acceptedWarnings: OpenLineInput['acceptedWarnings']) => {
    setBusy(true);
    try {
      await openLine(context, { ...currentInput(), acceptedWarnings });
      setError(undefined);
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
      const check = await checkOpenLine(context, currentInput());
      if (check.issues.length > 0) {
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
      await open(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <>
      <Form
        aria-labelledby="open-line-heading"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3 id="open-line-heading">{heading}</h3>
        <p>
          {slot.damPosition === undefined
            ? `填寫第 ${String(slot.position)} 系目前的子系統、親系統與零代市場種牡馬；代表色已自動分配，可以改選。`
            : `建立新系：第 ${String(slot.position)} 系零代市場種牡馬 × 第 ${String(slot.damPosition)} 系 ${String(slot.damGeneration ?? 0)} 代母馬 → 第 ${String(slot.position)} 系 ${String(slot.targetGeneration)} 代。代表色已自動分配，可以改選。`}
        </p>
        <TextField
          value={subsystem}
          onChange={setSubsystem}
          onBlur={() => {
            void fillParentSystem();
          }}
        >
          <Label>目前子系統</Label>
          <Input />
        </TextField>
        <TextField value={parentSystem} onChange={setParentSystem}>
          <Label>親系統</Label>
          <Input />
        </TextField>
        <RadioGroup value={color} onChange={setColor}>
          <Label>代表色</Label>
          {LINE_COLOR_OPTIONS.map((option) => (
            <RadioField key={option.value} value={option.value}>
              <RadioButton>
                <span
                  className="color-swatch"
                  style={{ background: option.value }}
                  aria-hidden="true"
                />
                {option.label}
              </RadioButton>
            </RadioField>
          ))}
        </RadioGroup>
        <fieldset>
          <legend>零代市場種牡馬</legend>
          <TextField value={fullName} onChange={setFullName}>
            <Label>零代市場種牡馬馬名</Label>
            <Input />
          </TextField>
          <TextField value={abilityNo} onChange={setAbilityNo}>
            <Label>能力番号（選填，例如 0x0000）</Label>
            <Input />
          </TextField>
          <NumberField
            value={birthYear ?? Number.NaN}
            onChange={(value) => {
              setBirthYear(Number.isNaN(value) ? undefined : value);
            }}
            formatOptions={YEAR_FORMAT}
          >
            <Label>出生年（選填）</Label>
            <Input />
          </NumberField>
          <TextField value={sireName} onChange={setSireName}>
            <Label>父馬名（選填）</Label>
            <Input />
          </TextField>
          <TextField value={damName} onChange={setDamName}>
            <Label>母馬名（選填）</Label>
            <Input />
          </TextField>
        </fieldset>
        {error !== undefined && <p role="alert">{error}</p>}
        <Button type="submit" isDisabled={busy}>
          {heading}
        </Button>
      </Form>
      {warnings !== undefined && (
        <ConfirmDialog
          title={`確認${heading}`}
          confirmLabel="確認並開啟"
          onCancel={() => {
            setWarnings(undefined);
          }}
          onConfirm={() => {
            const accepted = warnings.map((warning) => warning.code);
            setWarnings(undefined);
            void open(accepted);
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
