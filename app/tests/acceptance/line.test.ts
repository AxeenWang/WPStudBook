import { describe, expect, it } from 'vitest'
import { listBoard, type Board } from '../../src/core/board'
import { checkDesignatedBreeding } from '../../src/core/check'
import { foalPlacement } from '../../src/core/generation'
import {
  BRANCHES,
  LINE_POSITIONS,
  pairingDistance,
  partnerLine,
  type LinePosition,
} from '../../src/core/lines'
import { entrySisterStatus, establishesGeneration } from '../../src/core/sisters'
import { findParentSystemConflict, summarizeLineSystems } from '../../src/core/systems'
import { checkSubstituteMare } from '../../src/core/substitute'
import { describePairing, pairingOf, snapshotOf, type LineSpec } from '../support/eight-line'
import { eightLineSystems, lineSystemsOf, subsystemOfLine } from '../support/systems'

// 需求規格第 15 章「八系管理（LINE）」中由 core 負責的部分；畫面、匯入與儲存的部分由後續計畫補上

const described = (board: Board, generation?: number): string[] =>
  board.tasks
    .filter((task) => generation === undefined || task.pairing.output.generation === generation)
    .map((task) => describePairing(task.pairing))

describe('八系管理（LINE）', () => {
  it('LINE-08 第 1 系零代 × 起點市場母馬 → 第 1 系 1 代', () => {
    expect(describePairing(pairingOf(1, 1))).toBe('第 1 系 0 代 × 第 1 系起點母馬群 → 第 1 系 1 代')
    expect(foalPlacement({ line: 1, generation: 0 }, { kind: 'start' })).toEqual({
      line: 1,
      generation: 1,
    })
  })

  it('LINE-09 產出 2 代時同時列出推進第 1 系與建立第 2 系兩條配對', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 0: 'active' }, mares: { 0: [false, 2], 1: [true, 1] } },
      }),
    )
    expect(
      board.openableBranches.map((openable) => openable.pairings.map(describePairing)),
    ).toEqual([
      [
        '第 1 系 1 代 × 第 2 系 1 代母馬群 → 第 1 系 2 代',
        '第 2 系 0 代 × 第 1 系 1 代母馬群 → 第 2 系 2 代',
      ],
    ])
  })

  it('LINE-10 產出 3 代第 1、2 系分出第 3、4 系；產出 4 代第 1、3、2、4 系依序分出第 5～8 系', () => {
    const at = (generation: number) =>
      BRANCHES.filter((branch) => branch.outputGeneration === generation).map((branch) => [
        branch.parent,
        branch.newLine,
      ])
    expect(at(3)).toEqual([
      [1, 3],
      [2, 4],
    ])
    expect(at(4)).toEqual([
      [1, 5],
      [3, 6],
      [2, 7],
      [4, 8],
    ])
  })

  it('LINE-11 分支受孕失敗或只產公駒而重試時，系與代數不變，不開啟下一層', () => {
    // 第 1 系還沒有 1 代母駒，也沒有指定 1 代種牡馬
    const board = listBoard(
      snapshotOf({ 1: { opened: true, stallions: { 0: 'active' }, mares: { 0: [false, 3] } } }),
    )
    expect(board.openableBranches).toEqual([])
    expect(described(board)).toEqual(['第 1 系 0 代 × 第 1 系起點母馬群 → 第 1 系 1 代'])
  })

  it('LINE-12 同一層分支分年開啟，晚開分支的系與代數仍正確', () => {
    const early: Partial<Record<LinePosition, LineSpec>> = {
      1: {
        opened: true,
        stallions: { 0: 'active', 1: 'active', 2: 'active' },
        mares: { 0: [false, 1], 1: [true, 2], 2: [true, 2] },
      },
      2: { opened: true, stallions: { 0: 'active' }, mares: { 1: [false, 2], 2: [true, 1] } },
      3: { opened: true, stallions: { 0: 'active' }, mares: { 2: [false, 1] } },
    }
    const before = listBoard(snapshotOf(early))
    expect(
      before.openableBranches.map((openable) => openable.pairings.map(describePairing)),
    ).toEqual([
      [
        '第 2 系 2 代 × 第 4 系 2 代母馬群 → 第 2 系 3 代',
        '第 4 系 0 代 × 第 2 系 2 代母馬群 → 第 4 系 3 代',
      ],
    ])
    expect(described(before, 3)).toContain('第 3 系 0 代 × 第 1 系 2 代母馬群 → 第 3 系 3 代')

    const after = listBoard(
      snapshotOf({ ...early, 4: { opened: true, stallions: { 0: 'active' } } }),
    )
    expect(after.openableBranches).toEqual([])
    expect(described(after, 3)).toEqual([
      '第 1 系 2 代 × 第 3 系 2 代母馬群 → 第 1 系 3 代',
      '第 2 系 2 代 × 第 4 系 2 代母馬群 → 第 2 系 3 代',
      '第 3 系 0 代 × 第 1 系 2 代母馬群 → 第 3 系 3 代',
      '第 4 系 0 代 × 第 2 系 2 代母馬群 → 第 4 系 3 代',
    ])
  })

  it('LINE-13 第 1 系 4 代種牡馬與第 2 系 4 代母馬就緒、其他系未就緒 → 自動出現產出 5 代的任務', () => {
    // 只列出相關的系；循環任務只看前一代的種牡馬與配對系母馬群
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 4: 'active' } },
        2: { opened: true, mares: { 4: [true, 2] } },
      }),
    )
    expect(described(board, 5)).toEqual(['第 1 系 4 代 × 第 2 系 4 代母馬群 → 第 1 系 5 代'])
    expect(board.tasks.find((task) => task.pairing.output.generation === 5)?.sireStatus).toBe(
      'ready',
    )
  })

  it('LINE-14 循環配對：5 代 1↔2、3↔4、5↔7、6↔8；6 代 1↔3、2↔4、5↔6、7↔8；7 代 1↔5、2↔7、3↔6、4↔8；之後重複', () => {
    const pairsAt = (generation: number): string[] => {
      const distance = pairingDistance(generation)
      if (distance === null) throw new Error('循環期一定有配對距離')
      const pairs = LINE_POSITIONS.map((line) => {
        const partner = partnerLine(line, distance)
        return `${Math.min(line, partner)}↔${Math.max(line, partner)}`
      })
      return [...new Set(pairs)].sort()
    }
    const g5 = ['1↔2', '3↔4', '5↔7', '6↔8']
    const g6 = ['1↔3', '2↔4', '5↔6', '7↔8']
    const g7 = ['1↔5', '2↔7', '3↔6', '4↔8']
    expect([5, 6, 7, 8, 9, 10].map(pairsAt)).toEqual([g5, g6, g7, g5, g6, g7])
  })

  it('LINE-17 某代第一匹自家母駒以暫定保留轉入 → 該代立即成立，不必 5 匹或種牡馬就緒', () => {
    const status = entrySisterStatus({ id: 'F1', sireId: 'S', damId: 'D' }, [])
    expect(status).toBe('provisional')
    expect(establishesGeneration(status)).toBe(true)
    // 第 3 系 5 代只有這 1 匹，也還沒有第 3 系 5 代種牡馬：母馬群已成立，配第 3 系 5 代母馬的任務照常出現
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 5: 'active' } },
        3: { opened: true, mares: { 5: [true, 1, 1] } },
      }),
    )
    expect(described(board, 6)).toEqual(['第 1 系 5 代 × 第 3 系 5 代母馬群 → 第 1 系 6 代'])
  })

  it('LINE-18 已成立世代母馬降為 0／5 → 顯示母馬群待補，任務不自動斷血', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 5: 'active' } },
        3: { opened: true, mares: { 5: [true, 0] } },
      }),
    )
    expect(board.tasks.filter((task) => task.pairing.output.generation === 6)).toEqual([
      {
        pairing: pairingOf(1, 6),
        sireStatus: 'ready',
        activeMares: 0,
        ownMares: 0,
        needsMares: true,
        paused: false,
      },
    ])
  })

  it('LINE-23 現任離場且未指定後任 → 任務暫停並顯示缺少現任種牡馬，不自動選馬', () => {
    const board = listBoard(
      snapshotOf({
        1: { opened: true, stallions: { 5: 'ended' } },
        3: { opened: true, mares: { 5: [true, 3] } },
      }),
    )
    expect(board.tasks.filter((task) => task.pairing.output.generation === 6)).toEqual([
      {
        pairing: pairingOf(1, 6),
        sireStatus: 'missing',
        activeMares: 3,
        ownMares: 0,
        needsMares: false,
        paused: true,
      },
    ])
  })

  it('LINE-27 建立產出 3 代的第 3 系時誤選第 1 系 1 代母馬 → 阻止，指出應用第 1 系 2 代母馬', () => {
    expect(
      checkDesignatedBreeding(
        pairingOf(3, 3),
        { line: 3, generation: 0 },
        { kind: 'own', line: 1, generation: 1 },
      ).blocks,
    ).toEqual([{ side: 'dam', expected: { line: 1, generation: 2 }, mismatches: ['generation'] }])
  })

  it('LINE-28 代數計算：第 2 系零代 × 第 1 系 1 代母馬 = 第 2 系 2 代；第 1 系 1 代 × 市場母馬 = 第 1 系 2 代', () => {
    expect(
      foalPlacement({ line: 2, generation: 0 }, { kind: 'own', line: 1, generation: 1 }),
    ).toEqual({ line: 2, generation: 2 })
    expect(
      foalPlacement(
        { line: 1, generation: 1 },
        { kind: 'substitute', forLine: 2, forGeneration: 1 },
      ),
    ).toEqual({ line: 1, generation: 2 })
  })

  it('LINE-33 第 1 系 6 代種牡馬就緒、第 5 系有 6 代母馬 → 7 代任務與 6 代任務並行；上一代母馬全部離圈或種牡馬退出後舊任務結束', () => {
    const lineOne = (tasks: Board['tasks']) =>
      tasks
        .filter((task) => task.pairing.output.line === 1 && task.pairing.output.generation >= 6)
        .map((task) => describePairing(task.pairing))
    const handover: Partial<Record<LinePosition, LineSpec>> = {
      1: { opened: true, stallions: { 5: 'active', 6: 'active' } },
      3: { opened: true, mares: { 5: [true, 2] } },
      5: { opened: true, mares: { 6: [true, 3] } },
    }
    expect(lineOne(listBoard(snapshotOf(handover)).tasks)).toEqual([
      '第 1 系 5 代 × 第 3 系 5 代母馬群 → 第 1 系 6 代',
      '第 1 系 6 代 × 第 5 系 6 代母馬群 → 第 1 系 7 代',
    ])

    const maresGone = { ...handover, 3: { opened: true, mares: { 5: [true, 0] as const } } }
    expect(lineOne(listBoard(snapshotOf(maresGone)).tasks)).toEqual([
      '第 1 系 6 代 × 第 5 系 6 代母馬群 → 第 1 系 7 代',
    ])

    const sireRetired = {
      ...handover,
      1: { opened: true, stallions: { 5: 'ended', 6: 'active' } as const },
    }
    expect(lineOne(listBoard(snapshotOf(sireRetired)).tasks)).toEqual([
      '第 1 系 6 代 × 第 5 系 6 代母馬群 → 第 1 系 7 代',
    ])
  })

  it('LINE-34 母馬配自己的父親或同父兄弟 → 因系或代數不符而阻止', () => {
    // 第 1 系 5 代種牡馬的女兒是第 1 系 6 代母馬
    const daughter = { kind: 'own', line: 1, generation: 6 } as const
    // 配父親：父親的任務是第 1 系 5 代 × 第 3 系 5 代母馬群
    expect(
      checkDesignatedBreeding(pairingOf(1, 6), { line: 1, generation: 5 }, daughter).blocks,
    ).toEqual([
      { side: 'dam', expected: { line: 3, generation: 5 }, mismatches: ['line', 'generation'] },
    ])
    // 配同父兄弟：兄弟的任務是第 1 系 6 代 × 第 5 系 6 代母馬群
    expect(
      checkDesignatedBreeding(pairingOf(1, 7), { line: 1, generation: 6 }, daughter).blocks,
    ).toEqual([{ side: 'dam', expected: { line: 5, generation: 6 }, mismatches: ['line'] }])
  })

  it('LINE-35 建立新系的零代種牡馬例外配市場母馬 → 警告並確認，產駒仍是任務的產出代數；建系起點不需確認', () => {
    // 第 1 系 2 代母馬群只有 1 匹替代母馬、沒有自家母馬：看板列出自家母馬數 0，由使用者判斷不足
    const board = listBoard(
      snapshotOf({
        1: {
          opened: true,
          stallions: { 0: 'active', 1: 'active', 2: 'active' },
          mares: { 2: [true, 1, 0] },
        },
        3: { opened: true, stallions: { 0: 'active' } },
      }),
    )
    expect(board.tasks.find((task) => task.pairing.kind === 'found')).toMatchObject({
      pairing: pairingOf(3, 3),
      activeMares: 1,
      ownMares: 0,
    })

    const substitute = { kind: 'substitute', forLine: 1, forGeneration: 2 } as const
    expect(
      checkDesignatedBreeding(pairingOf(3, 3), { line: 3, generation: 0 }, substitute),
    ).toEqual({ blocks: [], warnings: [{ kind: 'zero-sire-market-mare' }] })
    expect(foalPlacement({ line: 3, generation: 0 }, substitute)).toEqual({
      line: 3,
      generation: 3,
    })
    expect(
      checkDesignatedBreeding(pairingOf(1, 1), { line: 1, generation: 0 }, { kind: 'start' })
        .warnings,
    ).toEqual([])
  })

  it('LINE-03 新系親系統與既有系重複 → 警告並確認，確認後可建立', () => {
    const lines = lineSystemsOf({ 1: ['系1子', 'ナスルーラ'], 2: ['系2子', 'マッチェム'] })
    expect(findParentSystemConflict(lines, 3, 'ナスルーラ')).toEqual({
      parentSystem: 'ナスルーラ',
      lines: [1],
    })
    expect(findParentSystemConflict(lines, 3, 'エクリプス')).toBeNull()
  })

  it('LINE-04 總覽顯示八系親系統種類數與重複的系；對照表更新升格後重複解除', () => {
    const before = lineSystemsOf({
      1: ['系1子', 'ナスルーラ'],
      2: ['系2子', 'ナスルーラ'],
      3: ['系3子', 'マッチェム'],
    })
    expect(summarizeLineSystems(before)).toEqual({
      distinctCount: 2,
      duplicates: [{ parentSystem: 'ナスルーラ', lines: [1, 2] }],
    })
    const after = lineSystemsOf({
      1: ['系1子', 'ナスルーラ'],
      2: ['系2子', 'ボールドルーラー'],
      3: ['系3子', 'マッチェム'],
    })
    expect(summarizeLineSystems(after)).toEqual({ distinctCount: 3, duplicates: [] })
  })

  it('LINE-29 替代第 q 系的市場母馬，親系統與其他已成立系相同 → 警告並確認；與第 q 系相同或八系沒用到 → 不警告', () => {
    const { table, lines } = eightLineSystems()
    const at3 = (forLine: LinePosition, ownSireSystem: string) => ({
      forLine,
      forGeneration: 3,
      ownSireSystem,
    })
    expect(checkSubstituteMare(at3(3, subsystemOfLine(5)), table, lines, []).conflicts).toEqual([
      { kind: 'line', parentSystem: '系5親', lines: [5] },
    ])
    expect(checkSubstituteMare(at3(3, subsystemOfLine(3)), table, lines, []).conflicts).toEqual([])
    const withOutside = [...table, { subsystem: '外來子', parentSystem: '外來親' }]
    expect(checkSubstituteMare(at3(3, '外來子'), withOutside, lines, []).conflicts).toEqual([])
  })

  it('LINE-37 第 1 系升格後，替代第 1 系的市場母馬用第 1 系原本的舊親系統 → 不警告', () => {
    const table = [
      { subsystem: '系1子', parentSystem: '系1子' },
      { subsystem: '舊親系統', parentSystem: '舊親系統' },
    ]
    // 第 1 系升格為自己的親系統，舊親系統已經沒有任何系在用
    const lines = lineSystemsOf({ 1: ['系1子', '系1子'], 2: ['系2子', '系2親'] })
    const mare = { forLine: 1 as const, forGeneration: 3, ownSireSystem: '舊親系統' }
    expect(checkSubstituteMare(mare, table, lines, [])).toEqual({ unknown: false, conflicts: [] })
  })

  it('LINE-38 替代第 5 系與第 7 系的同代市場母馬用同一個八系沒用到的親系統 → 第二匹警告；都替代第 5 系 → 不警告', () => {
    const { table: base, lines } = eightLineSystems()
    const table = [...base, { subsystem: '外來子', parentSystem: '外來親' }]
    const first = { forLine: 5 as const, forGeneration: 3, ownSireSystem: '外來子' }
    const secondOtherLine = { forLine: 7 as const, forGeneration: 3, ownSireSystem: '外來子' }
    const secondSameLine = { forLine: 5 as const, forGeneration: 3, ownSireSystem: '外來子' }
    expect(checkSubstituteMare(secondOtherLine, table, lines, [first]).conflicts).toEqual([
      { kind: 'substitute', parentSystem: '外來親', lines: [5] },
    ])
    expect(checkSubstituteMare(secondSameLine, table, lines, [first]).conflicts).toEqual([])
  })
})
