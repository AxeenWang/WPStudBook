import { useState } from 'react';
import { Button, ToggleButton } from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import {
  DEFAULT_MARE_FILTER,
  defaultGeneration,
  generationTabs,
  matchesMareFilter,
  paginate,
  sortMareCards,
  type MareFilterOptions,
  type MareGroupView,
} from '../../services/mare-list.ts';
import {
  MARE_POSITION_OPTIONS,
  MARE_TARGET_COUNT,
  loadMareHerd,
  type AddedMare,
} from '../../services/mares.ts';
import { SelectField } from '../fields.tsx';
import { NoGameNotice } from '../NoGameNotice.tsx';
import { useServiceQuery } from '../ServicesContext.tsx';
import { AddMareForm } from './AddMareForm.tsx';
import { formatGenerationTab, formatGroupTitle, formatMareGroup } from './labels.ts';
import { MareCardItem } from './MareCardItem.tsx';
import { MareDetailDrawer, type MareDetailTab } from './MareDetailDrawer.tsx';
import { MareFilters } from './MareFilters.tsx';
import { SellMareDialog } from './SellMareDialog.tsx';

const POSITION_CHOICES = MARE_POSITION_OPTIONS.map((position) => ({
  value: position,
  label: `第 ${String(position)} 系`,
}));

function MareHerdView() {
  const { data: herd, error } = useServiceQuery(loadMareHerd);
  const [selection, setSelection] = useState<MareGroupView>();
  const [options, setOptions] = useState<MareFilterOptions>(DEFAULT_MARE_FILTER);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [sellingId, setSellingId] = useState<string>();
  const [messages, setMessages] = useState<readonly string[]>();
  const [detailId, setDetailId] = useState<string>();
  const [detailTab, setDetailTab] = useState<MareDetailTab>('summary');

  if (herd === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }

  const view: MareGroupView = selection ?? {
    position: 1,
    generation: defaultGeneration(herd.cards, 1),
  };
  const tabs = generationTabs(herd.cards, view.position);
  const shown = paginate(
    sortMareCards(
      herd.cards.filter((card) => matchesMareFilter(card, view, options)),
      herd.vitalityThreshold,
    ),
    page,
  );
  const producing =
    view.generation === 'all'
      ? undefined
      : (tabs.find((tab) => tab.generation === view.generation)?.producing ?? 0);

  const choose = (next: MareGroupView) => {
    setSelection(next);
    setPage(1);
  };

  const onAdded = (added: AddedMare) => {
    setAdding(false);
    const { group } = added.mare;
    if (group.kind !== 'unassigned') {
      choose({ position: group.position, generation: group.generation });
    }
    setMessages([
      `已新增「${added.horse.fullName ?? ''}」為${formatMareGroup(group)}`,
      ...added.notices.map((notice) => `提示：${notice}`),
    ]);
  };

  return (
    <section aria-labelledby="mares-heading">
      <h2 id="mares-heading">繁殖牝馬群</h2>
      {error !== undefined && <p role="alert">{error}</p>}
      {messages !== undefined && (
        <div role="status">
          {messages.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <div className="group-picker">
        <SelectField
          label="系"
          value={view.position}
          options={POSITION_CHOICES}
          onChange={(position) => {
            if (position !== undefined) {
              choose({ position, generation: defaultGeneration(herd.cards, position) });
            }
          }}
        />
        <div role="group" aria-label="代數" className="actions">
          <ToggleButton
            isSelected={view.generation === 'all'}
            onChange={() => {
              choose({ position: view.position, generation: 'all' });
            }}
          >
            全部代數
          </ToggleButton>
          {tabs.map((tab) => (
            <ToggleButton
              key={tab.generation}
              isSelected={view.generation === tab.generation}
              onChange={() => {
                choose({ position: view.position, generation: tab.generation });
              }}
            >
              {formatGenerationTab(view.position, tab.generation)}（生產中 {tab.producing}・已離圈{' '}
              {tab.left}）
            </ToggleButton>
          ))}
        </div>
      </div>
      <h3 data-testid="mare-group-title">
        {formatGroupTitle(view.position, view.generation)}
        {producing !== undefined &&
          `：在圈 ${String(producing)}／目標 ${String(MARE_TARGET_COUNT)}`}
      </h3>
      <div className="actions">
        <Button
          isDisabled={adding}
          onPress={() => {
            setMessages(undefined);
            setAdding(true);
          }}
        >
          手動新增
        </Button>
      </div>
      {adding && (
        <AddMareForm
          initial={view}
          openedPositions={herd.openedPositions}
          onAdded={onAdded}
          onCancel={() => {
            setAdding(false);
          }}
        />
      )}
      <MareFilters
        options={options}
        onChange={(next) => {
          setOptions(next);
          setPage(1);
        }}
      />
      <p>符合條件 {shown.total} 匹</p>
      {shown.total === 0 ? (
        <p>沒有符合條件的母馬。</p>
      ) : (
        <ul className="mare-grid" aria-label="母馬清單">
          {shown.items.map((card) => (
            <MareCardItem
              key={card.id}
              card={card}
              vitalityThreshold={herd.vitalityThreshold}
              onOpen={() => {
                setDetailId(card.id);
              }}
              onSell={() => {
                setSellingId(card.id);
              }}
            />
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
      {sellingId !== undefined && (
        <SellMareDialog
          mareId={sellingId}
          onClose={(soldName) => {
            setSellingId(undefined);
            if (soldName !== undefined) {
              setMessages([`已賣出「${soldName}」，可在狀態篩選選「已離圈」查看紀錄`]);
            }
          }}
        />
      )}
      {detailId !== undefined && (
        <MareDetailDrawer
          mareId={detailId}
          tab={detailTab}
          onTabChange={setDetailTab}
          onClose={() => {
            setDetailId(undefined);
          }}
        />
      )}
    </section>
  );
}

export function MaresPage({ currentGame }: { readonly currentGame: Game | undefined }) {
  return currentGame === undefined ? <NoGameNotice /> : <MareHerdView key={currentGame.id} />;
}
