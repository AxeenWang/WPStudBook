import { describe, expect, it } from 'vitest'
import {
  describePairing,
  pairingOf,
  restorationOf,
  snapshotOf,
} from '../../tests/support/eight-line'
import { checkRestoration, listBoard, type Board } from './board'
import { branchOf } from './lines'

const described = (board: Board, generation?: number): string[] =>
  board.tasks
    .filter((task) => generation === undefined || task.pairing.output.generation === generation)
    .map((task) => describePairing(task.pairing))

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

describe('listBoard：斷血補系', () => {
  it('宣告補公系後，產出的那一代改列補公系任務，種牡馬狀態看補入的零代市場種牡馬', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 12: 'active' }, mares: { 12: [true, 3, 3] } },
        5: {
          opened: true,
          stallions: { 11: 'ended' },
          mares: { 12: [true, 2, 2] },
          restorations: [{ side: 'sire', generation: 12, stallion: 'active' }],
        },
      }),
    )
    expect(described(board, 13)).toEqual([
      '第 1 系 12 代 × 第 5 系 12 代母馬群 → 第 1 系 13 代',
      '第 5 系 0 代 × 第 1 系 12 代母馬群 → 第 5 系 13 代',
    ])
    expect(board.tasks.find((task) => task.pairing.kind === 'restore')).toEqual({
      pairing: restorationOf(5, 12),
      sireStatus: 'ready',
      activeMares: 3,
      ownMares: 3,
      needsMares: false,
      paused: false,
    })
  })

  it('補公系還沒選定零代種牡馬時為未指定；補入的種牡馬離場時任務暫停', () => {
    const taskOf = (stallion?: 'ended') =>
      listBoard(
        snapshotOf({
          5: {
            opened: true,
            restorations: [
              stallion
                ? { side: 'sire', generation: 12, stallion }
                : { side: 'sire', generation: 12 },
            ],
          },
        }),
      ).tasks.find((task) => task.pairing.kind === 'restore')
    expect(taskOf()).toMatchObject({ sireStatus: 'unassigned', paused: false })
    expect(taskOf('ended')).toMatchObject({ sireStatus: 'missing', paused: true })
  })

  it('補公系任務也照世代交接結束：下一代任務出現後，補入的種牡馬離場就結束', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, mares: { 12: [true, 2] } },
        5: {
          opened: true,
          stallions: { 13: 'active' },
          restorations: [{ side: 'sire', generation: 12, stallion: 'ended' }],
        },
        7: { opened: true, mares: { 13: [true, 2] } },
      }),
    )
    expect(described(board, 13)).toEqual([])
    expect(described(board, 14)).toEqual(['第 5 系 13 代 × 第 7 系 13 代母馬群 → 第 5 系 14 代'])
  })

  it('補母系：母馬群從未成立，宣告後配它的任務照常出現', () => {
    const specs = {
      1: { opened: true, stallions: { 12: 'active' as const } },
      5: { opened: true, mares: { 12: [false, 0] as const } },
    }
    expect(described(listBoard(snapshotOf(specs)), 13)).toEqual([])
    const board = listBoard(
      snapshotOf({ ...specs, 5: { ...specs[5], restorations: [{ side: 'dam', generation: 12 }] } }),
    )
    expect(described(board, 13)).toEqual(['第 1 系 12 代 × 第 5 系 12 代母馬群 → 第 1 系 13 代'])
    expect(board.tasks.find((task) => task.pairing.output.generation === 13)).toMatchObject({
      activeMares: 0,
      needsMares: false,
      paused: false,
    })
  })

  it('列出補系的狀態：補系任務與是否進行中', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 12: 'active' }, mares: { 13: [true, 1] } },
        5: {
          opened: true,
          restorations: [
            { side: 'dam', generation: 12 },
            { side: 'sire', generation: 12 },
          ],
        },
      }),
    )
    expect(board.restorations).toEqual([
      {
        line: 5,
        generation: 12,
        side: 'sire',
        pairing: restorationOf(5, 12),
        inProgress: true,
      },
      {
        line: 5,
        generation: 12,
        side: 'dam',
        pairing: pairingOf(1, 13),
        inProgress: false,
      },
    ])
  })

  it('補公系結束後解除暫停，分支的推進原系配對仍是補公系配對', () => {
    const board = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active', 2: 'ended', 3: 'waiting' },
          restorations: [{ side: 'sire', generation: 2, stallion: 'active' }],
        },
        2: { opened: true, stallions: { 0: 'active' } },
      }),
    )
    expect(board.openableBranches).toContainEqual({
      branch: branchOf(3),
      pairings: [restorationOf(1, 2), pairingOf(3, 3)],
    })
  })

  it('補公系進行中，較早一層還沒開的分支也不能開；補系結束後照常開啟', () => {
    const restoring = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active', 2: 'ended', 3: 'ended' },
          restorations: [{ side: 'sire', generation: 3, stallion: 'active' }],
        },
      }),
    )
    expect(restoring.openableBranches).toEqual([])

    const done = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active', 2: 'ended', 3: 'ended', 4: 'active' },
          restorations: [{ side: 'sire', generation: 3, stallion: 'active' }],
        },
      }),
    )
    expect(done.openableBranches.map((openable) => openable.branch.newLine)).toEqual([2, 3, 5])
  })

  it('建系期補母系不影響看板，第 4 系的建立新系任務照常出現', () => {
    const specs = { 2: { opened: true }, 4: { opened: true } }
    const before = listBoard(snapshotOf(specs))
    const after = listBoard(
      snapshotOf({ ...specs, 2: { ...specs[2], restorations: [{ side: 'dam', generation: 2 }] } }),
    )
    expect(after.tasks).toEqual(before.tasks)
    expect(after.restorations[0].pairing).toEqual(pairingOf(4, 3))
  })

  it('兩系同代互相補系：第 5 系補公系、第 1 系補母系，母系那一筆的配對是補公系配對', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, restorations: [{ side: 'dam', generation: 12 }] },
        5: { opened: true, restorations: [{ side: 'sire', generation: 12 }] },
      }),
    )
    const damRestoration = board.restorations.find(
      (status) => status.line === 1 && status.side === 'dam',
    )
    expect(damRestoration?.pairing).toEqual(restorationOf(5, 12))
  })

  it('補系的代數不是整數時丟出錯誤', () => {
    expect(() =>
      listBoard(
        snapshotOf({ 5: { opened: true, restorations: [{ side: 'sire', generation: 12.5 }] } }),
      ),
    ).toThrow(RangeError)
  })

  it('補系的代數早於該系成立的代數、該系還沒開啟，或同一代同一方重複時丟出錯誤', () => {
    expect(() =>
      listBoard(
        snapshotOf({ 6: { opened: true, restorations: [{ side: 'sire', generation: 3 }] } }),
      ),
    ).toThrow(RangeError)
    expect(() =>
      listBoard(snapshotOf({ 5: { restorations: [{ side: 'dam', generation: 12 }] } })),
    ).toThrow(RangeError)
    expect(() =>
      listBoard(
        snapshotOf({
          5: {
            opened: true,
            restorations: [
              { side: 'dam', generation: 12 },
              { side: 'dam', generation: 12 },
            ],
          },
        }),
      ),
    ).toThrow(RangeError)
  })
})

describe('checkRestoration', () => {
  const sire = { line: 5, generation: 12, side: 'sire' } as const
  const dam = { line: 5, generation: 12, side: 'dam' } as const

  it('那一代沒有在崗或已指定的種牡馬時可以補公系', () => {
    expect(
      checkRestoration(snapshotOf({ 5: { opened: true, mares: { 12: [true, 1] } } }), sire),
    ).toEqual([])
    expect(
      checkRestoration(snapshotOf({ 5: { opened: true, stallions: { 12: 'ended' } } }), sire),
    ).toEqual([])
  })

  it('該系還沒到達那一代，或下一代已有種牡馬紀錄時不能補公系', () => {
    expect(checkRestoration(snapshotOf({ 5: { opened: true } }), sire)).toEqual([
      { reason: 'not-reached' },
    ])
    expect(
      checkRestoration(
        snapshotOf({ 5: { opened: true, stallions: { 12: 'ended', 13: 'waiting' } } }),
        sire,
      ),
    ).toEqual([{ reason: 'succeeded' }])
  })

  it('多個阻止原因同時出現時依序列出：同一代已宣告補公系，而且種牡馬在崗', () => {
    const declared = snapshotOf({
      5: {
        opened: true,
        stallions: { 12: 'active' },
        restorations: [{ side: 'sire', generation: 12 }],
      },
    })
    expect(checkRestoration(declared, sire)).toEqual([
      { reason: 'declared' },
      { reason: 'sire-available' },
    ])
  })

  it('那一代已有在崗或已指定的種牡馬時不能補公系', () => {
    for (const state of ['active', 'waiting'] as const) {
      expect(
        checkRestoration(snapshotOf({ 5: { opened: true, stallions: { 12: state } } }), sire),
      ).toEqual([{ reason: 'sire-available' }])
    }
  })

  it('母馬群從未成立時可以補母系；已成立時要改用補血', () => {
    expect(
      checkRestoration(snapshotOf({ 5: { opened: true, mares: { 12: [false, 1] } } }), dam),
    ).toEqual([])
    expect(
      checkRestoration(snapshotOf({ 5: { opened: true, mares: { 12: [true, 0] } } }), dam),
    ).toEqual([{ reason: 'mares-established' }])
  })

  it('該系還沒開啟、那一代還沒成立，或同一代同一方已經宣告過時不能宣告', () => {
    expect(checkRestoration(snapshotOf({}), sire)).toEqual([{ reason: 'not-opened' }])
    expect(
      checkRestoration(snapshotOf({ 6: { opened: true } }), {
        line: 6,
        generation: 3,
        side: 'dam',
      }),
    ).toEqual([{ reason: 'not-founded', founding: 4 }])
    const declared = snapshotOf({
      5: {
        opened: true,
        stallions: { 12: 'ended' },
        restorations: [{ side: 'sire', generation: 12 }],
      },
    })
    expect(checkRestoration(declared, sire)).toEqual([{ reason: 'declared' }])
    expect(checkRestoration(declared, dam)).toEqual([])
  })

  it('斷血代數不是 0 以上的整數時丟出錯誤', () => {
    expect(() =>
      checkRestoration(snapshotOf({ 5: { opened: true } }), { ...sire, generation: -1 }),
    ).toThrow(RangeError)
  })
})
