import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARE_AGE_SETTINGS,
  ageInYear,
  defaultAbsenceReason,
  mareAgeNotices,
  mareListedInTasks,
  suggestSellingMother,
} from './mares'

const defaults = DEFAULT_MARE_AGE_SETTINGS

describe('ageInYear', () => {
  it('出生當年為 0 歲，之後每年加 1', () => {
    expect(ageInYear(1965, 1965)).toBe(0)
    expect(ageInYear(1965, 1990)).toBe(25)
  })

  it('年份早於出生年或不是整數時丟出錯誤', () => {
    expect(() => ageInYear(1990, 1989)).toThrow(RangeError)
    expect(() => ageInYear(1990.5, 1991)).toThrow(RangeError)
  })
})

describe('mareAgeNotices', () => {
  it('預設 18 歲起高齡提醒，24 歲另提示最後值得配種，25 歲起只提示已達定年', () => {
    expect([17, 18, 23, 24, 25, 26].map((age) => mareAgeNotices(age, defaults))).toEqual([
      [],
      ['senior'],
      ['senior'],
      ['senior', 'last-breeding'],
      ['retirement-age'],
      ['retirement-age'],
    ])
  })

  it('依使用者調整後的年齡判斷', () => {
    const settings = { retirementAge: 23, seniorAge: 20 }
    expect(mareAgeNotices(19, settings)).toEqual([])
    expect(mareAgeNotices(22, settings)).toEqual(['senior', 'last-breeding'])
    expect(mareAgeNotices(23, settings)).toEqual(['retirement-age'])
  })
})

describe('defaultAbsenceReason', () => {
  it('上次五月的馬齡達定年為定年引退，否則為售出', () => {
    expect(defaultAbsenceReason(25, defaults)).toBe('retired')
    expect(defaultAbsenceReason(24, defaults)).toBe('sold')
  })

  it('馬齡不明時為售出', () => {
    expect(defaultAbsenceReason(undefined, defaults)).toBe('sold')
  })
})

describe('mareListedInTasks', () => {
  it('在圈、未達定年的市場母馬列入任務；馬齡不明時也列入', () => {
    expect(mareListedInTasks({ inHerd: true, age: 10 }, defaults)).toBe(true)
    expect(mareListedInTasks({ inHerd: true }, defaults)).toBe(true)
  })

  it('不在圈內或已達定年的不列入', () => {
    expect(mareListedInTasks({ inHerd: false, age: 10 }, defaults)).toBe(false)
    expect(mareListedInTasks({ inHerd: true, age: 25 }, defaults)).toBe(false)
  })

  it('自家母駒還要看接替狀態', () => {
    expect(mareListedInTasks({ inHerd: true, age: 5, sisterStatus: 'candidate' }, defaults)).toBe(
      true,
    )
    expect(mareListedInTasks({ inHerd: true, age: 5, sisterStatus: 'replaced' }, defaults)).toBe(
      false,
    )
  })
})

describe('suggestSellingMother', () => {
  it('女兒暫定或正式保留、而且母親今年已生產時提示', () => {
    expect(suggestSellingMother(['provisional'], true)).toBe(true)
    expect(suggestSellingMother(['replaced', 'kept'], true)).toBe(true)
  })

  it('母親今年沒生產，或女兒只是候選、已被取代時不提示', () => {
    expect(suggestSellingMother(['provisional'], false)).toBe(false)
    expect(suggestSellingMother(['candidate', 'replaced'], true)).toBe(false)
    expect(suggestSellingMother([], true)).toBe(false)
  })
})
