import { describe, expect, it } from 'vitest'
import { GAME } from '../../tests/support/rows'
import type { ImportFoal, ImportSnapshot } from '../core/imports'
import type { TwoYearOldEntry } from './formats'
import { januaryContent, previewJanuary } from './january'

/** 總表的一列：1990 年的檔案、1988 年生，父母是チチ與ハハ，能力番号與競走馬馬番号依行號；其他欄位依需要覆寫 */
function entry(line: number, fields: Partial<TwoYearOldEntry> = {}): TwoYearOldEntry {
  const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`
  return {
    line,
    fullName: `ウマ${line}`,
    baseName: `ウマ${line}`,
    country: '日',
    age: 2,
    birthYear: 1988,
    sex: 'male',
    speed: 60,
    stamina: 50,
    subAbilities: {
      power: 'C',
      burst: 'C',
      guts: 'C',
      flexibility: 'C',
      spirit: 'C',
      wisdom: 'C',
      health: 'C',
    },
    subTotal: 49,
    turf: '○',
    dirt: '△',
    distance: '1600～2400m',
    offspringQuality: 0,
    sireName: 'チチ',
    damName: 'ハハ',
    sireSystem: 'エクリプス',
    femaleLine: 'ヒンケイ',
    abilityNumber: hex(line),
    horseNumber: hex(line + 0x1000),
    birthCountry: '日本',
    birthFarm: 1,
    owner: 1,
    stable: 1,
    historical: '',
    ...fields,
  }
}

/** 非管理的馬的父母 */
const OTHER = { sireName: 'タニンノチチ', damName: 'タニンノハハ' }

/** 1988 年生的自家產駒：父母名預設經匯入確認的チチ與ハハ；其他欄位依需要覆寫 */
function foal(id: string, fields: Partial<ImportFoal> = {}): ImportFoal {
  return {
    id,
    birthYear: 1988,
    sire: { confirmed: 'チチ', known: 'チチ' },
    dam: { confirmed: 'ハハ', known: 'ハハ' },
    racehorseNumbers: [],
    ...fields,
  }
}

/** 1990 年一月二歲馬總表的快照 */
function snapshot(foals: ImportFoal[]): ImportSnapshot {
  return {
    gameId: GAME,
    currentYear: 1990,
    updatedAt: '2026-10-01T00:00:00.000Z',
    imports: [],
    checkpoints: [],
    january: { birthYear: 1988, foals },
  }
}

describe('previewJanuary', () => {
  it('以能力番号＋出生年配到：改用第 1 欄與第 77 欄、手動名留作別名、記競走馬馬番号，項目帶這一列的值；其他的列只計入略過（JAN-02、JAN-05）', () => {
    const foals = [
      foal('F1', {
        abilityNumber: '0x0002',
        fullName: 'ウマ',
        baseName: 'ウマ',
        nameSource: 'manual',
        racehorseNumbers: ['0x0FFF'],
      }),
    ]
    const preview = previewJanuary([entry(2), entry(3, OTHER)], snapshot(foals), 'normal')
    expect(preview).toStrictEqual({
      birthYear: 1988,
      total: 2,
      pairs: [
        {
          foalId: 'F1',
          line: 2,
          match: 'ability-number',
          changes: { name: { from: 'ウマ', to: 'ウマ2', alias: true }, horseNumber: '0x1002' },
          warnings: [],
          item: {
            kind: 'foal-name',
            horseId: 'F1',
            birthYear: 1988,
            fullName: 'ウマ2',
            baseName: 'ウマ2',
            abilityNumber: '0x0002',
            horseNumber: '0x1002',
          },
        },
      ],
      errors: [],
      pending: [],
      counts: { applicable: 1, skipped: 1, errors: 0, pending: 0, warnings: 0 },
    })
  })

  it('能力番号未登記的舊產駒以父馬、母馬、出生年唯一配對：檔案的父母名去掉前綴、忽略前後空白，手動的父母名也算；補上能力番号（JAN-03、JAN-04）', () => {
    const foals = [
      foal('F1'),
      foal('F2', { sire: { known: 'テウチ' }, dam: { known: 'ハハニ' } }),
      // 以能力番号配到的列不再拿來退回配對
      foal('F3', { abilityNumber: '0x0005', sire: { known: 'テウチ' }, dam: { known: 'ハハニ' } }),
    ]
    const entries = [
      entry(2, { sireName: ' (外)チチ', damName: 'ハハ ' }),
      // 同父同母但出生年不同：不是候選
      entry(3, { birthYear: 1987 }),
      entry(4, { sireName: 'テウチ', damName: 'ハハニ' }),
      entry(5, { sireName: 'テウチ', damName: 'ハハニ' }),
      // 只有父馬或只有母馬相同：不是候選
      entry(6, { sireName: 'ベツ' }),
      entry(7, { damName: 'ベツ' }),
    ]
    const preview = previewJanuary(entries, snapshot(foals), 'normal')
    expect(preview.pairs).toStrictEqual([
      {
        foalId: 'F1',
        line: 2,
        match: 'parents',
        changes: {
          name: { to: 'ウマ2', alias: false },
          abilityNumber: '0x0002',
          horseNumber: '0x1002',
        },
        warnings: [],
        item: {
          kind: 'foal-name',
          horseId: 'F1',
          birthYear: 1988,
          fullName: 'ウマ2',
          baseName: 'ウマ2',
          abilityNumber: '0x0002',
          horseNumber: '0x1002',
        },
      },
      expect.objectContaining({ foalId: 'F2', line: 4, match: 'parents' }),
      expect.objectContaining({ foalId: 'F3', line: 5, match: 'ability-number' }),
    ])
    expect(preview.counts).toStrictEqual({
      applicable: 3,
      skipped: 3,
      errors: 0,
      pending: 0,
      warnings: 0,
    })
  })

  it('配不到、無法唯一配對（含一列同時配到兩匹產駒）、未見於總表（能力番号相同但出生年不同也是）列入待核對；缺父馬或母馬名的產駒不配對（JAN-03、JAN-11）', () => {
    const foals = [
      foal('F1'),
      foal('F2', { sire: { known: 'ナイ' }, dam: { known: 'ナイ' } }),
      foal('F3', { sire: {}, dam: { confirmed: 'ハハサン', known: 'ハハサン' } }),
      foal('F4', { sire: { known: 'チチゴ' }, dam: { known: 'ハハゴ' } }),
      foal('F5', { sire: { known: 'チチゴ' }, dam: { known: 'ハハゴ' } }),
      foal('F6', { abilityNumber: '0x0FFF' }),
      foal('F7', { abilityNumber: '0x0008' }),
    ]
    const entries = [
      entry(2, { sireName: 'チチ', damName: 'ハハ' }),
      entry(3, { sireName: 'チチ', damName: 'ハハ' }),
      entry(5, { sireName: 'ベツ', damName: 'ハハサン' }),
      entry(6, { sireName: 'チチゴ', damName: 'ハハゴ' }),
      entry(7, OTHER),
      entry(8, { ...OTHER, birthYear: 1987 }),
    ]
    const preview = previewJanuary(entries, snapshot(foals), 'normal')
    expect(preview.pairs).toStrictEqual([])
    expect(preview.pending).toStrictEqual([
      { foalId: 'F1', reason: 'ambiguous', candidates: [2, 3] },
      { foalId: 'F2', reason: 'no-candidate', candidates: [] },
      { foalId: 'F3', reason: 'no-candidate', candidates: [] },
      { foalId: 'F4', reason: 'ambiguous', candidates: [6] },
      { foalId: 'F5', reason: 'ambiguous', candidates: [6] },
      { foalId: 'F6', reason: 'not-in-file', candidates: [] },
      { foalId: 'F7', reason: 'not-in-file', candidates: [] },
    ])
    expect(preview.counts).toStrictEqual({
      applicable: 0,
      skipped: 6,
      errors: 0,
      pending: 7,
      warnings: 0,
    })
  })

  it('錯誤：以能力番号配到而經匯入確認的父母名不符（手動的不比）、經匯入確認的馬名不同（基本馬名不同也算）而不是資料更正、只有前綴或第 77 欄空白；資料更正時改名（ID-03、JAN-12）', () => {
    const foals = [
      foal('F1', { abilityNumber: '0x0002' }),
      foal('F2', { abilityNumber: '0x0003', sire: { known: 'テウチ' }, dam: { known: 'ハハ' } }),
      foal('F3', {
        abilityNumber: '0x0004',
        fullName: 'ハナ',
        baseName: 'ハナ',
        nameSource: 'import',
      }),
      foal('F4', { abilityNumber: '0x0005' }),
      foal('F5', { abilityNumber: '0x0006' }),
      foal('F6', { abilityNumber: '0x0007' }),
      foal('F7', {
        abilityNumber: '0x0008',
        fullName: 'ウマ8',
        baseName: 'ウマハチ',
        nameSource: 'import',
      }),
    ]
    const entries = [
      entry(2, { sireName: 'ベツ', damName: 'ハハ' }),
      entry(3, { sireName: 'ベツ', damName: 'ハハ' }),
      entry(4, { sireName: 'チチ', damName: 'ハハ' }),
      entry(5, { fullName: '(外)', sireName: 'チチ', damName: 'ハハ' }),
      entry(6, { baseName: ' ', sireName: 'チチ', damName: 'ハハ' }),
      entry(7, { sireName: 'チチ', damName: 'ベツハハ' }),
      entry(8),
    ]
    const normal = previewJanuary(entries, snapshot(foals), 'normal')
    expect(normal.errors).toStrictEqual([
      { foalId: 'F1', line: 2, match: 'ability-number', reasons: ['sire'] },
      { foalId: 'F3', line: 4, match: 'ability-number', reasons: ['name-confirmed'] },
      { foalId: 'F4', line: 5, match: 'ability-number', reasons: ['horse-name'] },
      { foalId: 'F5', line: 6, match: 'ability-number', reasons: ['horse-name'] },
      { foalId: 'F6', line: 7, match: 'ability-number', reasons: ['dam'] },
      { foalId: 'F7', line: 8, match: 'ability-number', reasons: ['name-confirmed'] },
    ])
    expect(normal.pairs.map((pair) => pair.foalId)).toEqual(['F2'])
    expect(normal.counts).toStrictEqual({
      applicable: 1,
      skipped: 0,
      errors: 6,
      pending: 0,
      warnings: 0,
    })

    const correction = previewJanuary(entries, snapshot(foals), 'correction')
    expect(correction.errors.map((error) => error.foalId)).toEqual(['F1', 'F4', 'F5', 'F6'])
    expect(correction.pairs).toContainEqual(
      expect.objectContaining({
        foalId: 'F3',
        changes: { name: { from: 'ハナ', to: 'ウマ4', alias: false }, horseNumber: '0x1004' },
      }),
    )
  })

  it('第 1 欄去掉前綴後與第 77 欄不同時警告，照樣套用，基本馬名取第 77 欄（JAN-09）；手動名與總表相同時只改來源、不留別名；配到了但什麼都不用改的列算略過、不產生項目，警告也不計', () => {
    const foals = [
      foal('F1', { abilityNumber: '0x0002' }),
      foal('F2', {
        abilityNumber: '0x0003',
        fullName: '(市)ウマ3',
        baseName: 'ウマ3',
        nameSource: 'import',
        racehorseNumbers: ['0x1003'],
      }),
      foal('F3', {
        abilityNumber: '0x0004',
        fullName: 'ウマ4',
        baseName: 'ウマ4',
        nameSource: 'import',
      }),
      foal('F4', {
        abilityNumber: '0x0005',
        fullName: 'ウマ5',
        baseName: 'ウマ5',
        nameSource: 'manual',
        racehorseNumbers: ['0x1005'],
      }),
    ]
    const entries = [
      entry(2, { fullName: '(市)ウマ2', baseName: 'ウマ2' }),
      entry(3, { fullName: '(市)ウマ3', baseName: 'ウマ3' }),
      entry(4),
      entry(5),
    ]
    const preview = previewJanuary(entries, snapshot(foals), 'normal')
    expect(preview.pairs).toStrictEqual([
      expect.objectContaining({
        foalId: 'F1',
        warnings: [{ kind: 'base-name', split: '(市)ウマ2', baseName: 'ウマ2' }],
        item: expect.objectContaining({ fullName: '(市)ウマ2', baseName: 'ウマ2' }),
      }),
      {
        foalId: 'F2',
        line: 3,
        match: 'ability-number',
        changes: {},
        warnings: [{ kind: 'base-name', split: '(市)ウマ3', baseName: 'ウマ3' }],
      },
      expect.objectContaining({ foalId: 'F3', changes: { horseNumber: '0x1004' } }),
      expect.objectContaining({
        foalId: 'F4',
        changes: { name: { from: 'ウマ5', to: 'ウマ5', alias: false } },
        item: expect.objectContaining({ fullName: 'ウマ5' }),
      }),
    ])
    expect(preview.counts).toStrictEqual({
      applicable: 3,
      skipped: 1,
      errors: 0,
      pending: 0,
      warnings: 1,
    })
  })

  it('使用者指定：待核對的產駒可指定任一列，結果與自動配對相同，候選不含已指定的列；指定後的錯誤列在錯誤裡（JAN-10）', () => {
    const foals = [
      foal('F1'),
      foal('F2'),
      // 指定的列不比父母：經匯入確認的父母名與那一列不同也不是錯誤
      foal('F3', {
        sire: { confirmed: 'チチ', known: 'ナイ' },
        dam: { confirmed: 'ハハ', known: 'ナイ' },
      }),
      foal('F4', { sire: { known: 'ナイ' }, dam: { known: 'ナイ' } }),
    ]
    const entries = [
      entry(2, { sireName: 'チチ', damName: 'ハハ' }),
      entry(3, { sireName: 'チチ', damName: 'ハハ' }),
      entry(9, OTHER),
      entry(10, { ...OTHER, fullName: '[地]' }),
    ]
    const picks = new Map([
      ['F1', 2],
      ['F3', 9],
      ['F4', 10],
    ])
    const preview = previewJanuary(entries, snapshot(foals), 'normal', picks)
    expect(preview.pairs).toStrictEqual([
      expect.objectContaining({ foalId: 'F1', line: 2, match: 'picked' }),
      {
        foalId: 'F3',
        line: 9,
        match: 'picked',
        changes: {
          name: { to: 'ウマ9', alias: false },
          abilityNumber: '0x0009',
          horseNumber: '0x1009',
        },
        warnings: [],
        item: {
          kind: 'foal-name',
          horseId: 'F3',
          birthYear: 1988,
          fullName: 'ウマ9',
          baseName: 'ウマ9',
          abilityNumber: '0x0009',
          horseNumber: '0x1009',
        },
      },
    ])
    expect(preview.errors).toStrictEqual([
      { foalId: 'F4', line: 10, match: 'picked', reasons: ['horse-name'] },
    ])
    expect(preview.pending).toStrictEqual([{ foalId: 'F2', reason: 'ambiguous', candidates: [3] }])
    expect(preview.counts).toStrictEqual({
      applicable: 2,
      skipped: 1,
      errors: 1,
      pending: 1,
      warnings: 0,
    })
  })

  it('指定不合法時丟出 RangeError：那一列已配給別的產駒、出生年不同、未見於總表的產駒；不是待核對的產駒、檔案沒有那一行也一樣', () => {
    const foals = [
      foal('F1', { abilityNumber: '0x0002' }),
      foal('F2', { sire: { known: 'ナイ' }, dam: { known: 'ナイ' } }),
      foal('F3', { abilityNumber: '0x0FFF' }),
      foal('F4', { sire: { known: 'ナイ' }, dam: { known: 'ナイ' } }),
    ]
    const entries = [entry(2), entry(3, { birthYear: 1987 }), entry(4)]
    const pick = (...pairs: [string, number][]) =>
      previewJanuary(entries, snapshot(foals), 'normal', new Map(pairs))
    expect(() => pick(['F2', 2])).toThrow(new RangeError('第 2 行已配給別的產駒'))
    expect(() => pick(['F2', 4], ['F4', 4])).toThrow(new RangeError('第 4 行已配給別的產駒'))
    expect(() => pick(['F2', 3])).toThrow(new RangeError('第 3 行的出生年與產駒不同'))
    expect(() => pick(['F3', 4])).toThrow(new RangeError('這匹產駒不能指定列：F3'))
    expect(() => pick(['F1', 4])).toThrow(new RangeError('這匹產駒不能指定列：F1'))
    expect(() => pick(['X', 4])).toThrow(new RangeError('這匹產駒不能指定列：X'))
    expect(() => pick(['F2', 99])).toThrow(new RangeError('檔案沒有第 99 行'))
    expect(pick(['F2', 4]).pairs).toContainEqual(expect.objectContaining({ foalId: 'F2', line: 4 }))
  })

  it('沒有自家產駒的年份：0 對、0 待核對，全部算略過，沒有警告（JAN-08）；快照沒有一月的資料時丟出錯誤', () => {
    const preview = previewJanuary([entry(2), entry(3)], snapshot([]), 'normal')
    expect(preview).toStrictEqual({
      birthYear: 1988,
      total: 2,
      pairs: [],
      errors: [],
      pending: [],
      counts: { applicable: 0, skipped: 2, errors: 0, pending: 0, warnings: 0 },
    })
    const { gameId, currentYear, updatedAt } = snapshot([])
    const plain: ImportSnapshot = { gameId, currentYear, updatedAt, imports: [], checkpoints: [] }
    expect(() => previewJanuary([], plain, 'normal')).toThrow('快照沒有一月二歲馬總表的資料')
  })
})

describe('januaryContent', () => {
  it('每個可套用的對一個項目；摘要的 total 是列數，另填待核對、警告與錯誤的筆數', () => {
    const foals = [
      foal('F1', { abilityNumber: '0x0002' }),
      foal('F2', {
        abilityNumber: '0x0003',
        fullName: 'ウマ3',
        baseName: 'ウマ3',
        nameSource: 'import',
        racehorseNumbers: ['0x1003'],
      }),
      foal('F3', { abilityNumber: '0x0004', sire: { confirmed: 'ベツ' } }),
      foal('F4', { sire: { known: 'ナイ' }, dam: { known: 'ナイ' } }),
    ]
    const entries = [
      entry(2, { fullName: '(市)ウマ2', baseName: 'ウマ2' }),
      entry(3),
      entry(4),
      entry(5),
    ]
    const preview = previewJanuary(entries, snapshot(foals), 'normal')
    const content = januaryContent(preview)
    expect(content).toStrictEqual({
      summary: { total: 4, applied: 1, skipped: 2, pending: 1, warnings: 1, errors: 1 },
      items: [preview.pairs[0]!.item],
    })
  })
})
