import { useState } from 'react';
import { Button, Input, Label, TextField } from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import {
  DEFAULT_FOAL_FILTER,
  DISPOSITION_OPTIONS,
  loadFoalList,
  matchesFoalFilter,
  sortFoalCards,
  type FoalCard,
  type FoalFilterOptions,
  type FoalSort,
  type SexFilter,
} from '../../services/foals.ts';
import { paginate } from '../../services/mare-list.ts';
import { CheckboxField, OptionalIntegerField, SelectField, type SelectOption } from '../fields.tsx';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery } from '../ServicesContext.tsx';
import { FoalPanel } from './FoalPanel.tsx';
import { DISPOSITION_LABELS, SURFACE_LABELS, lineageText } from './labels.ts';
import { SexMarker } from './SexMarker.tsx';

const SORT_CHOICES: readonly SelectOption<FoalSort>[] = [
  { value: 'birthYearDesc', label: '出生年（新到舊）' },
  { value: 'spDesc', label: 'SP（高到低）' },
  { value: 'stAsc', label: 'ST 數值（小到大）' },
  { value: 'stDesc', label: 'ST 數值（大到小）' },
];
const SEX_FILTER_CHOICES: readonly SelectOption<SexFilter>[] = [
  { value: 'any', label: '不限' },
  { value: 'male', label: '牡' },
  { value: 'female', label: '牝' },
];
const DISPOSITION_CHOICES = DISPOSITION_OPTIONS.map((disposition) => ({
  value: disposition,
  label: DISPOSITION_LABELS[disposition],
}));

function numberText(label: string, value: number | undefined): string {
  return `${label} ${value === undefined ? '—' : String(value)}`;
}

/** 密集產駒清單的一列（需求規格 9.3、BRD-21）：性別以顏色加形狀區分，並提供文字。 */
function FoalRow({ card }: { readonly card: FoalCard }) {
  const [managing, setManaging] = useState(false);
  return (
    <li className="foal-row" aria-label={card.name}>
      <div className="foal-row-main">
        <SexMarker sex={card.sex} />
        <Button
          className="link-button"
          aria-expanded={managing}
          onPress={() => {
            setManaging(!managing);
          }}
        >
          {card.name}
        </Button>
        <span>{card.birthYear} 年生</span>
        <span>母 {card.damName ?? '未取得'}</span>
        <span>父 {card.sireName ?? '未取得'}</span>
        <span>{card.lineage === undefined ? '自由配種' : lineageText(card.lineage)}</span>
        <span data-testid="foal-sp">{numberText('SP', card.sp)}</span>
        <span data-testid="foal-st">{numberText('ST', card.st)}</span>
        <span>{numberText('サ', card.subParamTotal)}</span>
        <span>
          芝 {card.turf ?? '—'}・ダ {card.dirt ?? '—'}
          {card.surface === undefined ? '' : `（${SURFACE_LABELS[card.surface]}）`}
        </span>
        <span>{DISPOSITION_LABELS[card.disposition]}</span>
        {!card.named && <span className="badge">未命名</span>}
      </div>
      {managing && <FoalPanel card={card} />}
    </li>
  );
}

function FoalListView() {
  const { data, error } = useServiceQuery(loadFoalList);
  const [options, setOptions] = useState<FoalFilterOptions>(DEFAULT_FOAL_FILTER);
  const [sort, setSort] = useState<FoalSort>('birthYearDesc');
  const [page, setPage] = useState(1);
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  const update = (patch: Partial<FoalFilterOptions>) => {
    setOptions({ ...options, ...patch });
    setPage(1);
  };
  const shown = paginate(
    sortFoalCards(
      data.cards.filter((card) => matchesFoalFilter(card, options)),
      sort,
    ),
    page,
  );
  return (
    <section aria-labelledby="foals-heading">
      <h2 id="foals-heading">產駒</h2>
      {error !== undefined && <p role="alert">{error}</p>}
      <p>
        產駒由母馬詳情欄的配種或產駒頁籤登記。未命名的產駒顯示追蹤名（母馬名＋出生年）。SP
        越高越好；ST 是距離定位，只依數值排序。
      </p>
      <fieldset className="filters">
        <legend>篩選與排序</legend>
        <OptionalIntegerField
          label="出生年"
          value={options.birthYear}
          onChange={(birthYear) => {
            update({ birthYear });
          }}
        />
        <SelectField
          label="性別"
          value={options.sex}
          options={SEX_FILTER_CHOICES}
          onChange={(sex) => {
            update({ sex: sex ?? 'any' });
          }}
        />
        <SelectField
          label="牧場處置"
          value={options.disposition}
          options={DISPOSITION_CHOICES}
          emptyLabel="全部"
          onChange={(disposition) => {
            update({ disposition });
          }}
        />
        <CheckboxField
          label="只看未命名"
          checked={options.unnamedOnly}
          onChange={(unnamedOnly) => {
            update({ unnamedOnly });
          }}
        />
        <TextField
          value={options.keyword}
          onChange={(keyword) => {
            update({ keyword });
          }}
        >
          <Label>關鍵字（馬名、追蹤名）</Label>
          <Input />
        </TextField>
        <SelectField
          label="排序"
          value={sort}
          options={SORT_CHOICES}
          onChange={(next) => {
            if (next !== undefined) {
              setSort(next);
            }
          }}
        />
      </fieldset>
      <p>符合條件 {shown.total} 匹</p>
      {data.cards.length === 0 ? (
        <p>目前沒有產駒。遊戲第一年沒有自產幼駒是正常的。</p>
      ) : shown.total === 0 ? (
        <p>沒有符合條件的產駒。</p>
      ) : (
        <ul className="foal-list" aria-label="產駒清單">
          {shown.items.map((card) => (
            <FoalRow key={card.id} card={card} />
          ))}
        </ul>
      )}
      {shown.pageCount > 1 && (
        <nav aria-label="分頁" className="actions">
          <Button
            isDisabled={shown.page <= 1}
            onPress={() => {
              setPage(shown.page - 1);
            }}
          >
            上一頁
          </Button>
          <span>
            第 {shown.page}／{shown.pageCount} 頁
          </span>
          <Button
            isDisabled={shown.page >= shown.pageCount}
            onPress={() => {
              setPage(shown.page + 1);
            }}
          >
            下一頁
          </Button>
        </nav>
      )}
    </section>
  );
}

export function FoalsPage({ currentGame }: { readonly currentGame: Game | undefined }) {
  return currentGame === undefined ? <NoGameNotice /> : <FoalListView key={currentGame.id} />;
}
