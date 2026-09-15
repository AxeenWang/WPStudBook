import { useId } from 'react';
import { Input, Label, NumberField } from 'react-aria-components';

const INTEGER_FORMAT = { useGrouping: false, maximumFractionDigits: 0 } as const;

interface OptionalIntegerFieldProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
}

/** 選填的整數欄位：空白為 undefined。不設上下限，範圍由服務檢查並回報。 */
export function OptionalIntegerField(props: OptionalIntegerFieldProps) {
  return (
    <NumberField
      value={props.value ?? Number.NaN}
      onChange={(value) => {
        props.onChange(Number.isNaN(value) ? undefined : value);
      }}
      formatOptions={INTEGER_FORMAT}
    >
      <Label>{props.label}</Label>
      <Input />
    </NumberField>
  );
}

export interface SelectOption<T> {
  readonly value: T;
  readonly label: string;
}

interface SelectFieldProps<T extends string | number> {
  readonly label: string;
  readonly value: T | undefined;
  readonly options: readonly SelectOption<T>[];
  /** 提供時多一個代表「未選擇」的選項；value 可能是 undefined 時必須提供。 */
  readonly emptyLabel?: string | undefined;
  readonly onChange: (value: T | undefined) => void;
}

/** 原生下拉選單：鍵盤操作與報讀由瀏覽器提供；選項值以索引對應，不必把值轉成字串。 */
export function SelectField<T extends string | number>(props: SelectFieldProps<T>) {
  const id = useId();
  const selected = props.options.findIndex((option) => option.value === props.value);
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={selected < 0 ? '' : String(selected)}
        onChange={(event) => {
          const index = event.target.value;
          props.onChange(index === '' ? undefined : props.options[Number(index)]?.value);
        }}
      >
        {props.emptyLabel !== undefined && <option value="">{props.emptyLabel}</option>}
        {props.options.map((option, index) => (
          <option key={String(option.value)} value={String(index)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface CheckboxFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function CheckboxField(props: CheckboxFieldProps) {
  return (
    <div className="field">
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(event) => {
            props.onChange(event.target.checked);
          }}
        />{' '}
        {props.label}
      </label>
    </div>
  );
}
