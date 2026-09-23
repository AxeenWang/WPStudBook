import { describe, expect, it } from 'vitest'
import { horseNode, matingWithGrandparents } from '../../tests/support/pedigree'
import { eightLineSystems, subsystemOfLine } from '../../tests/support/systems'
import { checkPedigree, estimateVitality } from './vitality'

const { table, lines } = eightLineSystems()

/** 3 代前 8 個位置剛好是八系各一系 */
const eightDistinct = matingWithGrandparents([
  { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
  { sire: subsystemOfLine(3), dam: subsystemOfLine(4) },
  { sire: subsystemOfLine(5), dam: subsystemOfLine(6) },
  { sire: subsystemOfLine(7), dam: subsystemOfLine(8) },
])

describe('estimateVitality', () => {
  it('8 個位置都判斷得出來時給確定的種數', () => {
    expect(estimateVitality(eightDistinct, table, lines)).toMatchObject({
      count: 8,
      status: 'exact',
      established: true,
      missingLines: [],
      unknownSlots: [],
    })
  })

  it('有重複的親系統時種數變少，並列出還缺的系', () => {
    const withDuplicate = matingWithGrandparents([
      { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
      { sire: subsystemOfLine(3), dam: subsystemOfLine(4) },
      { sire: subsystemOfLine(5), dam: subsystemOfLine(5) },
      { sire: subsystemOfLine(7), dam: subsystemOfLine(8) },
    ])
    expect(estimateVitality(withDuplicate, table, lines)).toMatchObject({
      count: 7,
      status: 'exact',
      missingLines: [6],
    })
  })

  it('有未知位置但已知 6 種以上時為「至少 N 種」', () => {
    const someUnknown = matingWithGrandparents([
      { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
      { sire: subsystemOfLine(3), dam: subsystemOfLine(4) },
      { sireSystem: subsystemOfLine(5), buildPhaseMarket: true },
      { sireSystem: subsystemOfLine(7), buildPhaseMarket: true },
    ])
    expect(estimateVitality(someUnknown, table, lines)).toMatchObject({
      count: 6,
      status: 'at-least',
      established: true,
      missingLines: [6, 8],
      unknownSlots: [5, 7],
    })
  })

  it('已知不到 6 種又有未知位置時為資料不足', () => {
    const few = matingWithGrandparents([
      { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
      { sire: subsystemOfLine(3) },
      {},
      {},
    ])
    expect(estimateVitality(few, table, lines)).toMatchObject({
      count: 3,
      status: 'insufficient',
      established: false,
    })
  })

  it('對照表查不到的子系統算未知', () => {
    const unlisted = matingWithGrandparents([
      { sire: '沒登錄的系', dam: subsystemOfLine(2) },
      { sire: subsystemOfLine(3), dam: subsystemOfLine(4) },
      { sire: subsystemOfLine(5), dam: subsystemOfLine(6) },
      { sire: subsystemOfLine(7), dam: subsystemOfLine(8) },
    ])
    expect(estimateVitality(unlisted, table, lines)).toMatchObject({
      count: 7,
      status: 'at-least',
      unknownSlots: [0],
    })
  })
})

describe('checkPedigree', () => {
  it('建系期不計算活血，也不警告', () => {
    const few = matingWithGrandparents([{}, {}, {}, {}])
    expect(checkPedigree(4, few, table, lines)).toEqual({
      estimate: null,
      duplicates: [],
      warnings: [],
    })
  })

  it('循環期 8 種且沒有重複時沒有警告', () => {
    expect(checkPedigree(6, eightDistinct, table, lines).warnings).toEqual([])
  })

  it('已知資料就少於 8 種時要確認', () => {
    const withDuplicate = matingWithGrandparents([
      { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
      { sire: subsystemOfLine(3), dam: subsystemOfLine(4) },
      { sire: subsystemOfLine(5), dam: subsystemOfLine(5) },
      { sire: subsystemOfLine(7), dam: subsystemOfLine(8) },
    ])
    expect(checkPedigree(6, withDuplicate, table, lines).warnings).toEqual([
      { kind: 'vitality-below-max', hintOnly: false },
    ])
  })

  it('4 代內有重複的馬時要確認', () => {
    const shared = horseNode('S', { sireSystem: subsystemOfLine(1) })
    const inbred = { sire: horseNode('F', { sire: shared }), dam: horseNode('M', { sire: shared }) }
    expect(checkPedigree(6, inbred, table, lines)).toMatchObject({
      duplicates: [
        { horse: { id: 'S', sireSystem: subsystemOfLine(1) }, generations: [2], count: 2 },
      ],
    })
    expect(checkPedigree(6, inbred, table, lines).warnings).toContainEqual({
      kind: 'close-inbreeding',
      hintOnly: false,
    })
  })
})
