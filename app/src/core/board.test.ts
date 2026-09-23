import { describe, expect, it } from 'vitest'
import { describePairing, pairingOf, snapshotOf } from '../../tests/support/eight-line'
import { listBoard, type Board } from './board'
import { branchOf } from './lines'

const described = (board: Board): string[] =>
  board.tasks.map((task) => describePairing(task.pairing))

describe('listBoard', () => {
  it('新遊戲局只有建系起點可開啟，沒有任務', () => {
    const board = listBoard(snapshotOf({}))
    expect(board.openableBranches).toEqual([{ branch: branchOf(1), pairings: [pairingOf(1, 1)] }])
    expect(board.tasks).toEqual([])
  })

  it('開啟第 1 系後出現起點任務，起點母馬計入第 1 系 0 代母馬群', () => {
    const board = listBoard(
      snapshotOf({ 1: { opened: true, stallions: { 0: 'active' }, mares: { 0: [false, 3] } } }),
    )
    expect(board.openableBranches).toEqual([])
    expect(board.tasks).toEqual([
      {
        pairing: pairingOf(1, 1),
        sireStatus: 'ready',
        activeMares: 3,
        ownMares: 0,
        needsMares: false,
        paused: false,
      },
    ])
  })

  it('指定為種牡馬的公駒也讓該系到達那一代', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 0: 'active', 1: 'waiting' }, mares: { 0: [false, 1] } },
      }),
    )
    expect(board.openableBranches.map((openable) => openable.branch.newLine)).toEqual([2])
    expect(board.tasks.find((task) => task.pairing.kind === 'advance')?.sireStatus).toBe('waiting')
  })

  it('只有替代母馬的母馬群不算到達該代', () => {
    const board = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active' },
          mares: { 0: [false, 1], 1: [true, 1], 2: [true, 1] },
        },
        2: { opened: true, stallions: { 0: 'active' }, mares: { 1: [false, 1], 2: [false, 2] } },
      }),
    )
    expect(board.openableBranches.map((openable) => openable.branch.newLine)).toEqual([3])
  })

  it('開啟新系後出現建立新系任務，母馬來自原系前一代', () => {
    const board = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active' },
          mares: { 0: [false, 2], 1: [true, 2] },
        },
        2: { opened: true, stallions: { 0: 'active' }, mares: { 1: [false, 1] } },
      }),
    )
    expect(board.openableBranches).toEqual([])
    expect(described(board)).toEqual([
      '第 1 系 0 代 × 第 1 系起點母馬群 → 第 1 系 1 代',
      '第 1 系 1 代 × 第 2 系 1 代母馬群 → 第 1 系 2 代',
      '第 2 系 0 代 × 第 1 系 1 代母馬群 → 第 2 系 2 代',
    ])
    expect(board.tasks[2]).toMatchObject({ sireStatus: 'ready', activeMares: 2 })
  })

  it('任務列出母馬群的自家母馬數，建立新系的任務以此判斷自家母馬是否不足', () => {
    const board = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active' },
          mares: { 0: [false, 2], 1: [true, 3, 1] },
        },
        2: { opened: true, stallions: { 0: 'active' }, mares: { 1: [false, 2] } },
      }),
    )
    expect(board.tasks.find((task) => task.pairing.kind === 'found')).toMatchObject({
      activeMares: 3,
      ownMares: 1,
    })
    expect(board.tasks.find((task) => task.pairing.kind === 'advance')).toMatchObject({
      activeMares: 2,
      ownMares: 0,
    })
  })

  it('下一代任務出現後，起點母馬全部離圈就結束起點任務', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 0: 'active' }, mares: { 0: [false, 0], 1: [true, 1] } },
      }),
    )
    expect(described(board)).toEqual(['第 1 系 1 代 × 第 2 系 1 代母馬群 → 第 1 系 2 代'])
  })

  it('零代種牡馬離場時，建立新系任務暫停（缺少目標種牡馬）', () => {
    const board = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active' },
          mares: { 0: [false, 2], 1: [true, 2] },
        },
        2: { opened: true, stallions: { 0: 'ended' } },
      }),
    )
    expect(board.tasks.find((task) => task.pairing.kind === 'found')).toMatchObject({
      sireStatus: 'missing',
      paused: true,
    })
  })

  it('快照缺少系位置或重複時丟出錯誤', () => {
    const { lines } = snapshotOf({})
    expect(() => listBoard({ lines: lines.slice(1) })).toThrow(RangeError)
    expect(() => listBoard({ lines: [...lines, lines[0]] })).toThrow(RangeError)
  })

  it('母馬群的自家母馬數多於列入任務的母馬數時丟出錯誤', () => {
    expect(() =>
      listBoard(snapshotOf({ 1: { opened: true, mares: { 1: [true, 1, 2] } } })),
    ).toThrow(RangeError)
  })
})
