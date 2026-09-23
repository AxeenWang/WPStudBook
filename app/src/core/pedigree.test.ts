import { describe, expect, it } from 'vitest'
import { horseNode } from '../../tests/support/pedigree'
import { ancestorsAt, duplicateAncestors } from './pedigree'

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

  it('沒有重複時回傳空陣列', () => {
    const mating = { sire: horseNode('F', { sire: horseNode('FF') }), dam: horseNode('M') }
    expect(duplicateAncestors(mating)).toEqual([])
  })
})
