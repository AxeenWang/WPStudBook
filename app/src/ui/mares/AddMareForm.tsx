import { useId, useRef, useState } from 'react';
import { Button, Form } from 'react-aria-components';
import type { LinePosition } from '../../domain/line.ts';
import type { MareOrigin, MareSite } from '../../domain/mare.ts';
import { UNASSIGNED_VIEW, type MareGroupView } from '../../services/mare-list.ts';
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
import { fieldIssuesOf, type FieldIssues } from '../../services/errors.ts';
import { describedByError } from '../actions.tsx';
import { ConfirmDialog } from '../dialogs.tsx';
import {
  CheckboxField,
  OptionalIntegerField,
  SelectField,
  TextInputField,
  useFocusFirstInvalid,
} from '../fields.tsx';
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
  // 待指定用途檢視沒有系可帶入，手動新增仍要選一個系（需求規格 8.4）。
  const [position, setPosition] = useState<LinePosition>(
    props.initial.position === UNASSIGNED_VIEW ? 1 : props.initial.position,
  );
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
  const [fields, setFields] = useState<FieldIssues>({});
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  useFocusFirstInvalid(formRef, fields);

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
      setFields({});
      props.onAdded(added);
    } catch (caught) {
      setError(errorMessage(caught));
      setFields(fieldIssuesOf(caught));
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
        setFields(check.fields);
        setBusy(false);
        return;
      }
      setError(undefined);
      setFields({});
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
        ref={formRef}
        aria-labelledby="add-mare-heading"
        {...describedByError(errorId, error)}
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
          error={fields.generation}
        />
        <TextInputField
          label="馬名"
          value={fullName}
          onChange={setFullName}
          error={fields.fullName}
        />
        <TextInputField
          label="能力番号（選填，例如 0x0000）"
          value={abilityNo}
          onChange={setAbilityNo}
          error={fields.abilityNo}
        />
        <OptionalIntegerField
          label="出生年（選填）"
          value={birthYear}
          onChange={setBirthYear}
          error={fields.birthYear}
        />
        <TextInputField label="父馬名（選填）" value={sireName} onChange={setSireName} />
        <TextInputField label="母馬名（選填）" value={damName} onChange={setDamName} />
        <TextInputField
          label="自身父系（選填）"
          value={sireSubsystem}
          onChange={setSireSubsystem}
        />
        <TextInputField
          label="牝系名稱（選填）"
          value={femaleLine}
          onChange={setFemaleLine}
          error={fields.femaleLine}
        />
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
          error={fields.site}
        />
        <SelectField
          label="來源"
          value={effectiveOrigin}
          options={ORIGIN_CHOICES}
          onChange={setOrigin}
        />
        <TextInputField label="來源備註（選填）" value={originNote} onChange={setOriginNote} />
        {error !== undefined && (
          <p role="alert" id={errorId}>
            {error}
          </p>
        )}
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
