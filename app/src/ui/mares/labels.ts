import type { HistoryEventType } from '../../domain/history-event.ts';
import type { LifeStage } from '../../domain/horse.ts';
import type { MareGroupView } from '../../services/mare-list.ts';
import type { MareHistoryItem } from '../../services/mares.ts';
import type {
  LeftReason,
  MareGroup,
  MareOrigin,
  MareSite,
  MareStatus,
  Succession,
  YearPlan,
} from '../../domain/mare.ts';
import type { Vitality, VitalityMonth } from '../../domain/mare-yearly.ts';

/** 據點依繋養牧場番号顯示，33 不分成兩個據點（需求規格 3 章、8.6）。 */
export const SITE_LABELS: Readonly<Record<MareSite, string>> = {
  32: '日本',
  33: '分場（俱樂部牧場）',
  34: '美國',
  35: '歐洲',
};

export const ORIGIN_LABELS: Readonly<Record<MareOrigin, string>> = {
  marketFound: '市場創系',
  marketReplenish: '市場補血',
  marketMixed: '市場混血',
  marketRecovery: '市場補系',
  ownRetired: '所屬競走馬引退轉入',
  other: '其他',
};

export const YEAR_PLAN_LABELS: Readonly<Record<YearPlan, string>> = {
  undecided: '待定',
  designated: '八系指定配種',
  free: '自由配種',
  waitVitality: '等待活力',
  rest: '輪休',
};

const LEFT_REASON_LABELS: Readonly<Record<LeftReason, string>> = {
  sold: '售出',
  retired: '定年引退',
};

/** 母馬群用途（需求規格 8.3）：市場母馬顯示「替代第 q 系」或「第 1 系起點用」，不得顯示為屬於該系。 */
export function formatMareGroup(group: MareGroup): string {
  switch (group.kind) {
    case 'starter':
      return '第 1 系起點用';
    case 'substitute':
      return `替代第 ${String(group.position)} 系 ${String(group.generation)} 代`;
    case 'own':
      return `第 ${String(group.position)} 系 ${String(group.generation)} 代`;
    case 'unassigned':
      return '待指定用途';
  }
}

export function formatGroupTitle(
  position: number,
  generation: MareGroupView['generation'],
): string {
  if (generation === 'all') {
    return `第 ${String(position)} 系母馬群（全部代數）`;
  }
  if (typeof generation !== 'number') {
    const [from, to] = generation.handover;
    return `第 ${String(position)} 系交接中（${formatGenerationTab(position, from)} → ${formatGenerationTab(position, to)}）`;
  }
  return position === 1 && generation === 0
    ? '第 1 系起點母馬群'
    : `第 ${String(position)} 系 ${String(generation)} 代母馬群`;
}

export function formatGenerationTab(position: number, generation: number): string {
  return position === 1 && generation === 0 ? '起點' : `${String(generation)} 代`;
}

export function formatVitality(vitality: Vitality, month: VitalityMonth | undefined): string {
  switch (vitality.state) {
    case 'notApplicable':
      return '不適用';
    case 'pending':
      return '待更新';
    case 'confirmed':
      return `${String(vitality.value)}${vitality.boosted ? '（増強中）' : ''}${
        month === undefined ? '' : `（${String(month)} 月）`
      }`;
  }
}

export function formatStatus(status: MareStatus, leftReason: LeftReason | undefined): string {
  if (status === 'producing') {
    return '生產中';
  }
  return leftReason === undefined ? '已離圈' : `已離圈（${LEFT_REASON_LABELS[leftReason]}）`;
}

export const STAGE_LABELS: Readonly<Record<LifeStage, string>> = {
  foal: '幼駒',
  racehorse: '競走馬',
  broodmare: '繁殖牝馬',
  stallion: '種牡馬',
};

export const MARE_EVENT_LABELS: Readonly<Partial<Record<HistoryEventType, string>>> = {
  horseCreated: '建立馬匹',
  mareAdded: '加入母馬群',
  mareSold: '賣出',
  mareTransferred: '轉場',
  mareYearlyChanged: '更正年度資料',
  breedingRecorded: '登記繁殖紀錄',
  foalBorn: '出生',
  foalChanged: '更正產駒資料',
  horseNamed: '更正正式馬名',
  successionChanged: '接替狀態變更',
  matingRatingRecorded: '登記配種評價',
};

/** 姊妹接替狀態（需求規格 8.9）。 */
export const SUCCESSION_LABELS: Readonly<Record<Succession, string>> = {
  provisional: '暫定保留',
  sisterCandidate: '候選',
  confirmed: '正式保留',
  replaced: '已被取代',
  sold: '已售出',
};

/** 歷程一列：「1968 年 5 月 1 週：轉場（日本 → 美國）」。 */
export function describeHistoryItem(item: MareHistoryItem): string {
  const label = MARE_EVENT_LABELS[item.type] ?? item.type;
  const timing =
    item.timing === undefined
      ? ''
      : ` ${String(item.timing.month)} 月 ${String(item.timing.week)} 週`;
  const sites =
    item.fromSite !== undefined && item.toSite !== undefined
      ? `（${SITE_LABELS[item.fromSite]} → ${SITE_LABELS[item.toSite]}）`
      : '';
  return `${String(item.gameYear)} 年${timing}：${label}${sites}`;
}
