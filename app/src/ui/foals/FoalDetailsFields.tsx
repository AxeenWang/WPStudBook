import { Input, Label, TextField } from 'react-aria-components';
import type { FieldIssues } from '../../services/errors.ts';
import type { SubParamGrade } from '../../domain/foal.ts';
import {
  APTITUDE_OPTIONS,
  SUB_PARAM_GRADE_OPTIONS,
  SUB_PARAM_KEY_OPTIONS,
  type FoalDetailsInput,
} from '../../services/foals.ts';
import { OptionalIntegerField, SelectField } from '../fields.tsx';
import { SUB_PARAM_LABELS } from './labels.ts';

const GRADE_CHOICES = SUB_PARAM_GRADE_OPTIONS.map((grade) => ({ value: grade, label: grade }));
const APTITUDE_CHOICES = APTITUDE_OPTIONS.map((aptitude) => ({ value: aptitude, label: aptitude }));

export const EMPTY_FOAL_DETAILS: FoalDetailsInput = {
  sp: undefined,
  st: undefined,
  subParams: {},
  turf: undefined,
  dirt: undefined,
  distanceText: '',
  kodashi: undefined,
  note: '',
};

interface FoalDetailsFieldsProps {
  readonly value: FoalDetailsInput;
  readonly onChange: (value: FoalDetailsInput) => void;
  /** 服務回報的欄位問題（sp、st、kodashi），顯示在對應欄位並建立關聯。 */
  readonly errors?: FieldIssues | undefined;
}

/** 能力、適性與備註欄位（需求規格 9.3）：芝與ダート分開選擇，空白表示未取得。 */
export function FoalDetailsFields({ value, onChange, errors = {} }: FoalDetailsFieldsProps) {
  const update = (patch: Partial<FoalDetailsInput>) => {
    onChange({ ...value, ...patch });
  };
  return (
    <fieldset className="field-group">
      <legend>能力與適性（選填）</legend>
      <OptionalIntegerField
        label="SP"
        value={value.sp}
        onChange={(sp) => {
          update({ sp });
        }}
        error={errors.sp}
      />
      <OptionalIntegerField
        label="ST"
        value={value.st}
        onChange={(st) => {
          update({ st });
        }}
        error={errors.st}
      />
      {SUB_PARAM_KEY_OPTIONS.map((key) => (
        <SelectField<SubParamGrade>
          key={key}
          label={SUB_PARAM_LABELS[key]}
          value={value.subParams[key]}
          options={GRADE_CHOICES}
          emptyLabel="未取得"
          onChange={(grade) => {
            update({ subParams: { ...value.subParams, [key]: grade } });
          }}
        />
      ))}
      <SelectField
        label="芝適性"
        value={value.turf}
        options={APTITUDE_CHOICES}
        emptyLabel="未取得"
        onChange={(turf) => {
          update({ turf });
        }}
      />
      <SelectField
        label="ダート適性"
        value={value.dirt}
        options={APTITUDE_CHOICES}
        emptyLabel="未取得"
        onChange={(dirt) => {
          update({ dirt });
        }}
      />
      <TextField
        value={value.distanceText}
        onChange={(distanceText) => {
          update({ distanceText });
        }}
      >
        <Label>距離適性（例如 1700～3100m）</Label>
        <Input />
      </TextField>
      <OptionalIntegerField
        label="仔出（0～15）"
        value={value.kodashi}
        onChange={(kodashi) => {
          update({ kodashi });
        }}
        error={errors.kodashi}
      />
      <TextField
        value={value.note}
        onChange={(note) => {
          update({ note });
        }}
      >
        <Label>備註</Label>
        <Input />
      </TextField>
    </fieldset>
  );
}
