import { describe, expect, it } from 'vitest'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  restorationRow,
  stallionRow,
  startMareRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../../tests/support/rows'
import { LINE_POSITIONS, type LinePosition } from '../core/lines'
import { DEFAULT_MARE_AGE_SETTINGS, type MareAgeSettings } from '../core/mares'
import type { HorseRow, MareRow } from './records'
import {
  buildEightLineSnapshot,
  buildLineSystems,
  buildSystemTable,
  damRoleOf,
  stallionState,
  type EightLineRows,
} from './snapshot'

/** 目前遊戲年 */
const YEAR = 1990

/** 母馬的馬匹資料；出生年預設 1985（1990 年 5 歲），birthYears 可以另外指定或設為不明 */
function horsesOf(
  mares: readonly MareRow[],
  birthYears: Record<string, number | undefined> = {},
): HorseRow[] {
  return mares.map((mare) =>
    horseRow(mare.horseId, {
      birthYear: mare.horseId in birthYears ? birthYears[mare.horseId] : 1985,
    }),
  )
}

/** 彙整快照；沒寫到的資料表為空 */
function build(
  rows: Partial<EightLineRows>,
  settings: MareAgeSettings = DEFAULT_MARE_AGE_SETTINGS,
) {
  return buildEightLineSnapshot(
    { lines: [], stallions: [], mares: [], horses: [], restorations: [], ...rows },
    YEAR,
    settings,
  )
}

/** 只有母馬（與她們的馬匹資料）時的快照 */
function buildMares(mares: MareRow[], settings?: MareAgeSettings) {
  return build({ mares, horses: horsesOf(mares) }, settings)
}

function lineOf(snapshot: ReturnType<typeof build>, line: LinePosition) {
  return snapshot.lines[line - 1]!
}

describe('buildSystemTable', () => {
  it('對照表原樣轉換；沒有分出來源時不帶這個欄位', () => {
    expect(
      buildSystemTable([
        { gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
        {
          gameId: GAME,
          subsystem: 'ノーザンダンサー',
          parentSystem: 'ノーザンダンサー',
          origin: 'ニアークティック',
        },
      ]),
    ).toStrictEqual([
      { subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
      {
        subsystem: 'ノーザンダンサー',
        parentSystem: 'ノーザンダンサー',
        origin: 'ニアークティック',
      },
    ])
  })
})

describe('buildLineSystems', () => {
  it('固定八筆：已開啟的系子系統取系位置、親系統查對照表，查不到時留空；未開啟的系都留空', () => {
    const lines = [lineRow(1, 'マンノウォー'), lineRow(2, '未登錄系統')]
    const table = [{ subsystem: 'マンノウォー', parentSystem: 'マッチェム' }]
    expect(buildLineSystems(lines, table)).toEqual([
      { line: 1, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
      { line: 2, subsystem: '未登錄系統', parentSystem: null },
      ...[3, 4, 5, 6, 7, 8].map((line) => ({ line, subsystem: null, parentSystem: null })),
    ])
  })

  it('對照表更新升格後，親系統跟著改（LINE-04）', () => {
    const lines = [lineRow(1, 'ナスルーラ')]
    const before = buildLineSystems(lines, [
      { subsystem: 'ナスルーラ', parentSystem: 'ファラリス' },
    ])
    const after = buildLineSystems(lines, [{ subsystem: 'ナスルーラ', parentSystem: 'ナスルーラ' }])
    expect(before[0]).toEqual({ line: 1, subsystem: 'ナスルーラ', parentSystem: 'ファラリス' })
    expect(after[0]).toEqual({ line: 1, subsystem: 'ナスルーラ', parentSystem: 'ナスルーラ' })
  })
})

describe('stallionState', () => {
  it('有在崗的為在崗；否則有預定後繼為已指定；否則為已離場；沒有任用時為 undefined', () => {
    expect(stallionState([])).toBeUndefined()
    expect(
      stallionState([stallionRow('A', 1, 3, { status: 'replaced' }), stallionRow('B', 1, 3)]),
    ).toBe('active')
    expect(
      stallionState([
        stallionRow('A', 1, 3, { status: 'retired' }),
        stallionRow('B', 1, 3, { status: undefined, readiness: 'racing' }),
      ]),
    ).toBe('waiting')
    expect(
      stallionState([
        stallionRow('A', 1, 3, { status: 'retired' }),
        stallionRow('B', 1, 3, { status: 'withdrawn' }),
        stallionRow('C', 1, 3, { status: 'replaced' }),
      ]),
    ).toBe('ended')
  })
})

describe('damRoleOf', () => {
  it('自家、替代與起點母馬轉成規則身分；待指定用途與自由配種所生不屬於母馬群', () => {
    expect(damRoleOf(ownMareRow('A', 3, 3))).toEqual({ kind: 'own', line: 3, generation: 3 })
    expect(damRoleOf(substituteMareRow('B', 2, 4))).toEqual({
      kind: 'substitute',
      forLine: 2,
      forGeneration: 4,
    })
    expect(damRoleOf(startMareRow('C'))).toEqual({ kind: 'start' })
    expect(damRoleOf(ungroupedMareRow('D', 'unassigned'))).toBeNull()
    expect(damRoleOf(ungroupedMareRow('E', 'free'))).toBeNull()
  })

  it('用途與母馬群欄位矛盾時丟出錯誤', () => {
    expect(() => damRoleOf(ownMareRow('A', 3, 3, { groupLine: undefined }))).toThrow(RangeError)
    expect(() => damRoleOf(substituteMareRow('B', 2, 4, { groupGeneration: undefined }))).toThrow(
      RangeError,
    )
    expect(() => damRoleOf(startMareRow('C', { groupLine: 2 }))).toThrow(RangeError)
    expect(() => damRoleOf(ungroupedMareRow('D', 'unassigned', { groupLine: 1 }))).toThrow(
      RangeError,
    )
  })
})

describe('buildEightLineSnapshot', () => {
  it('沒有開啟的系：未開啟，也沒有種牡馬、母馬群與補系', () => {
    expect(build({}).lines).toEqual(
      LINE_POSITIONS.map((line) => ({
        line,
        opened: false,
        stallions: [],
        mareGroups: [],
        restorations: [],
      })),
    )
  })

  it('種牡馬依代數分格；尚未誕生的預定後繼為已指定；補公系補入的任用不算進該系的格', () => {
    const snapshot = build({
      lines: [lineRow(5, '系5子')],
      stallions: [
        stallionRow('U', 5, 13, { horseId: undefined, breedingId: 'B1', status: undefined }),
        stallionRow('Z', 5, 0, { status: 'retired' }),
        stallionRow('S12', 5, 12, { status: 'retired' }),
        stallionRow('R', 5, 0, { restorationId: 'R1' }),
      ],
      restorations: [restorationRow('R1', 5, 12, 'sire')],
    })
    expect(lineOf(snapshot, 5).opened).toBe(true)
    expect(lineOf(snapshot, 5).stallions).toEqual([
      { generation: 0, state: 'ended' },
      { generation: 12, state: 'ended' },
      { generation: 13, state: 'waiting' },
    ])
  })

  it('自家母駒依系與代數分群，替代母馬算進她替代的母馬群，起點母馬在第 1 系 0 代；待指定用途與自由配種所生不分群', () => {
    const snapshot = buildMares([
      ownMareRow('O1', 3, 3),
      substituteMareRow('S1', 3, 3),
      substituteMareRow('S2', 3, 2),
      startMareRow('P1'),
      startMareRow('P2'),
      ungroupedMareRow('U1', 'unassigned'),
      ungroupedMareRow('F1', 'free'),
    ])
    expect(lineOf(snapshot, 1).mareGroups).toEqual([
      { generation: 0, established: false, activeMares: 2, ownMares: 0 },
    ])
    expect(lineOf(snapshot, 3).mareGroups).toEqual([
      { generation: 2, established: false, activeMares: 1, ownMares: 0 },
      { generation: 3, established: true, activeMares: 2, ownMares: 1 },
    ])
    for (const line of [2, 4, 5, 6, 7, 8] as const) {
      expect(lineOf(snapshot, line).mareGroups).toEqual([])
    }
  })

  it('以暫定或正式保留轉入時該代成立；只有替代母馬或以候選轉入時未成立；母馬全部離圈仍然成立而且列出', () => {
    const snapshot = buildMares([
      ownMareRow('A', 2, 2, { herd: 'sold', sisterStatus: 'sold' }),
      ownMareRow('B', 2, 3, { sisterStatus: 'candidate', establishedGeneration: false }),
      substituteMareRow('C', 4, 3),
    ])
    expect(lineOf(snapshot, 2).mareGroups).toEqual([
      { generation: 2, established: true, activeMares: 0, ownMares: 0 },
      { generation: 3, established: false, activeMares: 1, ownMares: 1 },
    ])
    expect(lineOf(snapshot, 4).mareGroups).toEqual([
      { generation: 3, established: false, activeMares: 1, ownMares: 0 },
    ])
  })

  it('列入任務：在圈、未達定年，自家母駒還要是暫定保留、候選或正式保留；自家母馬另計', () => {
    const mares = [
      ownMareRow('A', 1, 2),
      ownMareRow('B', 1, 2, { sisterStatus: 'candidate' }),
      ownMareRow('C', 1, 2, { sisterStatus: 'kept' }),
      ownMareRow('D', 1, 2, { sisterStatus: 'replaced' }),
      ownMareRow('E', 1, 2, { herd: 'sold', sisterStatus: 'sold' }),
      substituteMareRow('F', 1, 2),
      substituteMareRow('G', 1, 2, { herd: 'retired' }),
      ownMareRow('H', 1, 2),
    ]
    const rows = { mares, horses: horsesOf(mares, { H: 1965 }) }
    expect(lineOf(build(rows), 1).mareGroups).toEqual([
      { generation: 2, established: true, activeMares: 4, ownMares: 3 },
    ])
    const later = { ...DEFAULT_MARE_AGE_SETTINGS, retirementAge: 26 }
    expect(lineOf(build(rows, later), 1).mareGroups).toEqual([
      { generation: 2, established: true, activeMares: 5, ownMares: 4 },
    ])
  })

  it('馬齡不明時當作未達定年', () => {
    const mares = [ownMareRow('A', 1, 1)]
    const snapshot = build({ mares, horses: horsesOf(mares, { A: undefined }) })
    expect(lineOf(snapshot, 1).mareGroups).toEqual([
      { generation: 1, established: true, activeMares: 1, ownMares: 1 },
    ])
  })

  it('補系不含已撤銷的宣告，依代數排序、同一代補公系在前；補公系的種牡馬只看屬於這次補系的任用', () => {
    const snapshot = build({
      lines: [lineRow(5, '系5子')],
      stallions: [
        stallionRow('W', 5, 0),
        stallionRow('X', 5, 0, { restorationId: 'R1', status: 'retired' }),
        stallionRow('Y', 5, 0, { restorationId: 'R1' }),
        stallionRow('Z', 5, 0, { restorationId: 'R3' }),
      ],
      restorations: [
        restorationRow('R2', 5, 12, 'dam'),
        restorationRow('R1', 5, 12, 'sire'),
        restorationRow('R3', 5, 10, 'sire', { revoked: true }),
        restorationRow('R4', 5, 14, 'sire'),
      ],
    })
    expect(lineOf(snapshot, 5).restorations).toStrictEqual([
      { side: 'sire', generation: 12, stallion: 'active' },
      { side: 'dam', generation: 12 },
      { side: 'sire', generation: 14 },
    ])
    expect(lineOf(snapshot, 5).stallions).toEqual([{ generation: 0, state: 'active' }])
  })

  it('在圈母馬找不到馬匹資料、自家母駒缺少接替狀態時丟出錯誤；不在圈的母馬不查馬匹資料', () => {
    expect(() => build({ mares: [ownMareRow('A', 1, 1)] })).toThrow('找不到母馬的馬匹資料：A')
    const noStatus = [ownMareRow('B', 1, 1, { sisterStatus: undefined })]
    expect(() => build({ mares: noStatus, horses: horsesOf(noStatus) })).toThrow(
      '自家母駒缺少接替狀態：B',
    )
    expect(() =>
      build({ mares: [ownMareRow('C', 1, 1, { herd: 'sold', sisterStatus: 'sold' })] }),
    ).not.toThrow()
  })
})
