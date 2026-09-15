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
