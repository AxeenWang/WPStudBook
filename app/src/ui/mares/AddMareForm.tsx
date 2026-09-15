import { useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { LinePosition } from '../../domain/line.ts';
import type { MareOrigin, MareSite } from '../../domain/mare.ts';
import type { MareGroupView } from '../../services/mare-list.ts';
import {
  MARE_ORIGIN_OPTIONS,
  MARE_POSITION_OPTIONS,
  MARE_SITE_OPTIONS,
  addMarketMare,
  checkAddMarketMare,
  defaultOriginFor,
  type AddMareWarning,
  type AddedMare,
  type MarketMareInput,
} from '../../services/mares.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { CheckboxField, OptionalIntegerField, SelectField } from '../fields.tsx';
import { errorMessage } from '../format.ts';
import { useServices } from '../ServicesContext.tsx';
import { ORIGIN_LABELS, SITE_LABELS } from './labels.ts';

const POSITION_CHOICES = MARE_POSITION_OPTIONS.map((position) => ({
  value: position,
  label: `第 ${String(position)} 系`,
}));
const SITE_CHOICES = MARE_SITE_OPTIONS.map((site) => ({ value: site, label: SITE_LABELS[site] }));
const ORIGIN_CHOICES = MARE_ORIGIN_OPTIONS.map((origin) => ({
  value: origin,
  label: ORIGIN_LABELS[origin],
}));

interface AddMareFormProps {
  readonly initial: MareGroupView;
  readonly openedPositions: readonly LinePosition[];
  readonly onAdded: (added: AddedMare) => void;
  readonly onCancel: () => void;
}

/** 手動新增市場母馬（需求規格 8.4）：帶入目前檢視的系與代數，來源預設依母馬群決定。 */
export function AddMareForm(props: AddMareFormProps) {
  const { context, notifyChanged } = useServices();
  const [position, setPosition] = useState<LinePosition>(props.initial.position);
  const [generation, setGeneration] = useState<number | undefined>(
    typeof props.initial.generation === 'number' ? props.initial.generation : undefined,
  );
  const [fullName, setFullName] = useState('');
  const [abilityNo, setAbilityNo] = useState('');
  const [birthYear, setBirthYear] = useState<number>();
  const [sireName, setSireName] = useState('');
  const [damName, setDamName] = useState('');
  const [sireSubsystem, setSireSubsystem] = useState('');
  const [femaleLine, setFemaleLine] = useState('');
  const [noNamedFemaleLine, setNoNamedFemaleLine] = useState(false);
  const [site, setSite] = useState<MareSite>();
  const [origin, setOrigin] = useState<MareOrigin>();
  const [originNote, setOriginNote] = useState('');
  const [warnings, setWarnings] = useState<readonly AddMareWarning[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const effectiveOrigin: MareOrigin =
    origin ??
    defaultOriginFor(position, generation ?? Number.NaN, props.openedPositions) ??
    'marketFound';

  const currentInput = (): MarketMareInput => ({
    position,
    generation: generation ?? Number.NaN,
    fullName,
    abilityNo,
    birthYear,
    sireName,
    damName,
    sireSubsystem,
    femaleLine,
    noNamedFemaleLine,
    site: site ?? Number.NaN,
    origin: effectiveOrigin,
    originNote,
  });

  const add = async (acceptedWarnings: MarketMareInput['acceptedWarnings']) => {
    setBusy(true);
    try {
      const added = await addMarketMare(context, { ...currentInput(), acceptedWarnings });
      setError(undefined);
      props.onAdded(added);
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
      const check = await checkAddMarketMare(context, currentInput());
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
      await add(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <>
      <Form
        aria-labelledby="add-mare-heading"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3 id="add-mare-heading">手動新增母馬</h3>
        <p>
          市場母馬本身為零代。代數 0 為第 1 系起點母馬群；1 以上登記為替代第 q 系 N
          代，不代表她屬於該系。能力番号、出生年、父母、自身父系與牝系可以留空。
        </p>
        <SelectField
          label="母馬群的系"
          value={position}
          options={POSITION_CHOICES}
          onChange={(next) => {
            if (next !== undefined) {
              setPosition(next);
            }
          }}
        />
        <OptionalIntegerField
          label="母馬群的代數（0＝第 1 系起點）"
          value={generation}
          onChange={setGeneration}
        />
        <TextField value={fullName} onChange={setFullName}>
          <Label>馬名</Label>
          <Input />
        </TextField>
        <TextField value={abilityNo} onChange={setAbilityNo}>
          <Label>能力番号（選填，例如 0x0000）</Label>
          <Input />
        </TextField>
        <OptionalIntegerField label="出生年（選填）" value={birthYear} onChange={setBirthYear} />
        <TextField value={sireName} onChange={setSireName}>
          <Label>父馬名（選填）</Label>
          <Input />
        </TextField>
        <TextField value={damName} onChange={setDamName}>
          <Label>母馬名（選填）</Label>
          <Input />
        </TextField>
        <TextField value={sireSubsystem} onChange={setSireSubsystem}>
          <Label>自身父系（選填）</Label>
          <Input />
        </TextField>
        <TextField value={femaleLine} onChange={setFemaleLine}>
          <Label>牝系名稱（選填）</Label>
          <Input />
        </TextField>
        <CheckboxField
          label="不屬於具名牝系"
          checked={noNamedFemaleLine}
          onChange={setNoNamedFemaleLine}
        />
        <SelectField
          label="據點"
          value={site}
          options={SITE_CHOICES}
          emptyLabel="請選擇"
          onChange={setSite}
        />
        <SelectField
          label="來源"
          value={effectiveOrigin}
          options={ORIGIN_CHOICES}
          onChange={setOrigin}
        />
        <TextField value={originNote} onChange={setOriginNote}>
          <Label>來源備註（選填）</Label>
          <Input />
        </TextField>
        {error !== undefined && <p role="alert">{error}</p>}
        <div className="actions">
          <Button type="submit" isDisabled={busy}>
            新增母馬
          </Button>
          <Button onPress={props.onCancel}>取消</Button>
        </div>
      </Form>
      {warnings !== undefined && (
        <ConfirmDialog
          title="確認新增替代母馬"
          confirmLabel="確認並新增"
          onCancel={() => {
            setWarnings(undefined);
          }}
          onConfirm={() => {
            const accepted = warnings.map((warning) => warning.code);
            setWarnings(undefined);
            void add(accepted);
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
