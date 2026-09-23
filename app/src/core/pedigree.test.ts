import { describe, expect, it } from 'vitest'
import { horseNode } from '../../tests/support/pedigree'
import { systemTableOf } from '../../tests/support/systems'
import { ancestorSlots, ancestorsAt, duplicateAncestors } from './pedigree'

describe('ancestorsAt', () => {
  const mating = {
    sire: horseNode('F', { sire: horseNode('FF'), dam: horseNode('FM') }),
    dam: horseNode('M', { sire: horseNode('MF') }),
  }

  it('第 1 代是父母，每往上一代位置加倍', () => {
    expect(ancestorsAt(mating, 1)).toHaveLength(2)
    expect(ancestorsAt(mating, 2)).toHaveLength(4)
    expect(ancestorsAt(mating, 3)).toHaveLength(8)
    expect(ancestorsAt(mating, 4)).toHaveLength(16)
  })

  it('沒有內部紀錄的位置是 null，上面的祖先也都是 null', () => {
    expect(ancestorsAt(mating, 2).map((node) => node?.horse.id ?? null)).toEqual([
      'FF',
      'FM',
      'MF',
      null,
    ])
    expect(ancestorsAt(mating, 3).every((node) => node === null)).toBe(true)
  })

  it('代數不是 1 以上的整數時丟出錯誤', () => {
    expect(() => ancestorsAt(mating, 0)).toThrow(RangeError)
    expect(() => ancestorsAt(mating, 1.5)).toThrow(RangeError)
  })
})

describe('duplicateAncestors', () => {
  it('同一匹馬出現在 4 代內的不同代時列出來', () => {
    const shared = horseNode('S')
    const mating = {
      sire: horseNode('F', { sire: shared }),
      dam: horseNode('M', { sire: horseNode('MF', { sire: shared }) }),
    }
    expect(duplicateAncestors(mating)).toEqual([
      { horse: { id: 'S' }, generations: [2, 3], count: 2 },
    ])
  })

  it('同一代出現兩次也算重複', () => {
    const shared = horseNode('S')
    const mating = { sire: horseNode('F', { sire: shared }), dam: horseNode('M', { sire: shared }) }
    expect(duplicateAncestors(mating)).toEqual([{ horse: { id: 'S' }, generations: [2], count: 2 }])
  })

  it('一邊在第 4 代、另一邊在第 5 代（4×5）不算重複', () => {
    const shared = horseNode('S')
    const mating = {
      // 父方：父、祖父、曾祖父，S 是高祖父（第 4 代）
      sire: horseNode('F', { sire: horseNode('FF', { sire: horseNode('FFF', { sire: shared }) }) }),
      // 母方：母、外祖父、再往上兩代，S 在第 5 代
      dam: horseNode('M', {
        sire: horseNode('MF', {
          sire: horseNode('MFF', { sire: horseNode('MFFF', { sire: shared }) }),
        }),
      }),
    }
    expect(duplicateAncestors(mating)).toEqual([])
  })

  it('沒有重複時回傳空陣列', () => {
    const mating = { sire: horseNode('F', { sire: horseNode('FF') }), dam: horseNode('M') }
    expect(duplicateAncestors(mating)).toEqual([])
  })
})

describe('ancestorSlots', () => {
  const table = systemTableOf([
    ['ノーザンダンサー', 'ノーザンダンサー', 'ネアルコ'],
    ['マンノウォー', 'マッチェム'],
  ])

  it('有內部紀錄的祖先用他自己的父系，共 8 個位置', () => {
    const great = horseNode('GG', { sireSystem: 'マンノウォー' })
    const mating = { sire: horseNode('F', { sire: horseNode('FF', { sire: great }) }), dam: null }
    const slots = ancestorSlots(mating, table)
    expect(slots).toHaveLength(8)
    expect(slots[0]).toEqual({
      index: 0,
      horse: { id: 'GG', sireSystem: 'マンノウォー' },
      subsystem: 'マンノウォー',
      inferred: false,
      fromBuildPhaseMarket: false,
    })
  })

  it('沒有紀錄的父親用子女的父系推定並標示推定；沒有紀錄的母親為未知', () => {
    const market = horseNode('MK', { sireSystem: 'マンノウォー', buildPhaseMarket: true })
    const mating = { sire: horseNode('F', { sire: market }), dam: null }
    const slots = ancestorSlots(mating, table)
    expect(slots[0]).toEqual({
      index: 0,
      horse: null,
      subsystem: 'マンノウォー',
      inferred: true,
      fromBuildPhaseMarket: true,
    })
    expect(slots[1]).toEqual({
      index: 1,
      horse: null,
      subsystem: null,
      inferred: false,
      fromBuildPhaseMarket: true,
    })
  })

  it('子女的父系與子女同名時，父親改用分出來源推定', () => {
    const founder = horseNode('ND', {
      name: 'ノーザンダンサー',
      sireSystem: 'ノーザンダンサー',
    })
    const mating = { sire: horseNode('F', { sire: founder }), dam: null }
    expect(ancestorSlots(mating, table)[0]).toMatchObject({
      subsystem: 'ネアルコ',
      inferred: true,
    })
  })

  it('子女沒有父系時無法推定', () => {
    const mating = { sire: horseNode('F', { sire: horseNode('NoSystem') }), dam: null }
    expect(ancestorSlots(mating, table)[0]).toMatchObject({ subsystem: null, inferred: false })
  })
})
