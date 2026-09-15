import { useCallback, useId, useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { Breeding, BreedingType, Conception } from '../../domain/breeding.ts';
import {
  BREEDING_TYPE_OPTIONS,
  CONCEPTION_OPTIONS,
  FOAL_BIRTH_TIMING,
  loadMareBreedings,
  saveBreeding,
  type BreedingRow,
  type MareBreedings,
} from '../../services/breedings.ts';
import type { ServiceContext } from '../../services/context.ts';
import { Feedback, useAction } from '../actions.tsx';
import { FoalForm } from '../foals/FoalForm.tsx';
import { BREEDING_TYPE_LABELS, conceptionText, lineageText } from '../foals/labels.ts';
import { OptionalIntegerField, SelectField } from '../fields.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';

const TYPE_CHOICES = BREEDING_TYPE_OPTIONS.map((type) => ({
  value: type,
  label: BREEDING_TYPE_LABELS[type],
}));
const CONCEPTION_CHOICES = CONCEPTION_OPTIONS.map((conception) => ({
  value: conception,
  label: conception,
}));
/** 選單值：內部種牡馬 id，或代表「外部種牡馬」的空字串。 */
const EXTERNAL_STALLION = '';

function birthText(year: number): string {
  return `${String(year)} 年 ${String(FOAL_BIRTH_TIMING.month)} 月 ${String(FOAL_BIRTH_TIMING.week)} 週`;
}

interface BreedingFields {
  readonly breedingType: BreedingType;
  /** 內部種牡馬 id、代表外部種牡馬的空字串，或 undefined（不選）。 */
  readonly stallion: string | undefined;
  readonly stallionName: string;
  readonly conception: Conception | undefined;
}

/** 表單初始值取所選年份的紀錄；該年還沒有紀錄時預選第一匹內部種牡馬。 */
function fieldsFor(record: Breeding | undefined, data: MareBreedings): BreedingFields {
  if (record === undefined) {
    return {
      breedingType: 'designated',
      stallion: data.stallionOptions[0]?.id,
      stallionName: '',
      conception: undefined,
    };
  }
  return {
    breedingType: record.breedingType,
    stallion: record.stallionName === undefined ? record.stallionId : EXTERNAL_STALLION,
    stallionName: record.stallionName ?? '',
    conception: record.conception,
  };
}

function BreedingForm({ mareId, data }: { readonly mareId: string; readonly data: MareBreedings }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const headingId = useId();
  const recordFor = (year: number | undefined) =>
    data.rows.find((row) => row.record.gameYear === year)?.record;
  const [gameYear, setGameYear] = useState<number | undefined>(data.currentYear);
  const [fields, setFields] = useState(() => fieldsFor(recordFor(data.currentYear), data));
  const { breedingType, stallion, stallionName, conception } = fields;
  const update = (patch: Partial<BreedingFields>) => {
    setFields({ ...fields, ...patch });
  };
  const external = stallion === EXTERNAL_STALLION;
  const stallionChoices = [
    ...data.stallionOptions.map((option) => ({
      value: option.id,
      label: `${option.name}（${lineageText(option.lineage)}）`,
    })),
    { value: EXTERNAL_STALLION, label: '外部種牡馬（輸入馬名）' },
  ];
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const saved = await saveBreeding(context, {
            mareId,
            gameYear,
            breedingType,
            stallionId: external ? undefined : stallion,
            stallionName: external ? stallionName : '',
            conception,
          });
          return `已保存 ${String(saved.gameYear)} 年的繁殖紀錄（${conceptionText(saved.conception)}）`;
        });
      }}
    >
      <h4 id={headingId}>登記繁殖紀錄</h4>
      <p>
        每年一筆，改配種年會帶入那一年的紀錄，再次保存即更正。受胎狀態原樣保存；沒有進行受胎作業時登記「空胎」，可不選種牡馬。
        結果以七月總表為準，未確認時保留原狀態。
      </p>
      <OptionalIntegerField
        label="配種年"
        value={gameYear}
        onChange={(year) => {
          setGameYear(year);
          setFields(fieldsFor(recordFor(year), data));
        }}
      />
      <SelectField
        label="配種類型"
        value={breedingType}
        options={TYPE_CHOICES}
        onChange={(next) => {
          if (next !== undefined) {
            update({ breedingType: next });
          }
        }}
      />
      <SelectField
        label="種牡馬"
        value={stallion}
        options={stallionChoices}
        emptyLabel="不選（空胎）"
        onChange={(next) => {
          update({ stallion: next });
        }}
      />
      {external && (
        <TextField
          value={stallionName}
          onChange={(next) => {
            update({ stallionName: next });
          }}
        >
          <Label>外部種牡馬馬名</Label>
          <Input />
        </TextField>
      )}
      <SelectField
        label="受胎狀態"
        value={conception}
        options={CONCEPTION_CHOICES}
        emptyLabel="未登記"
        onChange={(next) => {
          update({ conception: next });
        }}
      />
      <Feedback message={message} error={error} />
      <Button type="submit" isPending={busy}>
        保存繁殖紀錄
      </Button>
    </Form>
  );
}

function RowItem({ row, mareId }: { readonly row: BreedingRow; readonly mareId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [registered, setRegistered] = useState<string>();
  const { record } = row;
  return (
    <li className="breeding-row" aria-label={`${String(record.gameYear)} 年繁殖紀錄`}>
      <p>
        <strong>{record.gameYear} 年</strong>
        {`・${BREEDING_TYPE_LABELS[record.breedingType]}・種牡馬 ${row.stallionLabel ?? '—'}・`}
        <span data-testid="breeding-conception">{conceptionText(record.conception)}</span>
      </p>
      {record.expectedBirthYear !== undefined && (
        <p data-testid="breeding-expected">
          {row.foalName === undefined
            ? `預定 ${birthText(record.expectedBirthYear)}出生`
            : `${String(record.expectedBirthYear)} 年出生：${row.foalName}`}
        </p>
      )}
      {record.conception === '未確認' && (
        <p className="notice">未確認：不推定結果，請以七月總表確認。</p>
      )}
      {registered !== undefined && <p role="status">{registered}</p>}
      {row.canConfirmBirth && !confirming && (
        <Button
          onPress={() => {
            setConfirming(true);
          }}
        >
          確認出生
        </Button>
      )}
      {confirming && (
        <FoalForm
          damId={mareId}
          birthYear={record.expectedBirthYear}
          onRegistered={(foal) => {
            setConfirming(false);
            setRegistered(`已登記產駒「${foal.trackingName ?? ''}」`);
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      )}
    </li>
  );
}

/** 配種頁籤（需求規格 9.1、13.4）：年度繁殖紀錄（新到舊）與登記表單；受胎後預定隔年 4 月 1 週出生。 */
export function MareBreeding({ mareId }: { readonly mareId: string }) {
  const load = useCallback(
    (serviceContext: ServiceContext) => loadMareBreedings(serviceContext, mareId),
    [mareId],
  );
  const { data, error } = useServiceQuery(load);
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  return (
    <>
      {data.rows.length === 0 ? (
        <p>尚無繁殖紀錄。</p>
      ) : (
        <ol className="breeding-list" aria-label="繁殖紀錄">
          {data.rows.map((row) => (
            <RowItem key={row.record.id} row={row} mareId={mareId} />
          ))}
        </ol>
      )}
      <BreedingForm key={data.currentYear} mareId={mareId} data={data} />
    </>
  );
}
