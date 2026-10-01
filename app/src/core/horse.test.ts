import { describe, expect, it } from 'vitest'
import { isBase, isConception, isSurfaceAptitude } from './horse'

describe('isSurfaceAptitude', () => {
  it('只接受 ◎○△× 四種符號（需求規格 4.7）', () => {
    for (const text of ['◎', '○', '△', '×']) expect(isSurfaceAptitude(text)).toBe(true)
    for (const text of ['〇', '◯', '◎ ', '', 'A']) expect(isSurfaceAptitude(text)).toBe(false)
  })
})

describe('isConception', () => {
  it('只接受受胎狀態的四種文字（需求規格 9.1）', () => {
    for (const text of ['空胎', '受胎', '不受胎', '未確認']) expect(isConception(text)).toBe(true)
    for (const text of ['受胎 ', '空', '確認', '']) expect(isConception(text)).toBe(false)
  })
})

describe('isBase', () => {
  it('只接受自家牧場的據點 32～35（第 3 章）；沒有值時不是', () => {
    for (const code of [32, 33, 34, 35]) expect(isBase(code)).toBe(true)
    for (const code of [31, 36, 0, 32.5, null]) expect(isBase(code)).toBe(false)
  })
})
