import { useEffect, useId, type RefObject } from 'react';
import { FieldError, Input, Label, NumberField, TextField } from 'react-aria-components';

const INTEGER_FORMAT = { useGrouping: false, maximumFractionDigits: 0 } as const;

/**
 * 欄位錯誤（需求規格 13.5、UI-05）：有錯誤時欄位標示 aria-invalid，錯誤訊息以 aria-describedby
 * 與欄位建立關聯；React Aria 的欄位由 FieldError 自動關聯，原生欄位由這裡的 id 關聯。
 */
function NativeFieldError({ id, error }: { readonly id: string; readonly error: string }) {
  return (
    <p id={id} className="field-error">
      {error}
    </p>
  );
}

interface TextInputFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
}

/** 文字欄位；有錯誤時在欄位下方顯示並與欄位關聯。 */
export function TextInputField(props: TextInputFieldProps) {
  return (
    <TextField value={props.value} onChange={props.onChange} isInvalid={props.error !== undefined}>
      <Label>{props.label}</Label>
      <Input />
      <FieldError>{props.error}</FieldError>
    </TextField>
  );
}

interface OptionalIntegerFieldProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  readonly error?: string | undefined;
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
      isInvalid={props.error !== undefined}
    >
      <Label>{props.label}</Label>
      <Input />
      <FieldError>{props.error}</FieldError>
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
  readonly error?: string | undefined;
}

/** 原生下拉選單：鍵盤操作與報讀由瀏覽器提供；選項值以索引對應，不必把值轉成字串。 */
export function SelectField<T extends string | number>(props: SelectFieldProps<T>) {
  const id = useId();
  const errorId = `${id}-error`;
  const selected = props.options.findIndex((option) => option.value === props.value);
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={selected < 0 ? '' : String(selected)}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={props.error === undefined ? undefined : errorId}
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
      {props.error !== undefined && <NativeFieldError id={errorId} error={props.error} />}
    </div>
  );
}

interface CheckboxFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly error?: string | undefined;
}

export function CheckboxField(props: CheckboxFieldProps) {
  const errorId = `${useId()}-error`;
  return (
    <div className="field">
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          aria-invalid={props.error === undefined ? undefined : true}
          aria-describedby={props.error === undefined ? undefined : errorId}
          onChange={(event) => {
            props.onChange(event.target.checked);
          }}
        />{' '}
        {props.label}
      </label>
      {props.error !== undefined && <NativeFieldError id={errorId} error={props.error} />}
    </div>
  );
}

/**
 * 送出失敗、欄位標示錯誤後，把焦點移到表單裡第一個有錯誤的欄位，鍵盤與報讀軟體使用者
 * 不必自己找（需求規格 13.5）。errors 改變且非空時才移動。
 */
export function useFocusFirstInvalid(
  formRef: RefObject<HTMLFormElement | null>,
  errors: object,
): void {
  useEffect(() => {
    if (Object.keys(errors).length === 0) {
      return;
    }
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [formRef, errors]);
}
