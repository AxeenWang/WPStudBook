import { describe, expect, it } from 'vitest'
import {
  chooseKeptSister,
  entrySisterStatus,
  establishesGeneration,
  isSister,
  sisterStatusListed,
  type OwnMare,
} from './sisters'

/** 父 S、母 D 的女兒 */
const daughter = (id: string, inHerd: boolean, status: OwnMare['status']): OwnMare => ({
  id,
  sireId: 'S',
  damId: 'D',
  inHerd,
  status,
})

describe('isSister', () => {
  it('父母都相同才是姊妹', () => {
    expect(isSister(daughter('A', true, 'kept'), daughter('B', true, 'candidate'))).toBe(true)
    expect(isSister(daughter('A', true, 'kept'), { id: 'B', sireId: 'S', damId: 'D2' })).toBe(false)
    expect(isSister(daughter('A', true, 'kept'), { id: 'B', sireId: 'S2', damId: 'D' })).toBe(false)
  })

  it('父母不明或同一匹時不算姊妹', () => {
    expect(isSister({ id: 'A', damId: 'D' }, { id: 'B', damId: 'D' })).toBe(false)
    expect(isSister(daughter('A', true, 'kept'), daughter('A', true, 'kept'))).toBe(false)
  })
})

describe('sisterStatusListed', () => {
  it('暫定保留、候選、正式保留列入任務；已被取代、已售出不列入', () => {
    expect(
      (['provisional', 'candidate', 'kept', 'replaced', 'sold'] as const).map(sisterStatusListed),
    ).toEqual([true, true, true, false, false])
  })
})

describe('establishesGeneration', () => {
  it('以暫定保留或正式保留轉入時該代成立，候選不另外成立', () => {
    expect(establishesGeneration('provisional')).toBe(true)
    expect(establishesGeneration('kept')).toBe(true)
    expect(establishesGeneration('candidate')).toBe(false)
  })
})

describe('entrySisterStatus', () => {
  const newcomer = { id: 'B', sireId: 'S', damId: 'D' }

  it('沒有姊妹在圈時為暫定保留', () => {
    expect(entrySisterStatus(newcomer, [])).toBe('provisional')
    expect(entrySisterStatus(newcomer, [daughter('A', false, 'sold')])).toBe('provisional')
  })

  it('已有姊妹在圈時為候選，被取代但仍在圈的姊妹也算', () => {
    expect(entrySisterStatus(newcomer, [daughter('A', true, 'kept')])).toBe('candidate')
    expect(entrySisterStatus(newcomer, [daughter('A', true, 'replaced')])).toBe('candidate')
  })

  it('同父異母或同母異父不算姊妹；自己的舊紀錄不算', () => {
    const halfSister = { id: 'H', sireId: 'S', damId: 'D2', inHerd: true, status: 'kept' as const }
    expect(entrySisterStatus(newcomer, [halfSister])).toBe('provisional')
    expect(entrySisterStatus(newcomer, [daughter('B', true, 'replaced')])).toBe('provisional')
  })

  it('在圈但狀態是已售出的矛盾輸入丟出錯誤', () => {
    expect(() => entrySisterStatus(newcomer, [daughter('A', true, 'sold')])).toThrow(RangeError)
  })
})

describe('chooseKeptSister', () => {
  it('選定的改為正式保留，其他在圈列入任務的姊妹改為已被取代', () => {
    const mares = [daughter('A', true, 'provisional'), daughter('B', true, 'candidate')]
    expect(chooseKeptSister('B', mares)).toEqual([
      { id: 'B', from: 'candidate', to: 'kept' },
      { id: 'A', from: 'provisional', to: 'replaced' },
    ])
  })

  it('可以改選：原本的正式保留改為已被取代', () => {
    const mares = [daughter('A', true, 'replaced'), daughter('B', true, 'kept')]
    expect(chooseKeptSister('A', mares)).toEqual([
      { id: 'A', from: 'replaced', to: 'kept' },
      { id: 'B', from: 'kept', to: 'replaced' },
    ])
  })

  it('已售出、不在圈內與不是姊妹的母馬不變', () => {
    const mares = [
      daughter('A', true, 'candidate'),
      daughter('B', false, 'sold'),
      { id: 'H', sireId: 'S', damId: 'D2', inHerd: true, status: 'kept' as const },
    ]
    expect(chooseKeptSister('A', mares)).toEqual([{ id: 'A', from: 'candidate', to: 'kept' }])
  })

  it('選定的母馬不存在或不在圈內時丟出錯誤', () => {
    expect(() => chooseKeptSister('X', [daughter('A', true, 'kept')])).toThrow(RangeError)
    expect(() => chooseKeptSister('A', [daughter('A', false, 'sold')])).toThrow(RangeError)
  })

  it('在圈但狀態是已售出的矛盾輸入丟出錯誤', () => {
    const mares = [daughter('A', true, 'candidate'), daughter('B', true, 'sold')]
    expect(() => chooseKeptSister('A', mares)).toThrow(RangeError)
  })
})
