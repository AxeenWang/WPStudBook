import { Button, Input, Label, TextField } from 'react-aria-components';
import {
  DEFAULT_MARE_FILTER,
  type FemaleLineFilter,
  type MareFilterOptions,
  type MareStatusFilter,
} from '../../services/mare-list.ts';
import { MARE_ORIGIN_OPTIONS, MARE_SITE_OPTIONS, YEAR_PLAN_OPTIONS } from '../../services/mares.ts';
import { CheckboxField, OptionalIntegerField, SelectField, type SelectOption } from '../fields.tsx';
import { ORIGIN_LABELS, SITE_LABELS, YEAR_PLAN_LABELS } from './labels.ts';

const SITE_CHOICES = MARE_SITE_OPTIONS.map((site) => ({ value: site, label: SITE_LABELS[site] }));
const PLAN_CHOICES = YEAR_PLAN_OPTIONS.map((plan) => ({
  value: plan,
  label: YEAR_PLAN_LABELS[plan],
}));
const ORIGIN_CHOICES = MARE_ORIGIN_OPTIONS.map((origin) => ({
  value: origin,
  label: ORIGIN_LABELS[origin],
}));
const STATUS_CHOICES: readonly SelectOption<MareStatusFilter>[] = [
  { value: 'producing', label: '生產中' },
  { value: 'left', label: '已離圈' },
  { value: 'all', label: '全部' },
];
const FEMALE_LINE_CHOICES: readonly SelectOption<FemaleLineFilter>[] = [
  { value: 'any', label: '不限' },
  { value: 'named', label: '有具名牝系' },
  { value: 'none', label: '不屬於具名牝系' },
];

interface MareFiltersProps {
  readonly options: MareFilterOptions;
  readonly onChange: (options: MareFilterOptions) => void;
}

/** 篩選條件（需求規格 13.3）；與系、代數一起取交集。「有未命名產駒」在子計畫 2-3 加入。 */
export function MareFilters({ options, onChange }: MareFiltersProps) {
  const update = (patch: Partial<MareFilterOptions>) => {
    onChange({ ...options, ...patch });
  };
  return (
    <fieldset className="filters">
      <legend>篩選</legend>
      <SelectField
        label="狀態"
        value={options.status}
        options={STATUS_CHOICES}
        onChange={(status) => {
          update({ status: status ?? 'producing' });
        }}
      />
      <SelectField
        label="據點"
        value={options.site}
        options={SITE_CHOICES}
        emptyLabel="全部據點"
        onChange={(site) => {
          update({ site });
        }}
      />
      <OptionalIntegerField
        label="活力下限"
        value={options.vitalityMin}
        onChange={(vitalityMin) => {
          update({ vitalityMin });
        }}
      />
      <OptionalIntegerField
        label="活力上限"
        value={options.vitalityMax}
        onChange={(vitalityMax) => {
          update({ vitalityMax });
        }}
      />
      <CheckboxField
        label="増強中"
        checked={options.boostedOnly}
        onChange={(boostedOnly) => {
          update({ boostedOnly });
        }}
      />
      <CheckboxField
        label="活力待更新"
        checked={options.pendingOnly}
        onChange={(pendingOnly) => {
          update({ pendingOnly });
        }}
      />
      <SelectField
        label="今年計畫"
        value={options.yearPlan}
        options={PLAN_CHOICES}
        emptyLabel="全部計畫"
        onChange={(yearPlan) => {
          update({ yearPlan });
        }}
      />
      <SelectField
        label="來源"
        value={options.origin}
        options={ORIGIN_CHOICES}
        emptyLabel="全部來源"
        onChange={(origin) => {
          update({ origin });
        }}
      />
      <SelectField
        label="有無牝系"
        value={options.femaleLine}
        options={FEMALE_LINE_CHOICES}
        onChange={(femaleLine) => {
          update({ femaleLine: femaleLine ?? 'any' });
        }}
      />
      <TextField
        value={options.femaleLineName}
        onChange={(femaleLineName) => {
          update({ femaleLineName });
        }}
      >
        <Label>牝系名稱</Label>
        <Input />
      </TextField>
      <OptionalIntegerField
        label="仔出下限"
        value={options.kodashiMin}
        onChange={(kodashiMin) => {
          update({ kodashiMin });
        }}
      />
      <OptionalIntegerField
        label="仔出上限"
        value={options.kodashiMax}
        onChange={(kodashiMax) => {
          update({ kodashiMax });
        }}
      />
      <TextField
        value={options.keyword}
        onChange={(keyword) => {
          update({ keyword });
        }}
      >
        <Label>關鍵字（馬名）</Label>
        <Input />
      </TextField>
      <Button
        onPress={() => {
          onChange(DEFAULT_MARE_FILTER);
        }}
      >
        清除篩選
      </Button>
    </fieldset>
  );
}
