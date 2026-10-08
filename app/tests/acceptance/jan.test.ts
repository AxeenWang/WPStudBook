import { describe, expect, it } from 'vitest'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { importProgress } from '../../src/core/imports'
import { cp932 } from '../support/ce-bytes'
import { SAMPLES, exportText } from '../support/ce-files'
import { addTestGame, testDatabase } from '../support/database'
import {
  applyJanuaryFile,
  januaryGame,
  januaryRow,
  ownFoal,
  previewJanuaryFile,
} from '../support/import-flow'
import { GAME, horseRow } from '../support/rows'

// 需求規格第 15 章「一月二歲馬（JAN）」：解析的部分（CE 匯入子計畫 4-1），以及配對與套用（4-3）；
// 實檔的筆數在 tests/local/ce-samples.test.ts

describe('一月二歲馬（JAN）：解析', () => {
  it('JAN-01 匯入 1968年 1月1週._二歲新馬.txt → 以 CP932 讀取 78 欄，忽略尾端空白欄，出生年為 1966', () => {
    const text = exportText('two-year-old', [SAMPLES['two-year-old']])
    const read = readImportFile(cp932(text), '1968年 1月1週._二歲新馬.txt')
    if (read.status !== 'ok') throw new Error('應該讀得出來')
    expect(read.nameInfo).toStrictEqual({
      year: 1968,
      timing: { month: 1, week: 1 },
      type: 'january-two-year-olds',
    })
    const result = parseImportFile(read.text, 'january-two-year-olds', 1968)
    expect(result).toMatchObject({ status: 'ok', entries: [{ age: 2, birthYear: 1966 }] })
    expect(
      parseImportFile(text.replaceAll('\t\r\n', '\r\n'), 'january-two-year-olds', 1968),
    ).toStrictEqual(result)
  })

  it('JAN-06 第 77 欄基本馬名 → 依位置讀取，不因與第 1 欄同名而讀錯', () => {
    const text = exportText('two-year-old', [{ ...SAMPLES['two-year-old'], 1: '(外)ベツメイ' }])
    const result = parseImportFile(text, 'january-two-year-olds', 1968)
    expect(result).toMatchObject({
      status: 'ok',
      entries: [{ fullName: '(外)ベツメイ', baseName: 'テストアオバ' }],
    })
  })

  it('JAN-07 史実番号 0x7FFF → 不作為識別，能力番号取第 74 欄', () => {
    const text = exportText('two-year-old', [SAMPLES['two-year-old']])
    const result = parseImportFile(text, 'january-two-year-olds', 1968)
    if (result.status !== 'ok') throw new Error('應該解析得出來')
    expect(SAMPLES['two-year-old'][73]).toBe('0x7FFF')
    expect(result.entries[0].abilityNumber).toBe('0x0A1F')
    expect(Object.values(result.entries[0])).not.toContain('0x7FFF')
  })
})

describe('一月二歲馬（JAN）：配對與套用', () => {
  it('JAN-02 非管理的二歲馬 → 不建立，也不出現在管理清單', async () => {
    const db = await januaryGame([ownFoal('F1', { abilityNumber: '0x0101' })])
    const rows = [
      januaryRow({
        fullName: 'ジブン',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0101',
        horseNumber: '0x2101',
      }),
      januaryRow({
        fullName: '(外)タニン',
        sire: 'ベツ',
        dam: 'ベツハハ',
        abilityNumber: '0x0102',
        horseNumber: '0x2102',
      }),
      // 父母相同的電腦 AI 的馬：自家產駒已有能力番号，不以父母退回配對
      januaryRow({
        fullName: 'タニンニ',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0103',
        horseNumber: '0x2103',
      }),
    ]
    const { preview, applied } = await applyJanuaryFile(db, rows)
    expect(preview.counts).toMatchObject({ applicable: 1, skipped: 2 })
    expect(applied.record.summary).toMatchObject({ total: 3, applied: 1, skipped: 2 })
    const ids = (await db.horses.toArray()).map((horse) => horse.id)
    expect(ids.sort()).toEqual(['F1', 'M1', 'S1'])
    expect(await db.horseNumbers.count()).toBe(1)
  })

  it('JAN-03 能力番号未登記的舊產駒 → 以父馬、母馬、出生年唯一配對；零筆或多筆 → 人工確認', async () => {
    const db = await januaryGame([
      ownFoal('F1'),
      // 父馬只有手動輸入的名稱，總表沒有這匹父馬的產駒：零筆
      horseRow('F2', {
        birthYear: 1988,
        sex: 'female',
        sireName: 'ナイチチ',
        damId: 'M1',
        pedigreeSource: 'manual',
        birth: {},
        disposition: 'keep',
      }),
      // 總表有兩列同父同母同年：多筆
      horseRow('F3', {
        birthYear: 1988,
        sex: 'male',
        sireName: 'フタゴチチ',
        damName: 'フタゴハハ',
        pedigreeSource: 'import',
        birth: {},
        disposition: 'keep',
      }),
    ])
    const twin = (fullName: string, abilityNumber: string) =>
      januaryRow({
        fullName,
        sire: 'フタゴチチ',
        dam: 'フタゴハハ',
        abilityNumber,
        horseNumber: '0x2FFF',
      })
    const rows = [
      januaryRow({
        fullName: 'ハジメ',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0101',
        horseNumber: '0x2101',
      }),
      twin('フタゴイチ', '0x0102'),
      twin('フタゴニ', '0x0103'),
    ]
    const { preview, applied } = await applyJanuaryFile(db, rows)
    expect(preview.pending).toEqual([
      { foalId: 'F2', reason: 'no-candidate', candidates: [] },
      { foalId: 'F3', reason: 'ambiguous', candidates: [3, 4] },
    ])
    expect(applied.record.summary).toMatchObject({ applied: 1, pending: 2 })
    expect(await db.horses.get('F1')).toMatchObject({
      fullName: 'ハジメ',
      nameSource: 'import',
      abilityNumber: '0x0101',
    })
    expect(await db.horses.get('F2')).not.toHaveProperty('fullName')
    expect(await db.horses.get('F3')).not.toHaveProperty('fullName')
  })

  it('JAN-04 同父同母但不同出生年的產駒 → 不會互相填錯名稱', async () => {
    const db = await januaryGame([ownFoal('F88'), ownFoal('F89', { birthYear: 1989 })], {
      currentYear: 1991,
    })
    const row = (fullName: string, abilityNumber: string) =>
      januaryRow({ fullName, sire: 'チチ', dam: 'ハハ', abilityNumber, horseNumber: '0x2FFF' })
    await applyJanuaryFile(db, [row('アニ', '0x0201')], { year: 1990 })
    expect(await db.horses.get('F89')).not.toHaveProperty('fullName')
    await applyJanuaryFile(db, [row('オトウト', '0x0301')], { year: 1991 })
    expect(await db.horses.get('F88')).toMatchObject({ fullName: 'アニ', abilityNumber: '0x0201' })
    expect(await db.horses.get('F89')).toMatchObject({
      fullName: 'オトウト',
      abilityNumber: '0x0301',
    })
  })

  it('JAN-05 配對成功 → 保存競走馬馬番号，幼駒馬番号留在歷程', async () => {
    const db = await januaryGame([ownFoal('F1', { abilityNumber: '0x0101' })])
    await db.horseNumbers.add({
      id: 'N1',
      gameId: GAME,
      horseId: 'F1',
      stage: 'foal',
      number: '0x1101',
      year: 1988,
      source: { kind: 'manual' },
    })
    const row = januaryRow({
      fullName: 'ジブン',
      sire: 'チチ',
      dam: 'ハハ',
      abilityNumber: '0x0101',
      horseNumber: '0x2101',
    })
    const { applied } = await applyJanuaryFile(db, [row])
    const numbers = await db.horseNumbers.where('[gameId+horseId]').equals([GAME, 'F1']).toArray()
    expect(numbers).toHaveLength(2)
    expect(numbers).toContainEqual(expect.objectContaining({ stage: 'foal', number: '0x1101' }))
    expect(numbers).toContainEqual({
      id: expect.any(String),
      gameId: GAME,
      horseId: 'F1',
      stage: 'racehorse',
      number: '0x2101',
      year: 1990,
      source: { kind: 'import', importType: 'january-two-year-olds', importId: applied.record.id },
      timing: { month: 1, week: 1 },
    })
  })

  it('JAN-08 自家產駒尚未滿 2 歲的年份匯入一月總表 → 配對 0 筆不警告，仍標記年度工作完成', async () => {
    const db = testDatabase()
    await addTestGame(db, { currentYear: 1968 })
    const rows = [
      januaryRow({
        fullName: 'タニン',
        sire: 'ベツ',
        dam: 'ベツハハ',
        abilityNumber: '0x0101',
        horseNumber: '0x2101',
      }),
      januaryRow({
        fullName: 'タニンニ',
        sire: 'ベツ',
        dam: 'ベツハハ',
        abilityNumber: '0x0102',
        horseNumber: '0x2102',
      }),
    ]
    const { preview, applied } = await applyJanuaryFile(db, rows, { year: 1968 })
    expect(preview).toStrictEqual({
      birthYear: 1966,
      total: 2,
      pairs: [],
      errors: [],
      pending: [],
      counts: { applicable: 0, skipped: 2, errors: 0, pending: 0, warnings: 0 },
    })
    expect(applied.record).toMatchObject({
      type: 'january-two-year-olds',
      year: 1968,
      summary: { total: 2, applied: 0, skipped: 2, pending: 0, warnings: 0, errors: 0 },
    })
    expect(importProgress(await db.imports.toArray())).toStrictEqual({
      year: 1968,
      timing: { month: 1, week: 1 },
    })
  })

  it('JAN-09 配對到的列，第 1 欄去掉前綴後與第 77 欄不同 → 警告，基本馬名存第 77 欄，完整馬名存第 1 欄', async () => {
    const db = await januaryGame([ownFoal('F1', { abilityNumber: '0x0101' })])
    const row = januaryRow({
      fullName: '(市)ジブン',
      baseName: 'ジブン',
      sire: 'チチ',
      dam: 'ハハ',
      abilityNumber: '0x0101',
      horseNumber: '0x2101',
    })
    const { preview, applied } = await applyJanuaryFile(db, [row])
    expect(preview.pairs[0]?.warnings).toEqual([
      { kind: 'base-name', split: '(市)ジブン', baseName: 'ジブン' },
    ])
    expect(applied.record.summary).toMatchObject({ applied: 1, warnings: 1 })
    expect(await db.horses.get('F1')).toMatchObject({ fullName: '(市)ジブン', baseName: 'ジブン' })
  })

  it('JAN-10 配不到的自家產駒，由使用者指定總表的一列 → 與自動配對相同；指定已配給別的產駒的列 → 不能指定', async () => {
    const db = await januaryGame([
      ownFoal('F1', { abilityNumber: '0x0101' }),
      // 手動輸入的母馬名打錯，以父母配不到
      horseRow('F2', {
        birthYear: 1988,
        sex: 'female',
        sireId: 'S1',
        damName: 'ハハハ',
        pedigreeSource: 'manual',
        birth: {},
        disposition: 'keep',
      }),
    ])
    const rows = [
      januaryRow({
        fullName: 'ジブン',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0101',
        horseNumber: '0x2101',
      }),
      januaryRow({
        fullName: 'イモウト',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0102',
        horseNumber: '0x2102',
      }),
    ]
    const { preview } = await previewJanuaryFile(db, rows)
    expect(preview.pending).toEqual([{ foalId: 'F2', reason: 'no-candidate', candidates: [] }])
    const taken = previewJanuaryFile(db, rows, { picks: new Map([['F2', 2]]) })
    await expect(taken).rejects.toThrow(RangeError)
    const { applied } = await applyJanuaryFile(db, rows, { picks: new Map([['F2', 3]]) })
    expect(applied.record.summary).toMatchObject({ applied: 2, pending: 0 })
    expect(await db.horses.get('F2')).toMatchObject({
      fullName: 'イモウト',
      baseName: 'イモウト',
      nameSource: 'import',
      abilityNumber: '0x0102',
    })
    const numbers = await db.horseNumbers.where('[gameId+horseId]').equals([GAME, 'F2']).toArray()
    expect(numbers).toEqual([expect.objectContaining({ stage: 'racehorse', number: '0x2102' })])
  })

  it('JAN-11 已有能力番号的自家產駒不在總表 → 待核對「未見於總表」，不寫入，也不能指定', async () => {
    const db = await januaryGame([ownFoal('F1', { abilityNumber: '0x0FFF' })])
    const rows = [
      januaryRow({
        fullName: 'タニン',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0101',
        horseNumber: '0x2101',
      }),
    ]
    const picked = previewJanuaryFile(db, rows, { picks: new Map([['F1', 2]]) })
    await expect(picked).rejects.toThrow(RangeError)
    const { preview, applied } = await applyJanuaryFile(db, rows)
    expect(preview.pending).toEqual([{ foalId: 'F1', reason: 'not-in-file', candidates: [] }])
    expect(applied.record.summary).toMatchObject({ applied: 0, pending: 1 })
    expect(await db.horses.get('F1')).toStrictEqual(ownFoal('F1', { abilityNumber: '0x0FFF' }))
  })

  it('JAN-12 以資料更正匯入的一月總表，馬名與已匯入的不同 → 改用新名，歷程保存原名與新名，不留別名', async () => {
    const db = await januaryGame([
      ownFoal('F1', {
        abilityNumber: '0x0101',
        fullName: 'テガキ',
        baseName: 'テガキ',
        nameSource: 'manual',
      }),
    ])
    const row = (fullName: string, horseNumber: string) =>
      januaryRow({ fullName, sire: 'チチ', dam: 'ハハ', abilityNumber: '0x0101', horseNumber })
    const first = await applyJanuaryFile(db, [row('アオバ', '0x2101')])
    const second = await applyJanuaryFile(db, [row('アオバオー', '0x2102')])
    expect(second.applied.record).toMatchObject({
      mode: 'correction',
      corrects: first.applied.record.id,
    })
    // 別名只有第一次匯入時被取代的手動名
    expect(await db.horses.get('F1')).toMatchObject({
      fullName: 'アオバオー',
      nameSource: 'import',
      aliases: ['テガキ'],
    })
    const events = (await db.events.toArray()).filter(
      (event) => event.kind === 'foal-name-imported',
    )
    expect(events).toContainEqual(
      expect.objectContaining({ horseId: 'F1', from: 'テガキ', to: 'アオバ' }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({ horseId: 'F1', from: 'アオバ', to: 'アオバオー' }),
    )
  })
})
