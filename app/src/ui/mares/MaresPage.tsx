import { useState } from 'react';
import { Button, ToggleButton } from 'react-aria-components';
import type { Game } from '../../domain/game.ts';
import {
  DEFAULT_MARE_FILTER,
  defaultGeneration,
  generationTabs,
  handoverGenerations,
  matchesMareFilter,
  paginate,
  sortMareCards,
  UNASSIGNED_VIEW,
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

const POSITION_CHOICES: readonly { value: MareGroupView['position']; label: string }[] = [
  ...MARE_POSITION_OPTIONS.map((position) => ({
    value: position,
    label: `第 ${String(position)} 系`,
  })),
  // 待指定用途的母馬不屬於任何系（需求規格 11.5「新進（其他）」），另立一個檢視。
  { value: UNASSIGNED_VIEW, label: '待指定用途' },
];

/** 使用者選擇的代數；交接中在每次載入時依目前資料換成相鄰兩代。 */
interface GroupSelection {
  readonly position: MareGroupView['position'];
  readonly generation: number | 'all' | 'handover';
}

function MareHerdView() {
  const { data: herd, error } = useServiceQuery(loadMareHerd);
  const [selection, setSelection] = useState<GroupSelection>();
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

  const position = selection?.position ?? 1;
  // 待指定用途沒有代數，代數頁籤、交接中與預設代數都不適用。
  const linePosition = position === UNASSIGNED_VIEW ? undefined : position;
  const handover =
    linePosition === undefined ? undefined : handoverGenerations(herd.cards, linePosition);
  const selected =
    selection?.generation ??
    (linePosition === undefined ? 'all' : defaultGeneration(herd.cards, linePosition));
  const view: MareGroupView = {
    position,
    generation:
      selected === 'handover' && linePosition !== undefined
        ? (handover ?? defaultGeneration(herd.cards, linePosition))
        : selected === 'handover'
          ? 'all'
          : selected,
  };
  const tabs = linePosition === undefined ? [] : generationTabs(herd.cards, linePosition);
  const shown = paginate(
    sortMareCards(
      herd.cards.filter((card) => matchesMareFilter(card, view, options)),
      herd.vitalityThreshold,
    ),
    page,
  );
  const { generation } = view;
  const producing =
    typeof generation === 'number'
      ? (tabs.find((tab) => tab.generation === generation)?.producing ?? 0)
      : undefined;

  const choose = (next: GroupSelection) => {
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
          onChange={(next) => {
            if (next !== undefined) {
              choose({
                position: next,
                generation: next === UNASSIGNED_VIEW ? 'all' : defaultGeneration(herd.cards, next),
              });
            }
          }}
        />
        <div role="group" aria-label="代數" className="actions">
          <ToggleButton
            isSelected={selected === 'all'}
            onChange={() => {
              choose({ position: view.position, generation: 'all' });
            }}
          >
            全部代數
          </ToggleButton>
          {handover !== undefined && (
            <ToggleButton
              isSelected={selected === 'handover'}
              onChange={() => {
                choose({ position: view.position, generation: 'handover' });
              }}
            >
              交接中
            </ToggleButton>
          )}
          {tabs.map((tab) => (
            <ToggleButton
              key={tab.generation}
              isSelected={selected === tab.generation}
              onChange={() => {
                choose({ position: view.position, generation: tab.generation });
              }}
            >
              {formatGenerationTab(view.position, tab.generation)}（生產中 {tab.producing}・待接替{' '}
              {tab.pendingSuccession}・已離圈 {tab.left}）
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
