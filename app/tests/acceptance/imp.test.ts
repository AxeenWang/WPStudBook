import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildImportPlan } from '../../src/ce-import/flow'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { importProgress } from '../../src/core/imports'
import { normalizeSystemName } from '../../src/core/systems'
import {
  listCheckpoints,
  readCheckpoint,
  rollbackToCheckpoint,
} from '../../src/storage/checkpoints'
import type { WPStudBookDatabase } from '../../src/storage/database'
import { downloadBackup } from '../../src/storage/download'
import { GAME_TABLES, readGameData } from '../../src/storage/game-data'
import { loadGame, setCurrentYear } from '../../src/storage/games'
import { applyImport } from '../../src/storage/imports'
import { cp932, utf8WithBom } from '../support/ce-bytes'
import { SAMPLES, excelCsv, exportText } from '../support/ce-files'
import { addTestGame, testDatabase } from '../support/database'
import { stubDownloads } from '../support/download'
import {
  EMPTY_CONTENT,
  applyFile,
  applyJanuaryFile,
  applyMayFile,
  importFile,
  januaryGame,
  januaryRow,
  judgeFile,
  mayRow,
  ownFoal,
  previewJanuaryFile,
} from '../support/import-flow'
import { GAME, horseRow, lineRow, startMareRow, ungroupedMareRow } from '../support/rows'

// 需求規格第 15 章「匯入共通（IMP）」：解析的部分（CE 匯入子計畫 4-1），判斷、套用、重複與進度
// （4-2，計畫沒有項目），以及一月的預覽、資料更正與匯入分權（4-3）；選檔、拖放與多檔拒絕由畫面計畫補上

describe('匯入共通（IMP）：解析', () => {
  it('IMP-01 CP932 無 BOM、Tab 分隔的 .txt → 可以直接讀取與解析', () => {
    const text = exportText('broodmare', [SAMPLES.broodmare])
    const read = readImportFile(cp932(text), '1968年 5月1週_繁殖牝馬.txt')
    if (read.status !== 'ok') throw new Error('應該讀得出來')
    expect(read.text).toBe(text)
    expect(parseImportFile(read.text, 'may-herd', 1968)).toMatchObject({
      status: 'ok',
      format: 'broodmare',
      entries: [{ line: 2, fullName: '[地]テストハハ', abilityNumber: '0x0B01' }],
    })
  })

  it('IMP-02 檔名 1968年 5月1週_繁殖牝馬.txt → 解析為 1968 年 5 月 1 週並預選五月匯入', () => {
    expect(readImportFile(cp932('馬名\r\n'), '1968年 5月1週_繁殖牝馬.txt')).toMatchObject({
      status: 'ok',
      nameInfo: { year: 1968, timing: { month: 5, week: 1 }, type: 'may-herd' },
    })
  })

  it('IMP-03 檔名無法解析 → 沒有年、時點與類型，由使用者選擇，不從其他欄位猜測', () => {
    const text = exportText('broodmare', [SAMPLES.broodmare])
    expect(readImportFile(cp932(text), '新增繁殖牝馬.txt')).toMatchObject({
      status: 'ok',
      nameInfo: null,
    })
  })

  it('IMP-04 二歲馬總表與五月繁殖圈名單互相選錯類型 → 依欄數停止', () => {
    const twoYearOld = exportText('two-year-old', [SAMPLES['two-year-old']])
    const may = exportText('broodmare', [SAMPLES.broodmare])
    expect(parseImportFile(twoYearOld, 'may-herd', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'field-count', line: 1, value: '78' }],
    })
    expect(parseImportFile(may, 'january-two-year-olds', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'field-count', line: 1, value: '61' }],
    })
  })

  it('IMP-04 欄數相同的四月誕生幼駒名單與種牡馬總表選錯類型 → 依必要欄位停止', () => {
    const foals = exportText('foal', [SAMPLES.foal])
    const stallions = exportText('stallion', [SAMPLES.stallion])
    for (const [text, type] of [
      [foals, 'stallion-list'],
      [stallions, 'april-foals'],
    ] as const) {
      const result = parseImportFile(text, type, 1968)
      if (result.status !== 'rejected') throw new Error('應該停止')
      expect(result.problems.length).toBeGreaterThan(0)
      expect(result.problems.every((problem) => problem.reason === 'header')).toBe(true)
    }
  })

  it('IMP-17 父系為 エクリプス系 → 保存為 エクリプス，能對應系統對照表的 エクリプス', () => {
    const result = parseImportFile(exportText('broodmare', [SAMPLES.broodmare]), 'may-herd', 1968)
    if (result.status !== 'ok') throw new Error('應該解析得出來')
    expect(SAMPLES.broodmare[44]).toBe('エクリプス系')
    expect(result.entries[0].sireSystem).toBe('エクリプス')
    expect(result.entries[0].sireSystem).toBe(normalizeSystemName('エクリプス'))
  })

  it('IMP-22 以 Excel 另存的 CSV（CP932 或含 BOM 的 UTF-8）→ 解析結果與 Tab 分隔檔相同', () => {
    const text = exportText('stallion', [SAMPLES.stallion])
    const csv = excelCsv(text)
    expect(csv).toContain('"1,500"')
    const expected = parseImportFile(text, 'stallion-list', 1968)
    expect(expected).toMatchObject({ status: 'ok' })
    for (const bytes of [cp932(csv), utf8WithBom(csv)]) {
      const read = readImportFile(bytes, '1968年5月1週_種牡馬.csv')
      if (read.status !== 'ok') throw new Error('應該讀得出來')
      expect(read.text).toBe(csv)
      expect(parseImportFile(read.text, 'stallion-list', 1968)).toStrictEqual(expected)
    }
  })
})

describe('匯入共通（IMP）：判斷與套用', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** 2026-10-01 00:00（UTC）起第 n 分鐘 */
  const minute = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n))

  /** 一局（目前遊戲年 year）；年度匯入會自動備份，所以換掉下載 */
  async function game(year = 1990): Promise<WPStudBookDatabase> {
    const db = testDatabase()
    await addTestGame(db, { currentYear: year })
    stubDownloads()
    return db
  }

  /** 先後匯入一月與五月名單：目前進度是那一年的 5 月 1 週，各有一個自動檢查點 */
  async function januaryAndMay(db: WPStudBookDatabase, year = 1990) {
    const january = await applyFile(
      db,
      importFile('january-two-year-olds', year),
      undefined,
      minute(1),
    )
    const may = await applyFile(db, importFile('may-herd', year), undefined, minute(2))
    if (january.checkpoint?.status !== 'done' || may.checkpoint?.status !== 'done') {
      throw new Error('沒有建立檢查點')
    }
    return { january, may, checkpoints: [january.checkpoint.value, may.checkpoint.value] }
  }

  it('IMP-06 發生任一阻擋錯誤 → 資料不變：預覽之後遊戲局有變更時不套用，由畫面重新預覽', async () => {
    const db = await game()
    const judgment = await judgeFile(db, importFile('may-herd', 1990))
    if (judgment.kind !== 'ready') throw new Error(judgment.kind)
    const plan = buildImportPlan(judgment, { mode: 'normal' }, EMPTY_CONTENT)
    await setCurrentYear(db, GAME, 1991, { now: minute(1) })
    const before = await readGameData(db, GAME)
    expect(await applyImport(db, plan, { now: minute(2) })).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'changed-since-preview' }],
    })
    expect(await readGameData(db, GAME)).toStrictEqual(before)
    expect(await listCheckpoints(db, GAME)).toEqual([])
  })

  it('IMP-07 同局、同年、同時點、同類型、同雜湊再次匯入 → 提示重複，不重複建立歷程', async () => {
    const db = await game()
    const first = await applyFile(db, importFile('may-herd', 1990), undefined, minute(1))
    const before = await readGameData(db, GAME)
    expect(await judgeFile(db, importFile('may-herd', 1990))).toStrictEqual({
      kind: 'duplicate',
      record: first.record,
    })
    expect(await readGameData(db, GAME)).toStrictEqual(before)
  })

  it('IMP-08 同年、同時點、同類型但內容不同 → 要求確認資料更正，保存來源檔與時間（原值與新值由各類型的事件保存，4-3 起）', async () => {
    const db = await game()
    const original = importFile('may-herd', 1990, { fileName: 'A.txt', sha256: 'a' })
    const first = await applyFile(db, original, undefined, minute(1))
    const fixed = importFile('may-herd', 1990, { fileName: 'B.txt', sha256: 'b' })
    expect(await judgeFile(db, fixed)).toMatchObject({
      kind: 'ready',
      options: ['correction'],
      corrects: first.record.id,
    })
    const corrected = await applyFile(db, fixed, { mode: 'correction' }, minute(2))
    expect(corrected.record).toMatchObject({
      mode: 'correction',
      corrects: first.record.id,
      fileName: 'B.txt',
      sha256: 'b',
      appliedAt: minute(2).toISOString(),
    })
    // 被更正的那一筆保留：兩份來源檔的檔名、雜湊與套用時間都在
    expect(await db.imports.get(first.record.id)).toStrictEqual(first.record)
  })

  it('IMP-09 年度匯入的檔案早於目前進度 → 預覽提供回溯到對應檢查點；回溯後重新預覽再套用', async () => {
    const db = await game()
    const { january, checkpoints } = await januaryAndMay(db)
    const april = importFile('april-foals', 1990)
    const judgment = await judgeFile(db, april)
    if (judgment.kind !== 'ready') throw new Error(judgment.kind)
    expect(judgment.options).toEqual(['rollback', 'catch-up'])
    expect(judgment.recommendedCheckpoint).toBe(checkpoints[0]!.checkpoint.id)

    // 回溯（CKPT-04）：驗證並預覽，確認後下載目前備份再還原
    const read = await readCheckpoint(db, GAME, judgment.recommendedCheckpoint!)
    if (read.status !== 'ok') throw new Error(read.status)
    const rolled = await rollbackToCheckpoint(db, read.verified, {
      deliverBackup: downloadBackup,
      now: minute(3),
    })
    expect(rolled.status).toBe('done')

    // 回溯後這份檔案晚於目前進度，重新預覽成為一般套用
    expect(await judgeFile(db, april)).toMatchObject({ kind: 'ready', options: ['normal'] })
    const applied = await applyFile(db, april, undefined, minute(4))
    const records = (await db.imports.toArray()).sort((a, b) =>
      a.appliedAt.localeCompare(b.appliedAt),
    )
    expect(records).toStrictEqual([january.record, applied.record])
    const remaining = (await listCheckpoints(db, GAME)).map((checkpoint) => checkpoint.id)
    expect(remaining).toContain(checkpoints[0]!.checkpoint.id)
    expect(remaining).not.toContain(checkpoints[1]!.checkpoint.id)
  })

  it('IMP-11 匯入完成 → 只保存檔名、雜湊、年份、時點、套用時間、套用方式與結果摘要，不保存原始檔', async () => {
    const db = await game()
    const file = importFile('may-herd', 1990, {
      fileName: '1990年 5月1週_繁殖牝馬.txt',
      sha256: 'abc',
    })
    const { record } = await applyFile(db, file, undefined, minute(1))
    expect(record).toStrictEqual({
      id: record.id,
      gameId: GAME,
      type: 'may-herd',
      year: 1990,
      timing: { month: 5, week: 1 },
      fileName: '1990年 5月1週_繁殖牝馬.txt',
      sha256: 'abc',
      appliedAt: minute(1).toISOString(),
      mode: 'normal',
      summary: { total: 0, applied: 0, skipped: 0 },
    })
    expect(await db.imports.toArray()).toStrictEqual([record])
  })

  it('IMP-12 年度匯入套用成功 → 自動建立檢查點並依 12.2 自動備份；累加匯入與選用匯入 → 不建立檢查點', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const downloads = stubDownloads()
    const annual = await applyFile(
      db,
      importFile('january-two-year-olds', 1990),
      undefined,
      minute(1),
    )
    expect(annual.checkpoint?.status).toBe('done')
    expect(annual.backup?.status).toBe('done')
    expect(downloads).toHaveLength(1)
    const candidates = await applyFile(db, importFile('candidates', 1990), undefined, minute(2))
    const stallions = await applyFile(db, importFile('stallion-list', 1990), undefined, minute(3))
    expect(candidates).toStrictEqual({ record: candidates.record })
    expect(stallions).toStrictEqual({ record: stallions.record })
    expect(await listCheckpoints(db, GAME)).toHaveLength(1)
    expect(downloads).toHaveLength(1)
  })

  it('IMP-14 目前 1968 年時匯入 1969年 1月1週._二歲新馬.txt → 詢問是否推進到 1969 年；確認後推進再套用，不確認則不套用', async () => {
    const db = await game(1968)
    const file = importFile('january-two-year-olds', 1969, {
      fileName: '1969年 1月1週._二歲新馬.txt',
      fileTiming: { month: 1, week: 1 },
    })
    const judgment = await judgeFile(db, file)
    if (judgment.kind !== 'ready') throw new Error(judgment.kind)
    expect(judgment.advanceYear).toBe(1969)
    expect(() => buildImportPlan(judgment, { mode: 'normal' }, EMPTY_CONTENT)).toThrow(RangeError)
    expect(await db.imports.count()).toBe(0)
    expect((await loadGame(db, GAME)).currentYear).toBe(1968)
    await applyFile(db, file, { mode: 'normal', advanceConfirmed: true }, minute(1))
    expect((await loadGame(db, GAME)).currentYear).toBe(1969)
    expect(await db.imports.count()).toBe(1)
  })

  it('IMP-15 檔案年份比目前晚兩年以上 → 推進詢問外另顯示警告，確認後記在匯入紀錄', async () => {
    const db = await game(1968)
    expect(await judgeFile(db, importFile('january-two-year-olds', 1969))).toMatchObject({
      warnings: [],
    })
    const far = importFile('january-two-year-olds', 1970)
    const warnings = [{ kind: 'year-far-ahead', from: 1968, to: 1970 }]
    expect(await judgeFile(db, far)).toMatchObject({ advanceYear: 1970, warnings })
    const { record } = await applyFile(
      db,
      far,
      { mode: 'normal', advanceConfirmed: true },
      minute(1),
    )
    expect(record.confirmedWarnings).toStrictEqual(warnings)
  })

  it('IMP-16 同一時點先後匯入不同類型（5 月 1 週的繁殖圈名單與種牡馬總表）→ 各自套用，不視為重複或資料更正', async () => {
    const db = await game()
    await applyFile(db, importFile('may-herd', 1990, { sha256: 'same' }), undefined, minute(1))
    const stallions = importFile('stallion-list', 1990, {
      sha256: 'same',
      fileTiming: { month: 5, week: 1 },
    })
    expect(await judgeFile(db, stallions)).toMatchObject({ kind: 'ready', options: ['normal'] })
    const { record } = await applyFile(db, stallions, undefined, minute(2))
    expect(record.mode).toBe('normal')
    expect(await db.imports.count()).toBe(2)
  })

  it('IMP-19 同年先後匯入兩份內容不同的候選 TXT 或目標種牡馬 TXT → 各自套用，早於目前進度也不提示回溯；同一份檔案再次匯入 → 提示重複', async () => {
    const db = await game()
    await januaryAndMay(db)
    for (const type of ['candidates', 'target-stallion'] as const) {
      const first = await applyFile(db, importFile(type, 1989, { sha256: `${type}-1` }))
      const second = await judgeFile(db, importFile(type, 1989, { sha256: `${type}-2` }))
      expect(second).toMatchObject({ kind: 'ready', options: ['normal'] })
      expect(second).not.toHaveProperty('corrects')
      expect(await judgeFile(db, importFile(type, 1989, { sha256: `${type}-1` }))).toStrictEqual({
        kind: 'duplicate',
        record: first.record,
      })
    }
  })

  it('IMP-20 已匯入 1970 年 5 月繁殖圈名單，才發現漏匯 1970 年 4 月誕生幼駒名單 → 可選直接補匯，不回溯；該年四月工作標示完成，結果標示補匯（幼駒由 4-6 接上）', async () => {
    const db = await game(1970)
    const { may } = await januaryAndMay(db, 1970)
    const april = importFile('april-foals', 1970)
    const { record } = await applyFile(db, april, { mode: 'catch-up' }, minute(3))
    expect(record).toMatchObject({ type: 'april-foals', year: 1970, mode: 'catch-up' })
    // 不回溯：五月的紀錄還在，目前進度不變
    const records = await db.imports.toArray()
    expect(records).toContainEqual(may.record)
    expect(importProgress(records)).toStrictEqual({ year: 1970, timing: { month: 5, week: 1 } })
  })

  it('IMP-21 早於目前進度、且同局同年同時點同類型已匯入過的年度檔案 → 只提供回溯或資料更正，不提供直接補匯', async () => {
    const db = await game()
    const { january } = await januaryAndMay(db)
    const judgment = await judgeFile(
      db,
      importFile('january-two-year-olds', 1990, { sha256: 'fixed' }),
    )
    expect(judgment).toMatchObject({
      kind: 'ready',
      options: ['rollback', 'correction'],
      corrects: january.record.id,
    })
  })

  it('IMP-05 匯入預覽 → 分列可套用、略過、待核對、警告、錯誤筆數（一月二歲馬總表）', async () => {
    const db = await januaryGame([
      ownFoal('F1', { abilityNumber: '0x0101' }),
      ownFoal('F2', {
        abilityNumber: '0x0102',
        fullName: 'ハナコ',
        baseName: 'ハナコ',
        nameSource: 'import',
      }),
      ownFoal('F3', { abilityNumber: '0x0FFF' }),
    ])
    const rows = [
      // 可套用，帶第 77 欄的警告
      januaryRow({
        fullName: '(市)ジブン',
        baseName: 'ジブン',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0101',
        horseNumber: '0x2101',
      }),
      // 經匯入確認的馬名不同：錯誤
      januaryRow({
        fullName: 'ハナヨ',
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0102',
        horseNumber: '0x2102',
      }),
      // 非管理的馬：略過
      januaryRow({
        fullName: 'タニン',
        sire: 'ベツ',
        dam: 'ベツハハ',
        abilityNumber: '0x0103',
        horseNumber: '0x2103',
      }),
    ]
    const { preview } = await previewJanuaryFile(db, rows)
    expect(preview.counts).toStrictEqual({
      applicable: 1,
      skipped: 1,
      errors: 1,
      pending: 1,
      warnings: 1,
    })
  })

  it('IMP-08 一月二歲馬總表的資料更正 → 原值與新值在事件裡，事件連到這次的匯入紀錄，被更正的那一筆的檔名、雜湊與時間都在', async () => {
    const db = await januaryGame([ownFoal('F1', { abilityNumber: '0x0101' })])
    const row = (fullName: string) =>
      januaryRow({
        fullName,
        sire: 'チチ',
        dam: 'ハハ',
        abilityNumber: '0x0101',
        horseNumber: '0x2101',
      })
    const first = await applyJanuaryFile(db, [row('アオバ')])
    const second = await applyJanuaryFile(db, [row('アオバオー')])
    const corrected = second.applied.record
    expect(corrected.mode).toBe('correction')
    const original = await db.imports.get(corrected.corrects!)
    expect(original).toStrictEqual(first.applied.record)
    expect(original?.sha256).not.toBe(corrected.sha256)
    const events = (await db.events.toArray()).filter(
      (event) => event.source.kind === 'import' && event.source.importId === corrected.id,
    )
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'foal-name-imported',
        horseId: 'F1',
        from: 'アオバ',
        to: 'アオバオー',
      }),
    ])
  })

  it('IMP-10 一月二歲馬總表 → 只更新自己負責的欄位：正式馬名、別名、能力番号與競走馬馬番号；父母、出生年、能力、牧場處置與其他資料不變', async () => {
    const foal = ownFoal('F1', {
      fullName: 'テガキ',
      baseName: 'テガキ',
      nameSource: 'manual',
      sireName: 'チチ',
      damName: 'ハハ',
      sireSystem: 'エクリプス',
      pedigreeSource: 'import',
      ability: { speed: 70, stamina: 40, turf: '◎', offspringQuality: 3 },
      femaleLine: 'ヒンケイ',
      disposition: 'sold',
      note: '一歲時售出',
    })
    const db = await januaryGame([foal])
    await db.mares.add(startMareRow('M1'))
    const before = await readGameData(db, GAME)
    const row = januaryRow({
      fullName: 'ジブン',
      sire: 'チチ',
      dam: 'ハハ',
      abilityNumber: '0x0101',
      horseNumber: '0x2101',
    })
    await applyJanuaryFile(db, [row])
    const after = await readGameData(db, GAME)
    expect(after.horses.find((horse) => horse.id === 'F1')).toStrictEqual({
      ...foal,
      fullName: 'ジブン',
      baseName: 'ジブン',
      nameSource: 'import',
      aliases: ['テガキ'],
      abilityNumber: '0x0101',
    })
    const others = (horses: typeof before.horses) => horses.filter((horse) => horse.id !== 'F1')
    expect(others(after.horses)).toStrictEqual(others(before.horses))
    // 變動的只有遊戲局的更新時間、這匹產駒、事件、階段馬番号與匯入紀錄
    const changed = new Set(['games', 'horses', 'events', 'horseNumbers', 'imports'])
    for (const name of GAME_TABLES) {
      if (!changed.has(name)) expect(after[name]).toStrictEqual(before[name])
    }
  })

  it('IMP-10 五月繁殖圈名單 → 只更新自己負責的資料：據點、補上的能力番号與出生年、繁殖牝馬馬番号；馬名與血統（4-5 補齊）、已離圈的母馬與其他資料不變', async () => {
    const mare = horseRow('M', {
      fullName: 'テガキ',
      baseName: 'テガキ',
      nameSource: 'manual',
      sex: 'female',
      sireName: '手動の父',
      pedigreeSource: 'manual',
      femaleLine: 'ヒンケイ',
      note: '手動新增',
    })
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([mare, horseRow('O', { abilityNumber: '0x0F00', birthYear: 1975 })])
    await db.mares.bulkAdd([
      ungroupedMareRow('M', 'unassigned', { location: 32 }),
      startMareRow('O', { herd: 'sold' }),
    ])
    await db.lines.add(lineRow(1, '系1子'))
    const before = await readGameData(db, GAME)
    const row = mayRow({
      fullName: 'テガキ',
      age: 10,
      sire: 'チチ',
      farm: '33',
      abilityNumber: '0x0701',
      horseNumber: '0x1701',
    })
    await applyMayFile(db, [row])
    const after = await readGameData(db, GAME)
    expect(after.horses.find((horse) => horse.id === 'M')).toStrictEqual({
      ...mare,
      abilityNumber: '0x0701',
      birthYear: 1980,
    })
    expect(after.mares.find((row) => row.horseId === 'M')).toStrictEqual(
      ungroupedMareRow('M', 'unassigned', { location: 33 }),
    )
    expect(after.horses.filter((horse) => horse.id !== 'M')).toStrictEqual(
      before.horses.filter((horse) => horse.id !== 'M'),
    )
    expect(after.mares.filter((row) => row.horseId !== 'M')).toStrictEqual(
      before.mares.filter((row) => row.horseId !== 'M'),
    )
    // 變動的只有遊戲局的更新時間、這匹母馬、事件、階段馬番号與匯入紀錄
    const changed = new Set(['games', 'horses', 'mares', 'events', 'horseNumbers', 'imports'])
    for (const name of GAME_TABLES) {
      if (!changed.has(name)) expect(after[name]).toStrictEqual(before[name])
    }
  })
})
