import { describe, expect, it } from 'vitest'
import { duplicateAbilityNumbers, matchHorse } from '../../src/core/identity'
import { correctHorse } from '../../src/storage/horse-writes'
import { returnMare } from '../../src/storage/herd-writes'
import { openLine } from '../../src/storage/line-writes'
import { loadKnownHorses } from '../../src/storage/loaders'
import { addMarketMare } from '../../src/storage/mare-writes'
import { addTestGame, testDatabase } from '../support/database'
import { GAME, horseRow, ungroupedMareRow } from '../support/rows'

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

  it('ID-04 已售出或定年引退的母馬回歸 → 沿用原識別並建立回歸事件', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([
      horseRow('SOLD', { abilityNumber: '0x0100', birthYear: 1980 }),
      horseRow('RETIRED', { abilityNumber: '0x0200', birthYear: 1965 }),
    ])
    await db.mares.bulkAdd([
      ungroupedMareRow('SOLD', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('RETIRED', 'unassigned', { herd: 'retired' }),
    ])
    expect((await returnMare(db, GAME, 'SOLD')).status).toBe('done')
    expect((await returnMare(db, GAME, 'RETIRED')).status).toBe('done')
    expect(await db.horses.count()).toBe(2)
    expect(await db.mares.get('RETIRED')).toMatchObject({ herd: 'in-herd' })
    expect(
      (await db.events.toArray())
        .map((event) => event.kind === 'mare-returned' && `${event.horseId}:${event.from}`)
        .sort(),
    ).toEqual(['RETIRED:retired', 'SOLD:sold'])
  })

  it('ID-08 手動輸入、尚未經匯入確認的馬名可以更正並保存歷程；經匯入確認的馬名不能手動修改', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const added = await addMarketMare(db, GAME, {
      horse: { fullName: 'ハナカコ' },
      assignment: { kind: 'unassigned' },
    })
    if (added.status !== 'done') throw new Error(added.status)
    const id = added.value.horse.id
    expect((await correctHorse(db, GAME, id, { fullName: 'ハナカゴ' })).status).toBe('done')
    expect(await db.horses.get(id)).toMatchObject({ fullName: 'ハナカゴ', baseName: 'ハナカゴ' })
    expect(await db.events.where('[gameId+horseId]').equals([GAME, id]).toArray()).toContainEqual(
      expect.objectContaining({
        kind: 'horse-corrected',
        from: { fullName: 'ハナカコ' },
        to: { fullName: 'ハナカゴ' },
      }),
    )

    await db.horses.update(id, { nameSource: 'import' })
    await expect(correctHorse(db, GAME, id, { fullName: 'ハナカゴ二' })).rejects.toThrow(
      '只有手動輸入、尚未經匯入確認的市場馬可以更正',
    )
  })

  it('ID-13 手動新增的母馬填了父母名與自身父系，五月名單的值不同 → 不算衝突；經匯入確認前這些欄位可以手動更正並保存歷程', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const added = await addMarketMare(db, GAME, {
      horse: {
        fullName: 'ハナカゴ',
        birthYear: 1980,
        sireName: '手動の父',
        damName: '手動の母',
        sireSystem: 'ハイペリオン',
      },
      assignment: { kind: 'unassigned' },
    })
    if (added.status !== 'done') throw new Error(added.status)
    const id = added.value.horse.id
    const incoming = {
      abilityNumber: '0x0100',
      birthYear: 1980,
      name: 'ハナカゴ',
      sireName: '匯入の父',
      damName: '匯入の母',
    }
    expect(matchHorse(incoming, await loadKnownHorses(db, GAME))).toEqual({ kind: 'assisted', id })

    const corrected = await correctHorse(db, GAME, id, {
      sireName: '匯入の父',
      damName: null,
      sireSystem: 'ネアルコ',
      abilityNumber: '0x0100',
    })
    expect(corrected.status).toBe('done')
    expect(await db.horses.get(id)).toMatchObject({
      sireName: '匯入の父',
      sireSystem: 'ネアルコ',
      abilityNumber: '0x0100',
      pedigreeSource: 'manual',
    })
    expect(await db.horses.get(id)).not.toHaveProperty('damName')
  })
})
