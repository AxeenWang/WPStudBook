import { describe, expect, it } from 'vitest'
import {
  SUB_ABILITY_GRADES,
  checkSubAbilityTotal,
  foalDisplayName,
  gradeValue,
  isSubAbilityGrade,
  subAbilityTotal,
  trackingName,
  type SubAbilities,
} from './foal'

describe('trackingName', () => {
  it('母馬名加完整出生年', () => {
    expect(trackingName('オオトリモナーコス', 1990)).toBe('オオトリモナーコス1990')
  })

  it('母馬名空白或出生年不合理時丟出錯誤', () => {
    expect(() => trackingName(' ', 1990)).toThrow(RangeError)
    expect(() => trackingName('オオトリモナーコス', 1990.5)).toThrow(RangeError)
  })
})

describe('foalDisplayName', () => {
  it('有正式馬名時顯示正式馬名', () => {
    expect(foalDisplayName('ハイセイコー', 'ハイユウ', 1970)).toBe('ハイセイコー')
  })

  it('沒有或清空正式馬名時回退追蹤名', () => {
    expect(foalDisplayName(undefined, 'ハイユウ', 1970)).toBe('ハイユウ1970')
    expect(foalDisplayName('', 'ハイユウ', 1970)).toBe('ハイユウ1970')
  })
})

describe('副能力等級', () => {
  it('G=0 起每升一級加 1，共 16 級，S+=15', () => {
    expect(SUB_ABILITY_GRADES).toHaveLength(16)
    expect(gradeValue('G')).toBe(0)
    expect(gradeValue('G+')).toBe(1)
    expect(gradeValue('F')).toBe(2)
    expect(gradeValue('S')).toBe(14)
    expect(gradeValue('S+')).toBe(15)
  })

  it('只接受 G～S+ 的等級文字', () => {
    expect(isSubAbilityGrade('A+')).toBe(true)
    expect(isSubAbilityGrade('SS')).toBe(false)
    expect(isSubAbilityGrade('')).toBe(false)
  })
})

describe('subAbilityTotal', () => {
  const full: SubAbilities = {
    power: 'S+',
    burst: 'S+',
    guts: 'S+',
    flexibility: 'S+',
    spirit: 'S+',
    wisdom: 'S+',
    health: 'S+',
  }

  it('七項齊全時合計，最高 105、最低 0', () => {
    expect(subAbilityTotal(full)).toBe(105)
    expect(
      subAbilityTotal({
        power: 'G',
        burst: 'G',
        guts: 'G',
        flexibility: 'G',
        spirit: 'G',
        wisdom: 'G',
        health: 'G',
      }),
    ).toBe(0)
  })

  it('缺任何一項時為 null', () => {
    expect(subAbilityTotal({ ...full, health: undefined })).toBeNull()
  })
})

describe('checkSubAbilityTotal', () => {
  const abilities: SubAbilities = {
    power: 'C',
    burst: 'D+',
    guts: 'B',
    flexibility: 'E',
    spirit: 'C+',
    wisdom: 'F+',
    health: 'D',
  }

  it('算出的值與匯入值相同時不警告，不同時警告', () => {
    // C=8、D+=7、B=10、E=4、C+=9、F+=3、D=6，合計 47
    expect(checkSubAbilityTotal(abilities, 47)).toEqual({ total: 47, mismatch: false })
    expect(checkSubAbilityTotal(abilities, 42)).toEqual({ total: 47, mismatch: true })
  })

  it('七項不齊或沒有匯入值時不比對', () => {
    expect(checkSubAbilityTotal({ ...abilities, power: undefined }, 42)).toEqual({
      total: null,
      mismatch: false,
    })
    expect(checkSubAbilityTotal(abilities, undefined)).toEqual({ total: 47, mismatch: false })
  })
})
