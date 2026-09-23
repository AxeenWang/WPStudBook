import { describe, expect, it } from 'vitest'
import { eightLineSystems, subsystemOfLine } from '../../tests/support/systems'
import type { LinePosition } from './lines'
import { checkSubstituteMare } from './substitute'

const { table, lines } = eightLineSystems()

/** 替代第 forLine 系 3 代、自身父系屬於第 ownLine 系的市場母馬 */
const mare = (forLine: LinePosition, ownLine: LinePosition) => ({
  forLine,
  forGeneration: 3,
  ownSireSystem: subsystemOfLine(ownLine),
})

describe('checkSubstituteMare', () => {
  it('親系統與她替代的系相同時不警告', () => {
    expect(checkSubstituteMare(mare(3, 3), table, lines, [])).toEqual({
      unknown: false,
      conflicts: [],
    })
  })

  it('親系統與其他已成立的系相同時回報衝突', () => {
    expect(checkSubstituteMare(mare(3, 5), table, lines, [])).toEqual({
      unknown: false,
      conflicts: [{ kind: 'line', parentSystem: '系5親', lines: [5] }],
    })
  })

  it('八系都沒用到的親系統不警告', () => {
    const outside = { forLine: 3 as const, forGeneration: 3, ownSireSystem: '外來子' }
    const withOutside = [...table, { subsystem: '外來子', parentSystem: '外來親' }]
    expect(checkSubstituteMare(outside, withOutside, lines, [])).toEqual({
      unknown: false,
      conflicts: [],
    })
  })

  it('同一代、替代其他系的市場母馬用同一個親系統時回報衝突', () => {
    const others = [{ forLine: 7 as const, forGeneration: 3, ownSireSystem: '外來子' }]
    const withOutside = [...table, { subsystem: '外來子', parentSystem: '外來親' }]
    const subject = { forLine: 5 as const, forGeneration: 3, ownSireSystem: '外來子' }
    expect(checkSubstituteMare(subject, withOutside, lines, others)).toEqual({
      unknown: false,
      conflicts: [{ kind: 'substitute', parentSystem: '外來親', lines: [7] }],
    })
  })

  it('替代同一系的母馬之間不比較，不同代也不比較', () => {
    const withOutside = [...table, { subsystem: '外來子', parentSystem: '外來親' }]
    const subject = { forLine: 5 as const, forGeneration: 3, ownSireSystem: '外來子' }
    const sameLine = [{ forLine: 5 as const, forGeneration: 3, ownSireSystem: '外來子' }]
    const otherGeneration = [{ forLine: 7 as const, forGeneration: 4, ownSireSystem: '外來子' }]
    expect(checkSubstituteMare(subject, withOutside, lines, sameLine).conflicts).toEqual([])
    expect(checkSubstituteMare(subject, withOutside, lines, otherGeneration).conflicts).toEqual([])
  })

  it('自身父系留空或對照表查不到時只提示', () => {
    expect(checkSubstituteMare({ forLine: 3, forGeneration: 3 }, table, lines, [])).toEqual({
      unknown: true,
      conflicts: [],
    })
    expect(
      checkSubstituteMare(
        { forLine: 3, forGeneration: 3, ownSireSystem: '沒登錄的系' },
        table,
        lines,
        [],
      ),
    ).toEqual({ unknown: true, conflicts: [] })
  })
})
