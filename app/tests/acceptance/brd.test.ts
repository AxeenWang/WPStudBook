import { describe, expect, it } from 'vitest'
import { checkSubAbilityTotal, foalDisplayName, trackingName } from '../../src/core/foal'
import { verifySuccessor } from '../../src/core/successor'

// 需求規格第 15 章「配種與產駒（BRD）」中由 core 負責的部分；繁殖紀錄、匯入與畫面由後續計畫補上

describe('配種與產駒（BRD）', () => {
  it('BRD-07 1990 年出生未命名的產駒 → 顯示 オオトリモナーコス1990', () => {
    expect(trackingName('オオトリモナーコス', 1990)).toBe('オオトリモナーコス1990')
    expect(foalDisplayName(undefined, 'オオトリモナーコス', 1990)).toBe('オオトリモナーコス1990')
  })

  it('BRD-08 補登正式馬名 → 主要顯示正式馬名；清空後回退追蹤名', () => {
    expect(foalDisplayName('ハイセイコー', 'ハイユウ', 1970)).toBe('ハイセイコー')
    expect(foalDisplayName('', 'ハイユウ', 1970)).toBe('ハイユウ1970')
  })

  it('BRD-11 輸入七項副能力 → 自動算出 0～105 的 サ；匯入值不符 → 警告', () => {
    const abilities = {
      power: 'A',
      burst: 'A',
      guts: 'A',
      flexibility: 'A',
      spirit: 'A',
      wisdom: 'A',
      health: 'A',
    } as const
    expect(checkSubAbilityTotal(abilities, 84)).toEqual({ total: 84, mismatch: false })
    expect(checkSubAbilityTotal(abilities, 80)).toEqual({ total: 84, mismatch: true })
  })

  it('BRD-15 自由配種產駒 → 不能選為八系後繼', () => {
    expect(
      verifySuccessor(
        { sireId: 'X', damId: 'D35', origin: { kind: 'free' } },
        { line: 1, generation: 6 },
      ),
    ).toEqual([{ mismatch: 'free-breeding' }])
  })
})
