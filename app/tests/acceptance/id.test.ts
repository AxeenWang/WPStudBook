import { describe, expect, it } from 'vitest'
import { duplicateAbilityNumbers, matchHorse } from '../../src/core/identity'
import { openLine } from '../../src/storage/line-writes'
import { addTestGame, testDatabase } from '../support/database'
import { GAME } from '../support/rows'

// 需求規格第 15 章「馬匹身分（ID）」中由 core 與儲存層寫入負責的部分；歷程、遊戲局隔離與備份由後續計畫補上

describe('馬匹身分（ID）', () => {
  const known = [
    {
      id: 'H1',
      abilityNumber: '0x4A2F',
      birthYear: 1965,
      name: 'オオトリモナーコス',
      sireName: 'ハクリヨウ',
      damName: 'モナーコス',
    },
  ]

  it('ID-02 能力番号與既有馬相同、出生年不同 → 建立新馬，既有馬不變', () => {
    expect(
      matchHorse({ abilityNumber: '0x4A2F', birthYear: 1990, name: 'ニホンピロウイナー' }, known),
    ).toEqual({ kind: 'new' })
    expect(known[0]).toMatchObject({ id: 'H1', abilityNumber: '0x4A2F', birthYear: 1965 })
  })

  it('ID-03 能力番号與出生年相同，但馬名或父母明顯不符 → 衝突，不套用', () => {
    expect(
      matchHorse({ abilityNumber: '0x4A2F', birthYear: 1965, name: 'ニホンピロウイナー' }, known),
    ).toEqual({ kind: 'conflict', ids: ['H1'], reasons: ['name'] })
    expect(
      matchHorse({ abilityNumber: '0x4A2F', birthYear: 1965, sireName: 'シンザン' }, known),
    ).toEqual({ kind: 'conflict', ids: ['H1'], reasons: ['sire'] })
  })

  it('ID-06 同一檔案內能力番号重複 → 整份停止', () => {
    expect(duplicateAbilityNumbers(['0x0010', '0x0011', '0x0010'])).toEqual(['0x0010'])
  })

  it('ID-07 手動新增、未填能力番号的母馬，以唯一馬名配對 → 補入；既有能力番号不同 → 衝突', () => {
    const incoming = { abilityNumber: '0x0100', birthYear: 1964, name: 'スターロツチ' }
    expect(matchHorse(incoming, [{ id: 'M1', name: 'スターロツチ' }])).toEqual({
      kind: 'assisted',
      id: 'M1',
    })
    expect(
      matchHorse(incoming, [{ id: 'M1', name: 'スターロツチ', abilityNumber: '0x0200' }]),
    ).toEqual({ kind: 'conflict', ids: ['M1'], reasons: ['ability-number'] })
  })

  it('ID-12 能力番号為 0x0000 的馬 → 正常配對，不視為空白或未知', () => {
    const zero = [{ id: 'S1', abilityNumber: '0x0000', birthYear: 1960, name: 'ヒンドスタン' }]
    expect(matchHorse({ abilityNumber: '0x0000', birthYear: 1960 }, zero)).toEqual({
      kind: 'same',
      id: 'S1',
    })
    // 既有紀錄的 0x0000 是已登記的能力番号：以馬名配到時不能當成沒有番号而覆寫
    expect(
      matchHorse({ abilityNumber: '0x0001', birthYear: 1960, name: 'ヒンドスタン' }, zero),
    ).toEqual({ kind: 'conflict', ids: ['S1'], reasons: ['ability-number'] })
  })
})

describe('馬匹身分（ID）：儲存層寫入', () => {
  it('ID-09 帶 (外) 或 [地] 前綴的馬 → 完整馬名與基本馬名都保存，以基本馬名也查得到', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await openLine(db, GAME, {
      line: 1,
      subsystem: 'マンノウォー',
      parentSystem: 'マッチェム',
      color: '#1f77b4',
      stallion: { kind: 'new', horse: { fullName: '(外)ウォーアドミラル' } },
    })
    expect(result.status).toBe('done')
    const found = await db.horses
      .where('[gameId+baseName]')
      .equals([GAME, 'ウォーアドミラル'])
      .toArray()
    expect(found.map((horse) => [horse.fullName, horse.baseName])).toEqual([
      ['(外)ウォーアドミラル', 'ウォーアドミラル'],
    ])
  })
})
