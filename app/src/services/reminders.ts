import type { Game } from '../domain/game.ts';
import { isYearlyTotal, type ImportBatch } from '../domain/import-batch.ts';
import { parentSystemOf, type SystemMapEntry } from '../domain/system-map.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import { listImports } from '../storage/imports.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { listSystemMapEntries } from '../storage/system-map.ts';
import type { ServiceContext } from './context.ts';
import { requireCurrentGame } from './games.ts';
import type { MareCard } from './mare-list.ts';
import { loadMareHerd } from './mares.ts';

/**
 * 總覽提醒區的其他提醒（需求規格 13.2、UI-06）：母馬高齡、最後配種年齡或定年、可出售母親、
 * 對照表待補與備份。八系任務（母馬群待補、缺少現任或目標種牡馬、等待）與種牡馬提醒年齡
 * 由任務看板與種牡馬資料提供，總覽再把兩邊合在一起。
 */
export interface OverviewReminders {
  readonly mares: readonly string[];
  readonly systemMap: readonly string[];
  readonly backup: readonly string[];
}

/** 一匹母馬一行，列出所有理由；卡片上的說法照搬（需求規格 8.5、MARE-11、MARE-23）。 */
export function mareReminders(cards: readonly MareCard[]): string[] {
  return cards.flatMap((card) => {
    if (card.status !== 'producing') {
      return [];
    }
    const reasons = [
      ...(card.atRetirementAge ? ['已達定年，不列入任務'] : []),
      ...(card.lastBreedingAge ? ['最後值得配種的年齡'] : []),
      ...(card.highAge ? ['達高齡提醒年齡，產駒素質可能下降，可考慮出售'] : []),
      ...(card.suggestSellMother ? ['女兒已轉入且今年已生產，可考慮出售'] : []),
    ];
    if (reasons.length === 0) {
      return [];
    }
    const age = card.age === undefined ? '' : `（${String(card.age)} 歲）`;
    return [`母馬「${card.name}」${age}：${reasons.join('、')}`];
  });
}

/**
 * 對照表待補（需求規格 7.2）：生產中母馬與在崗種牡馬的自身父系還沒登錄在系統對照表。
 * 不補也能用，但這些馬會讓循環期的活血預估標為資料不足。
 */
export function systemMapReminders(
  subsystems: readonly (string | undefined)[],
  entries: readonly SystemMapEntry[],
): string[] {
  const missing = [
    ...new Set(
      subsystems.filter(
        (name): name is string => name !== undefined && parentSystemOf(entries, name) === undefined,
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ja'));
  return missing.length === 0
    ? []
    : [`系統對照表待補：${missing.join('、')}（未登錄的子系統會讓循環期的活血預估標為資料不足）`];
}

/**
 * 備份（需求規格 12.2、IMP-12）：資料只存在目前瀏覽器的設定檔，外部備份不可省略。
 * 沒有備份過，或最後一次年度總表匯入晚於最近備份時提醒。
 */
export function backupReminders(game: Game, batches: readonly ImportBatch[]): string[] {
  const latest = batches
    .filter((batch) => isYearlyTotal(batch.type))
    .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))
    .at(-1);
  if (game.lastBackup === undefined) {
    return ['這一局還沒有匯出過備份；資料只存在目前瀏覽器，請到資料管理匯出備份'];
  }
  return latest !== undefined && latest.appliedAt > game.lastBackup.exportedAt
    ? [`匯入「${latest.fileName}」之後還沒有備份，請到資料管理匯出備份`]
    : [];
}

export async function loadOverviewReminders(context: ServiceContext): Promise<OverviewReminders> {
  const game = await requireCurrentGame(context);
  const [herd, duties, entries, batches] = await Promise.all([
    loadMareHerd(context),
    listStallionDuties(context.database, game.id),
    listSystemMapEntries(context.database, game.id),
    listImports(context.database, game.id),
  ]);
  const onDuty = duties
    .filter((duty) => duty.role === 'current' && duty.dutyStatus === 'onDuty')
    .flatMap((duty) => (duty.horseId === undefined ? [] : [duty.horseId]));
  const stallions = await getHorsesByIds(context.database, game.id, onDuty);
  const producing = herd.cards.filter((card) => card.status === 'producing');
  return {
    mares: mareReminders(producing),
    systemMap: systemMapReminders(
      [
        ...producing.map((card) => card.sireSubsystem),
        ...[...stallions.values()].map((horse) => horse.sireSubsystem),
      ],
      entries,
    ),
    backup: backupReminders(game, batches),
  };
}
