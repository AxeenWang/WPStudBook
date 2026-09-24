import type { LinePosition } from '../../src/core/lines'
import type {
  HorseRow,
  LineRow,
  MareRow,
  RestorationRow,
  StallionRow,
} from '../../src/storage/records'

/** 測試資料列所屬的遊戲局 */
export const GAME = 'G'

/** 馬匹：只帶識別與遊戲局，其他欄位依需要覆寫 */
export function horseRow(id: string, fields: Partial<HorseRow> = {}): HorseRow {
  return { id, gameId: GAME, ...fields }
}

/** 已開啟的系 */
export function lineRow(
  line: LinePosition,
  subsystem: string,
  fields: Partial<LineRow> = {},
): LineRow {
  return { gameId: GAME, line, subsystem, color: '#1f77b4', openedYear: 1968, ...fields }
}

/** 自家母駒：第 line 系 generation 代，預設在圈、暫定保留並使該代成立 */
export function ownMareRow(
  horseId: string,
  line: LinePosition,
  generation: number,
  fields: Partial<MareRow> = {},
): MareRow {
  return {
    horseId,
    gameId: GAME,
    usage: 'own',
    groupLine: line,
    groupGeneration: generation,
    herd: 'in-herd',
    sisterStatus: 'provisional',
    establishedGeneration: true,
    source: { kind: 'retired-racehorse' },
    ...fields,
  }
}

/** 替代第 forLine 系第 forGeneration 代的市場母馬，預設在圈 */
export function substituteMareRow(
  horseId: string,
  forLine: LinePosition,
  forGeneration: number,
  fields: Partial<MareRow> = {},
): MareRow {
  return {
    horseId,
    gameId: GAME,
    usage: 'substitute',
    groupLine: forLine,
    groupGeneration: forGeneration,
    herd: 'in-herd',
    establishedGeneration: false,
    source: { kind: 'market-supplement' },
    ...fields,
  }
}

/** 第 1 系起點用的市場母馬，預設在圈 */
export function startMareRow(horseId: string, fields: Partial<MareRow> = {}): MareRow {
  return {
    horseId,
    gameId: GAME,
    usage: 'start',
    groupLine: 1,
    groupGeneration: 0,
    herd: 'in-herd',
    establishedGeneration: false,
    source: { kind: 'market-founding' },
    ...fields,
  }
}

/** 不屬於母馬群的母馬：待指定用途，或自由配種所生 */
export function ungroupedMareRow(
  horseId: string,
  usage: 'unassigned' | 'free',
  fields: Partial<MareRow> = {},
): MareRow {
  return {
    horseId,
    gameId: GAME,
    usage,
    herd: 'in-herd',
    establishedGeneration: false,
    source: { kind: usage === 'free' ? 'retired-racehorse' : 'other' },
    ...fields,
  }
}

/** 種牡馬的任用：任用識別與馬匹識別相同，預設在崗 */
export function stallionRow(
  horseId: string,
  line: LinePosition,
  generation: number,
  fields: Partial<StallionRow> = {},
): StallionRow {
  return { id: horseId, gameId: GAME, line, generation, horseId, status: 'active', ...fields }
}

/** 斷血補系宣告，預設未撤銷 */
export function restorationRow(
  id: string,
  line: LinePosition,
  generation: number,
  side: RestorationRow['side'],
  fields: Partial<RestorationRow> = {},
): RestorationRow {
  return {
    id,
    gameId: GAME,
    line,
    generation,
    side,
    reason: '後繼無法延續',
    year: 1990,
    revoked: false,
    ...fields,
  }
}
