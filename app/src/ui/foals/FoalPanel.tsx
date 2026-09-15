import { useId, useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';
import type { Disposition } from '../../domain/foal.ts';
import type { MareSite } from '../../domain/mare.ts';
import {
  DISPOSITION_OPTIONS,
  nameFoal,
  updateFoal,
  type FoalCard,
  type FoalDetailsInput,
} from '../../services/foals.ts';
import { MARE_SITE_OPTIONS } from '../../services/mares.ts';
import { convertFoalToMare } from '../../services/succession.ts';
import { Feedback, useAction } from '../actions.tsx';
import { SelectField } from '../fields.tsx';
import { SITE_LABELS, SUCCESSION_LABELS, formatMareGroup } from '../mares/labels.ts';
import { useServices } from '../ServicesContext.tsx';
import { FoalDetailsFields } from './FoalDetailsFields.tsx';
import { DISPOSITION_LABELS } from './labels.ts';

const SITE_CHOICES = MARE_SITE_OPTIONS.map((site) => ({ value: site, label: SITE_LABELS[site] }));

function NameForm({ card }: { readonly card: FoalCard }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const headingId = useId();
  const [name, setName] = useState(card.named ? card.name : '');
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const named = await nameFoal(context, { foalId: card.id, officialName: name });
          return named.officialName === undefined
            ? '已清空正式馬名，改顯示追蹤名'
            : `已登記正式馬名「${named.officialName}」`;
        });
      }}
    >
      <h5 id={headingId}>正式馬名</h5>
      <p>
        留空並保存會清空正式馬名，改顯示追蹤名
        {card.trackingName === undefined ? '' : `「${card.trackingName}」`}。
      </p>
      <TextField value={name} onChange={setName}>
        <Label>正式馬名</Label>
        <Input />
      </TextField>
      <Feedback message={message} error={error} />
      <Button type="submit" isPending={busy}>
        保存馬名
      </Button>
    </Form>
  );
}

function detailsOf(card: FoalCard): FoalDetailsInput {
  return {
    sp: card.sp,
    st: card.st,
    subParams: card.subParams,
    turf: card.turf,
    dirt: card.dirt,
    distanceText: card.distanceText ?? '',
    kodashi: card.kodashi,
    note: card.note ?? '',
  };
}

function UpdateForm({ card }: { readonly card: FoalCard }) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const headingId = useId();
  const [disposition, setDisposition] = useState<Disposition>(card.disposition);
  const [details, setDetails] = useState(detailsOf(card));
  const choices = DISPOSITION_OPTIONS.filter((item) => !card.freeBred || item !== 'keep').map(
    (item) => ({ value: item, label: DISPOSITION_LABELS[item] }),
  );
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await updateFoal(context, { foalId: card.id, disposition, ...details });
          return '已保存產駒資料';
        });
      }}
    >
      <h5 id={headingId}>牧場處置、能力與適性</h5>
      <SelectField
        label="牧場處置"
        value={disposition}
        options={choices}
        onChange={(next) => {
          if (next !== undefined) {
            setDisposition(next);
          }
        }}
      />
      <FoalDetailsFields value={details} onChange={setDetails} />
      <Feedback message={message} error={error} />
      <Button type="submit" isPending={busy}>
        保存產駒資料
      </Button>
    </Form>
  );
}

function ConvertForm({
  card,
  onConverted,
}: {
  readonly card: FoalCard;
  readonly onConverted: () => void;
}) {
  const { context } = useServices();
  const { busy, message, error, run } = useAction();
  const headingId = useId();
  const [site, setSite] = useState<MareSite>();
  return (
    <Form
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const converted = await convertFoalToMare(context, {
            foalId: card.id,
            site: site ?? Number.NaN,
          });
          const { mare } = converted;
          onConverted();
          const succession =
            mare.succession === undefined ? '' : `（${SUCCESSION_LABELS[mare.succession]}）`;
          return `已轉入為${formatMareGroup(mare.group)}母馬${succession}${
            converted.establishedGeneration ? '，該代已成立' : ''
          }`;
        });
      }}
    >
      <h5 id={headingId}>轉入為繁殖牝馬</h5>
      <p>
        依出生紀錄加入
        {card.lineage === undefined
          ? ''
          : ` 第 ${String(card.lineage.position)} 系 ${String(card.lineage.generation)} 代`}
        母馬群，自身父系由父馬決定。已有同父同母姊妹在圈時成為候選。
      </p>
      <SelectField
        label="轉入據點"
        value={site}
        options={SITE_CHOICES}
        emptyLabel="請選擇"
        onChange={setSite}
      />
      <Feedback message={message} error={error} />
      <Button type="submit" isPending={busy}>
        轉入母馬群
      </Button>
    </Form>
  );
}

/** 產駒管理（需求規格 8.4、9.3、9.4）：補名、更正資料，以及非自由配種母駒的手動轉入。 */
export function FoalPanel({ card }: { readonly card: FoalCard }) {
  // 轉入成功後產駒變成母馬，表單仍保留到面板收合，讓結果訊息留在畫面上。
  const [converted, setConverted] = useState(false);
  const convertible =
    converted ||
    (card.sex === 'female' && !card.freeBred && !card.isMare && card.disposition !== 'sold');
  return (
    <div className="foal-panel">
      <NameForm card={card} />
      <UpdateForm card={card} />
      {convertible && (
        <ConvertForm
          card={card}
          onConverted={() => {
            setConverted(true);
          }}
        />
      )}
      {card.freeBred && <p className="notice">自由配種產駒不能成為八系後繼。</p>}
    </div>
  );
}
