import { describe, expect, it } from 'vitest'
import {
  chooseKeptSister,
  entrySisterStatus,
  sisterStatusListed,
  type OwnMare,
  type SisterStatusChange,
} from '../../src/core/sisters'

// 需求規格第 15 章「繁殖牝馬（MARE）」中由 core 負責的部分；卡片、匯入、事件與畫面由後續計畫補上

/** 父 S、母 D 的女兒 */
const daughter = (id: string, inHerd: boolean, status: OwnMare['status']): OwnMare => ({
  id,
  sireId: 'S',
  damId: 'D',
  inHerd,
  status,
})

/** 套用接替狀態的變更 */
const apply = (mares: readonly OwnMare[], changes: readonly SisterStatusChange[]): OwnMare[] =>
  mares.map((mare) => {
    const change = changes.find((entry) => entry.id === mare.id)
    return change ? { ...mare, status: change.to } : mare
  })

describe('繁殖牝馬（MARE）', () => {
  it('MARE-12 同父同母姊妹先後轉入 → 第二匹不被阻止；比較後只能有一匹正式保留，被取代者保留紀錄', () => {
    const elder = daughter('A', true, entrySisterStatus({ id: 'A', sireId: 'S', damId: 'D' }, []))
    const younger = daughter(
      'B',
      true,
      entrySisterStatus({ id: 'B', sireId: 'S', damId: 'D' }, [elder]),
    )
    expect([elder.status, younger.status]).toEqual(['provisional', 'candidate'])

    const decided = apply([elder, younger], chooseKeptSister('B', [elder, younger]))
    expect(decided.filter((mare) => mare.status === 'kept').map((mare) => mare.id)).toEqual(['B'])
    expect(decided.find((mare) => mare.id === 'A')).toMatchObject({ status: 'replaced' })
  })

  it('MARE-24 姊妹一匹暫定保留、一匹候選 → 兩匹都列入任務；其中一匹被取代後只剩另一匹', () => {
    const sisters = [daughter('A', true, 'provisional'), daughter('B', true, 'candidate')]
    expect(
      sisters.filter((mare) => sisterStatusListed(mare.status)).map((mare) => mare.id),
    ).toEqual(['A', 'B'])
    const decided = apply(sisters, chooseKeptSister('A', sisters))
    expect(
      decided.filter((mare) => sisterStatusListed(mare.status)).map((mare) => mare.id),
    ).toEqual(['A'])
  })

  it('MARE-30 妹妹已售出後買回被取代的姊姊 → 姊姊回歸為暫定保留，可改選正式保留；妹妹仍在圈時姊姊為候選', () => {
    const elder = { id: 'A', sireId: 'S', damId: 'D' }
    expect(entrySisterStatus(elder, [daughter('B', false, 'sold')])).toBe('provisional')
    expect(entrySisterStatus(elder, [daughter('B', true, 'kept')])).toBe('candidate')

    const returned = [daughter('A', true, 'candidate'), daughter('B', true, 'kept')]
    expect(chooseKeptSister('A', returned)).toEqual([
      { id: 'A', from: 'candidate', to: 'kept' },
      { id: 'B', from: 'kept', to: 'replaced' },
    ])
  })
})
