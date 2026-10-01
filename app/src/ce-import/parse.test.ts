import { describe, expect, it } from 'vitest'
import { SAMPLES, excelCsv, exportText } from '../../tests/support/ce-files'
import { parseImportFile, readImportFile } from './parse'

describe('readImportFile', () => {
  it('解碼並從檔名讀出年、時點與預選的類型', () => {
    const bytes = new TextEncoder().encode('馬名\t年\r\n')
    expect(readImportFile(bytes, '1968年 5月1週_繁殖牝馬.txt')).toStrictEqual({
      status: 'ok',
      text: '馬名\t年\r\n',
      nameInfo: { year: 1968, timing: { month: 5, week: 1 }, type: 'may-herd' },
    })
  })

  it('檔名解析不了時 nameInfo 是 null', () => {
    const bytes = new TextEncoder().encode('馬名\t年\r\n')
    expect(readImportFile(bytes, '新增繁殖牝馬.txt')).toStrictEqual({
      status: 'ok',
      text: '馬名\t年\r\n',
      nameInfo: null,
    })
  })

  it('解碼失敗時拒絕', () => {
    expect(readImportFile(new Uint8Array([0x32, 0xff]), 'x.txt')).toStrictEqual({
      status: 'rejected',
      reason: 'decode',
    })
  })
})

describe('parseImportFile：依位置讀出各欄', () => {
  it('一月二歲馬總表', () => {
    const text = exportText('two-year-old', [SAMPLES['two-year-old']])
    expect(parseImportFile(text, 'january-two-year-olds', 1968)).toStrictEqual({
      status: 'ok',
      format: 'two-year-old',
      entries: [
        {
          line: 2,
          fullName: '(外)テストアオバ',
          country: '日',
          age: 2,
          birthYear: 1966,
          sex: 'female',
          speed: 68,
          stamina: 45,
          subAbilities: {
            power: 'C',
            burst: 'B',
            guts: 'C+',
            flexibility: 'D',
            spirit: 'B+',
            wisdom: 'E',
            health: 'C',
          },
          subTotal: 61,
          turf: '◎',
          dirt: '×',
          distance: '1400～2000m',
          sireSystem: 'エクリプス',
          offspringQuality: 3,
          sireName: 'テストチチ',
          damName: 'テストハハ',
          femaleLine: 'テストヒンケイ',
          birthCountry: '日本',
          birthFarm: 32,
          owner: 46,
          stable: 32,
          historical: '',
          abilityNumber: '0x0A1F',
          horseNumber: '0x1B2C',
          baseName: 'テストアオバ',
        },
      ],
    })
  })

  it('四月誕生幼駒名單', () => {
    const text = exportText('foal', [SAMPLES.foal])
    expect(parseImportFile(text, 'april-foals', 1968)).toStrictEqual({
      status: 'ok',
      format: 'foal',
      entries: [
        {
          line: 2,
          fullName: 'テストハハの0歳',
          country: '日',
          age: 0,
          birthYear: 1968,
          sex: 'male',
          speed: 72,
          stamina: 40,
          subAbilities: {
            power: 'B',
            burst: 'B+',
            guts: 'C',
            flexibility: 'D+',
            spirit: 'C',
            wisdom: 'E',
            health: 'S',
          },
          subTotal: 42,
          turf: '○',
          dirt: '◎',
          distance: '1600～2400m',
          offspringQuality: 2,
          sireName: 'テストチチ',
          sireSystem: 'ファロス',
          damName: 'テストハハ',
          femaleLine: 'テストヒンケイ',
          birthFarm: 32,
          owner: 46,
          stable: 32,
          abilityNumber: '0x0A20',
          horseNumber: '0x1B30',
          baseName: 'テストハハの0歳',
        },
      ],
    })
  })

  it('繁殖牝馬格式', () => {
    const text = exportText('broodmare', [SAMPLES.broodmare])
    expect(parseImportFile(text, 'may-herd', 1970)).toStrictEqual({
      status: 'ok',
      format: 'broodmare',
      entries: [
        {
          line: 2,
          fullName: '[地]テストハハ',
          country: '日',
          age: 8,
          birthYear: 1962,
          speed: 64,
          stamina: 52,
          subAbilities: {
            power: 'C',
            burst: 'C+',
            guts: 'D',
            flexibility: 'B',
            spirit: 'C',
            wisdom: 'D+',
            health: 'C',
          },
          subTotal: 55,
          offspringQuality: 4,
          turf: '△',
          dirt: '◎',
          distance: '1200～1800m',
          vigor: { value: 80, boosted: true },
          breedingYears: 4,
          foalCount: 3,
          sireName: 'テストソフ',
          sireSystem: 'エクリプス',
          damName: 'テストソボ',
          femaleLine: 'テストヒンケイ',
          farm: 32,
          status: '空胎',
          matedStallion: '',
          specialMating: '疾風',
          abilityNumber: '0x0B01',
          horseNumber: '0x1C01',
          baseName: 'テストハハ',
        },
      ],
    })
  })

  it('種牡馬格式', () => {
    const text = exportText('stallion', [SAMPLES.stallion])
    expect(parseImportFile(text, 'stallion-list', 1968)).toStrictEqual({
      status: 'ok',
      format: 'stallion',
      entries: [
        {
          line: 2,
          fullName: '(外)テストチチ',
          country: '米',
          age: 6,
          birthYear: 1962,
          speed: 75,
          stamina: 60,
          subAbilities: {
            power: 'B',
            burst: 'A',
            guts: 'B+',
            flexibility: 'C',
            spirit: 'B',
            wisdom: 'C+',
            health: 'B',
          },
          subTotal: 70,
          offspringQuality: 5,
          turf: '◎',
          dirt: '○',
          distance: '1800～2600m',
          sireSystem: 'ナスルーラ',
          studFee: '1,500',
          sireName: 'テストソフ',
          damName: 'テストソボ',
          femaleLine: 'テストヒンケイ',
          birthCountry: '米国',
          farm: 240,
          specialMating: '稲妻',
          active: '○',
          historical: '○',
          abilityNumber: '0x0010',
          horseNumber: '0x0210',
          baseName: 'テストチチ',
        },
      ],
    })
  })

  it('七月、十月、候選 TXT 是繁殖牝馬格式，目標種牡馬 TXT 是種牡馬格式', () => {
    const broodmares = exportText('broodmare', [SAMPLES.broodmare])
    for (const type of ['july-conception', 'october-mares', 'candidates'] as const) {
      expect(parseImportFile(broodmares, type, 1970)).toMatchObject({
        status: 'ok',
        format: 'broodmare',
      })
    }
    expect(
      parseImportFile(exportText('stallion', [SAMPLES.stallion]), 'target-stallion', 1968),
    ).toMatchObject({ status: 'ok', format: 'stallion' })
  })
})

describe('parseImportFile：欄數、欄名與分隔', () => {
  it('尾端的空白欄可有可無', () => {
    const text = exportText('broodmare', [SAMPLES.broodmare])
    expect(parseImportFile(text.replaceAll('\t\r\n', '\r\n'), 'may-herd', 1970)).toStrictEqual(
      parseImportFile(text, 'may-herd', 1970),
    )
  })

  it('Excel 另存的 CSV 與 Tab 分隔檔的解析結果相同', () => {
    const text = exportText('stallion', [SAMPLES.stallion])
    expect(excelCsv(text)).toContain('"1,500"')
    expect(parseImportFile(excelCsv(text), 'stallion-list', 1968)).toStrictEqual(
      parseImportFile(text, 'stallion-list', 1968),
    )
  })

  it('只有表頭的檔案是 0 筆', () => {
    expect(parseImportFile(exportText('broodmare', []), 'may-herd', 1970)).toStrictEqual({
      status: 'ok',
      format: 'broodmare',
      entries: [],
    })
  })

  it('沒有任何一行時拒絕', () => {
    expect(parseImportFile('\r\n', 'may-herd', 1970)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'empty' }],
    })
  })

  it('表頭的欄數不符時拒絕，不讀資料列', () => {
    const text = exportText('two-year-old', [SAMPLES['two-year-old']])
    expect(parseImportFile(text, 'may-herd', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'field-count', line: 1, value: '78' }],
    })
  })

  it('欄數相同但要讀的位置的欄名不符時拒絕，不讀資料列', () => {
    const text = exportText('stallion', [SAMPLES.stallion])
    const result = parseImportFile(text, 'april-foals', 1968)
    if (result.status !== 'rejected') throw new Error('應該拒絕')
    expect(result.problems[0]).toStrictEqual({
      reason: 'header',
      line: 1,
      column: 4,
      header: '性',
      value: 'SP',
    })
    expect(result.problems.every((problem) => problem.reason === 'header')).toBe(true)
  })

  it('資料列的欄數與表頭不同時拒絕並指出那一行', () => {
    const text = exportText('broodmare', [SAMPLES.broodmare]) + 'テスト\t5\r\n'
    expect(parseImportFile(text, 'may-herd', 1970)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'field-count', line: 3, value: '2' }],
    })
  })

  it('逗號分隔檔的雙引號不成對時拒絕並指出那一行', () => {
    const csv = excelCsv(exportText('stallion', [SAMPLES.stallion]))
    expect(parseImportFile(csv.replace('"1,500"', '"1,500'), 'stallion-list', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'quote', line: 2 }],
    })
    expect(parseImportFile('"馬名,国\r\n', 'stallion-list', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'quote', line: 1 }],
    })
  })

  it('值不合格式時拒絕，列出每一個問題的行、欄、欄名與值', () => {
    const bad = { ...SAMPLES.broodmare, 3: 'x', 27: '101', 57: 'abc' }
    const text = exportText('broodmare', [SAMPLES.broodmare, bad])
    expect(parseImportFile(text, 'may-herd', 1970)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'value', line: 3, column: 3, header: '年', value: 'x' },
        { reason: 'value', line: 3, column: 27, header: '活力', value: '101' },
        { reason: 'value', line: 3, column: 57, header: '能力番号', value: 'abc' },
      ],
    })
  })
})

describe('parseImportFile：整份停止的檢查', () => {
  const foal = SAMPLES.foal
  const mare = SAMPLES.broodmare

  it('四月誕生幼駒名單：馬主 46、47，繋牧 32～35，年 0 時可以解析', () => {
    const text = exportText('foal', [foal, { ...foal, 52: '47', 53: '35', 58: '0x0a21' }])
    expect(parseImportFile(text, 'april-foals', 1968)).toMatchObject({ status: 'ok' })
  })

  it('四月誕生幼駒名單：年不是 0 時拒絕；馬主或繋牧超出範圍或空白時是範圍異常', () => {
    const text = exportText('foal', [
      { ...foal, 3: '1' },
      { ...foal, 52: '45', 53: '31', 58: '0x0a21' },
      { ...foal, 52: '', 53: '', 58: '0x0a22' },
    ])
    expect(parseImportFile(text, 'april-foals', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'value', line: 2, header: '年', value: '1' },
        { reason: 'scope', line: 3, header: '馬主', value: '45' },
        { reason: 'scope', line: 3, header: '繋牧', value: '31' },
        { reason: 'scope', line: 4, header: '馬主', value: '' },
        { reason: 'scope', line: 4, header: '繋牧', value: '' },
      ],
    })
  })

  it('五月、七月名單：牧場不在 32～35 或空白時是範圍異常', () => {
    const text = exportText('broodmare', [
      { ...mare, 48: '35' },
      { ...mare, 48: '36', 57: '0x0b02' },
      { ...mare, 48: '', 57: '0x0b03' },
    ])
    for (const type of ['may-herd', 'july-conception'] as const) {
      expect(parseImportFile(text, type, 1970)).toStrictEqual({
        status: 'rejected',
        problems: [
          { reason: 'scope', line: 3, header: '牧場', value: '36' },
          { reason: 'scope', line: 4, header: '牧場', value: '' },
        ],
      })
    }
  })

  it('十月總表與候選 TXT 不檢查牧場的範圍', () => {
    const text = exportText('broodmare', [
      { ...mare, 48: '0' },
      { ...mare, 48: '240', 57: '0x0b02' },
      { ...mare, 48: '', 57: '0x0b03' },
    ])
    for (const type of ['october-mares', 'candidates'] as const) {
      expect(parseImportFile(text, type, 1970)).toMatchObject({ status: 'ok' })
    }
  })

  it('七月名單的状態要是空胎、受胎、不受胎、未確認之一；五月名單不檢查', () => {
    const states = ['空胎', '受胎', '不受胎', '未確認'].map((status, index) => ({
      ...mare,
      49: status,
      57: `0x0c0${index}`,
    }))
    expect(parseImportFile(exportText('broodmare', states), 'july-conception', 1970)).toMatchObject(
      { status: 'ok' },
    )
    const text = exportText('broodmare', [{ ...mare, 49: '流産' }])
    expect(parseImportFile(text, 'july-conception', 1970)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'value', line: 2, header: '状態', value: '流産' }],
    })
    expect(parseImportFile(text, 'may-herd', 1970)).toMatchObject({ status: 'ok' })
  })

  it('目標種牡馬 TXT 要剛好一筆；種牡馬總表不限', () => {
    const stallion = SAMPLES.stallion
    const two = exportText('stallion', [stallion, { ...stallion, 59: '0x0011' }])
    expect(parseImportFile(exportText('stallion', []), 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'row-count', value: '0' }],
    })
    expect(parseImportFile(two, 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'row-count', value: '2' }],
    })
    expect(parseImportFile(two, 'stallion-list', 1968)).toMatchObject({ status: 'ok' })
  })

  it('目標種牡馬 TXT 的筆數以資料列數計，不論那一列讀不讀得出來', () => {
    const bad = { ...SAMPLES.stallion, 3: 'x', 59: '0x0011' }
    const two = exportText('stallion', [SAMPLES.stallion, bad])
    expect(parseImportFile(two, 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'value', line: 3, column: 3, header: '年', value: 'x' },
        { reason: 'row-count', value: '2' },
      ],
    })
    expect(parseImportFile(exportText('stallion', [bad]), 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'value', line: 2, column: 3, header: '年', value: 'x' }],
    })
  })

  it('檔內能力番号重複時拒絕並列出每一行；寫法不同但統一後相同也算重複', () => {
    const text = exportText('broodmare', [
      mare,
      { ...mare, 57: '0x0b02' },
      { ...mare, 57: '0x0B01' },
    ])
    expect(parseImportFile(text, 'candidates', 1970)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'duplicate', line: 2, header: '能力番号', value: '0x0B01' },
        { reason: 'duplicate', line: 4, header: '能力番号', value: '0x0B01' },
      ],
    })
  })

  it('格式錯誤與整份檢查的問題一起列出', () => {
    const text = exportText('broodmare', [
      { ...mare, 3: 'x' },
      { ...mare, 48: '36' },
    ])
    expect(parseImportFile(text, 'may-herd', 1970)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'value', line: 2, column: 3, header: '年', value: 'x' },
        { reason: 'scope', line: 3, header: '牧場', value: '36' },
      ],
    })
  })

  it('有格式錯誤的列不做整份檢查，不會多報範圍異常或重複', () => {
    const text = exportText('broodmare', [
      { ...mare, 48: 'x', 57: 'abc' },
      { ...mare, 48: 'y', 57: 'abd' },
    ])
    expect(parseImportFile(text, 'may-herd', 1970)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'value', line: 2, column: 48, header: '牧場', value: 'x' },
        { reason: 'value', line: 2, column: 57, header: '能力番号', value: 'abc' },
        { reason: 'value', line: 3, column: 48, header: '牧場', value: 'y' },
        { reason: 'value', line: 3, column: 57, header: '能力番号', value: 'abd' },
      ],
    })
  })

  it('表頭不能用時不做整份檢查', () => {
    expect(parseImportFile('\r\n', 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'empty' }],
    })
    expect(parseImportFile('"馬名,国\r\n', 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'quote', line: 1 }],
    })
    const twoYearOld = exportText('two-year-old', [SAMPLES['two-year-old']])
    expect(parseImportFile(twoYearOld, 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'field-count', line: 1, value: '78' }],
    })
    const result = parseImportFile(exportText('foal', [SAMPLES.foal]), 'target-stallion', 1968)
    if (result.status !== 'rejected') throw new Error('應該拒絕')
    expect(result.problems.every((problem) => problem.reason === 'header')).toBe(true)
  })
})
