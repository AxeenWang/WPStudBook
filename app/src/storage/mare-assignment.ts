import { listBoard } from '../core/board'
import type { DesignatedPairing } from '../core/designated'
import type { LinePosition } from '../core/lines'
import { checkSubstituteMare } from '../core/substitute'
import { buildSubstituteMares } from './inputs'
import { buildRuleSnapshot, type RuleRows, type RuleSnapshot } from './loaders'
import type { Base, MarePlacement, MareSourceKind, WriteWarning } from './records'
import type { Prepared } from './writes'

// 市場母馬的用途：由任務看板的配對推出用途、例外補入與來源，並做 8.3 親系統檢查
// （需求規格 7.3、8.3、8.4；技術設計 4.3「母馬的用途」）。新增市場母馬、修改用途與買回共用

/** 母馬的用途：任務看板上的一條配對（產出第 line 系第 generation 代），或待指定用途 */
export type MareAssignment =
  { kind: 'pairing'; line: LinePosition; generation: number } | { kind: 'unassigned' }

/**
 * 用途的阻止原因：
 * - no-pairing：產出這一系這一代的配對現在不在任務看板上（任務與可開啟分支的配對都沒有）
 * - reason-required：零代市場種牡馬的配對底下例外補入，要填原因（需求規格 7.3、MARE-31）
 */
export type AssignmentBlock = { kind: 'no-pairing' } | { kind: 'reason-required' }

/** 要解析用途的母馬：已有的母馬帶識別，8.3 檢查時不和自己比較；新增的留空 */
export interface AssignedMare {
  horseId?: string
  /** 自身父系所屬：她父馬的子系統 */
  sireSystem?: string
}

/** 8.3 親系統檢查的結果 */
export interface SubstituteWarnings {
  /** 撞到時的警告，要確認 */
  warnings: WriteWarning[]
  /** 自身父系空白或對照表查不到，無法判斷：只提示、不要求確認 */
  parentSystemUnknown: boolean
}

/** 解析後的用途 */
export interface ResolvedAssignment extends SubstituteWarnings {
  placement: MarePlacement
  /** 由配對推出的母馬來源；待指定用途為 null，由使用者選 */
  sourceKind: MareSourceKind | null
  /** 例外補入的原因（去掉前後空白）；不是例外補入時留空 */
  exceptionReason?: string
}

/**
 * 解析市場母馬的用途（技術設計 4.3「母馬的用途」）。配對要在任務看板的任務（含暫停中的）
 * 或可開啟分支的配對中，一個產出只有一條配對，已宣告補公系時就是補公系配對。由配對推出：
 * 母馬群是起點時為第 1 系起點用，否則為替代配對母馬群的系與代數；種牡馬是零代而且不是建系起點時
 * 為例外補入，警告並確認、原因必填；替代母馬另做 8.3 親系統檢查。
 * rows 是在寫入交易內以 readRuleRows 讀到的資料列。
 */
export function resolveAssignment(
  rows: RuleRows,
  assignment: MareAssignment,
  mare: AssignedMare,
  exceptionReason: string | undefined,
): Prepared<ResolvedAssignment, AssignmentBlock> {
  if (assignment.kind === 'unassigned') {
    return {
      ok: true,
      value: {
        placement: { usage: 'unassigned' },
        sourceKind: null,
        warnings: [],
        parentSystemUnknown: false,
      },
    }
  }
  const snapshot = buildRuleSnapshot(rows)
  const pairing = findPairing(snapshot, assignment.line, assignment.generation)
  if (!pairing) return { ok: false, blocks: [{ kind: 'no-pairing' }] }
  const exception = pairing.sire.generation === 0 && pairing.kind !== 'start'
  const reason = exceptionReason?.trim() ?? ''
  if (exception && reason === '') return { ok: false, blocks: [{ kind: 'reason-required' }] }

  const { mares } = pairing
  const placement: MarePlacement =
    mares.kind === 'start'
      ? { usage: 'start', groupLine: 1, groupGeneration: 0 }
      : { usage: 'substitute', groupLine: mares.line, groupGeneration: mares.generation }
  const check =
    mares.kind === 'group'
      ? substituteWarnings(rows, snapshot, mares.line, mares.generation, mare)
      : { warnings: [], parentSystemUnknown: false }
  const warnings: WriteWarning[] = [
    ...(exception ? [{ kind: 'exception-entry' as const, ...pairing.output }] : []),
    ...check.warnings,
  ]
  return {
    ok: true,
    value: {
      placement,
      sourceKind: sourceKindOf(pairing, rows),
      ...(exception ? { exceptionReason: reason } : {}),
      warnings,
      parentSystemUnknown: check.parentSystemUnknown,
    },
  }
}

/**
 * 替代第 forLine 系第 forGeneration 代的市場母馬的親系統檢查（需求規格 8.3）：
 * 同一代的其他替代母馬包含已離圈的，不含她自己。撞到時警告並確認；自身父系未知時只提示
 */
export function substituteWarnings(
  rows: RuleRows,
  snapshot: RuleSnapshot,
  forLine: LinePosition,
  forGeneration: number,
  mare: AssignedMare,
): SubstituteWarnings {
  const others = buildSubstituteMares(rows.mares, rows.horses, forGeneration, mare.horseId)
  const check = checkSubstituteMare(
    { forLine, forGeneration, ownSireSystem: mare.sireSystem },
    snapshot.systemTable,
    snapshot.lineSystems,
    others,
  )
  return {
    warnings:
      check.conflicts.length > 0
        ? [
            {
              kind: 'substitute-parent-system',
              line: forLine,
              generation: forGeneration,
              conflicts: check.conflicts,
            },
          ]
        : [],
    parentSystemUnknown: check.unknown,
  }
}

/** 任務（含暫停中的）與可開啟分支的配對中，產出第 line 系第 generation 代的那一條 */
function findPairing(
  snapshot: RuleSnapshot,
  line: LinePosition,
  generation: number,
): DesignatedPairing | undefined {
  const board = listBoard(snapshot.eightLines)
  return [
    ...board.tasks.map((task) => task.pairing),
    ...board.openableBranches.flatMap((branch) => branch.pairings),
  ].find((pairing) => pairing.output.line === line && pairing.output.generation === generation)
}

/**
 * 由配對推出的母馬來源（需求規格 8.1、7.6）：補公系配對，或配對的母馬群已宣告補母系（未撤銷）時
 * 為市場補系；否則建系起點、推進原系與建立新系為市場創系，循環為市場補血
 */
function sourceKindOf(pairing: DesignatedPairing, rows: RuleRows): MareSourceKind {
  const { mares } = pairing
  const damRestored =
    mares.kind === 'group' &&
    rows.restorations.some(
      (row) =>
        !row.revoked &&
        row.side === 'dam' &&
        row.line === mares.line &&
        row.generation === mares.generation,
    )
  if (pairing.kind === 'restore' || damRestored) return 'market-restoration'
  return pairing.kind === 'cycle' ? 'market-supplement' : 'market-founding'
}

const BASES: readonly Base[] = [32, 33, 34, 35]

/** 據點要是繋養牧場番号 32～35（第 3 章）；畫面只提供這四個，其他值丟出錯誤 */
export function assertBase(location: Base): void {
  if (!BASES.includes(location)) throw new Error(`據點不符：${location}`)
}
