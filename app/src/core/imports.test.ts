import { describe, expect, it } from 'vitest'
import { importRecord } from '../../tests/support/imports'
import {
  ANNUAL_TIMINGS,
  compareGamePoints,
  importCategory,
  importProgress,
  isAnnualImport,
  isGameTiming,
  type ImportType,
} from './imports'

describe('isGameTiming', () => {
  it('1～12 月、每月 1～4 週（需求規格 4.1、技術設計 4.3）', () => {
    for (const timing of [
      { month: 1, week: 1 },
      { month: 12, week: 4 },
    ]) {
      expect(isGameTiming(timing)).toBe(true)
    }
    for (const timing of [
      { month: 0, week: 1 },
      { month: 13, week: 1 },
      { month: 1, week: 0 },
      { month: 1, week: 5 },
      { month: 1.5, week: 1 },
      { month: 1, week: 2.5 },
    ]) {
      expect(isGameTiming(timing)).toBe(false)
    }
  })
})

describe('匯入的分類與年度匯入的時點', () => {
  it('年度匯入的時點依類型固定（需求規格 4.1、11.1）', () => {
    expect(ANNUAL_TIMINGS).toStrictEqual({
      'january-two-year-olds': { month: 1, week: 1 },
      'april-foals': { month: 4, week: 1 },
      'may-herd': { month: 5, week: 1 },
      'july-conception': { month: 7, week: 1 },
    })
  })

  it('四種年度匯入、兩種累加匯入、兩種選用匯入（需求規格 11.1）', () => {
    const categories: Record<ImportType, string> = {
      'january-two-year-olds': 'annual',
      'april-foals': 'annual',
      'may-herd': 'annual',
      'july-conception': 'annual',
      candidates: 'accumulative',
      'target-stallion': 'accumulative',
      'october-mares': 'optional',
      'stallion-list': 'optional',
    }
    for (const [type, category] of Object.entries(categories) as [ImportType, string][]) {
      expect(importCategory(type)).toBe(category)
      expect(isAnnualImport(type)).toBe(category === 'annual')
    }
  })
})

describe('compareGamePoints', () => {
  it('先比年，再比月，最後比週', () => {
    const point = (year: number, month: number, week: number) => ({ year, timing: { month, week } })
    expect(compareGamePoints(point(1970, 1, 1), point(1969, 12, 4))).toBeGreaterThan(0)
    expect(compareGamePoints(point(1970, 4, 4), point(1970, 5, 1))).toBeLessThan(0)
    expect(compareGamePoints(point(1970, 5, 1), point(1970, 5, 2))).toBeLessThan(0)
    expect(compareGamePoints(point(1970, 5, 2), point(1970, 5, 2))).toBe(0)
  })
})

describe('importProgress', () => {
  it('沒有年度匯入時沒有進度', () => {
    expect(importProgress([])).toBeUndefined()
    expect(importProgress([importRecord('C', 'candidates', 1970)])).toBeUndefined()
  })

  it('年度匯入紀錄中最晚的年與時點；累加與選用匯入不算（需求規格 11.1）', () => {
    const records = [
      importRecord('J70', 'january-two-year-olds', 1970),
      importRecord('M70', 'may-herd', 1970),
      importRecord('L69', 'july-conception', 1969),
      importRecord('A70', 'april-foals', 1970, { mode: 'catch-up' }),
      importRecord('O70', 'october-mares', 1970, { timing: { month: 10, week: 1 } }),
      importRecord('C71', 'candidates', 1971, { timing: { month: 8, week: 1 } }),
    ]
    expect(importProgress(records)).toStrictEqual({ year: 1970, timing: { month: 5, week: 1 } })
  })

  it('時點取類型固定的時點，不看紀錄裡的時點', () => {
    const records = [importRecord('M70', 'may-herd', 1970, { timing: { month: 5, week: 3 } })]
    expect(importProgress(records)).toStrictEqual({ year: 1970, timing: { month: 5, week: 1 } })
  })
})
