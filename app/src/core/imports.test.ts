import { describe, expect, it } from 'vitest'
import { isGameTiming } from './imports'

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
