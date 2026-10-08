import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { stubDownloads } from '../../tests/support/download'
import { fakeFolder, storeFakeFolder } from '../../tests/support/folder'
import { importRecord } from '../../tests/support/imports'
import {
  GAME,
  checkpointRow,
  horseRow,
  ownMareRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../../tests/support/rows'
import type { FoalNameItem, ImportPlan } from '../core/imports'
import { listCheckpoints } from './checkpoints'
import { loadGame } from './games'
import type {
  EventContent,
  EventRow,
  EventSource,
  GameRow,
  HorseNumberRow,
  HorseStage,
} from './records'
import { applyImport, loadImportSnapshot } from './imports'
import { APP_VERSION } from './version'

describe('loadImportSnapshot', () => {
  it('遊戲局的目前遊戲年與更新時間、這一局的匯入紀錄與檢查點的摘要（技術設計 4.4「資料流」）', async () => {
    const db = testDatabase()
    await addTestGame(db, { currentYear: 1971, updatedAt: '2026-10-01T01:00:00.000Z' })
    await addTestGame(db, { id: 'G2' })
    const records = [importRecord('I1', 'may-herd', 1970), importRecord('I2', 'candidates', 1971)]
    await db.imports.bulkAdd([...records, importRecord('I3', 'may-herd', 1970, { gameId: 'G2' })])
    await db.checkpoints.bulkAdd([
      checkpointRow('C1', {
        origin: 'auto',
        year: 1970,
        timing: { month: 5, week: 1 },
        catchUp: { year: 1970, timing: { month: 4, week: 1 } },
        createdAt: '2026-10-01T00:00:01.000Z',
        note: '存檔 A',
        pinned: true,
      }),
      checkpointRow('C2', { year: 1971, createdAt: '2026-10-01T00:00:02.000Z' }),
      checkpointRow('C3', { gameId: 'G2' }),
    ])
    const scope = { type: 'candidates', year: 1971 } as const
    expect(await loadImportSnapshot(db, GAME, scope)).toStrictEqual({
      gameId: GAME,
      currentYear: 1971,
      updatedAt: '2026-10-01T01:00:00.000Z',
      imports: records,
      checkpoints: [
        {
          id: 'C1',
          year: 1970,
          timing: { month: 5, week: 1 },
          createdAt: '2026-10-01T00:00:01.000Z',
        },
        { id: 'C2', year: 1971, createdAt: '2026-10-01T00:00:02.000Z' },
      ],
    })
  })

  it('一月二歲馬總表：另讀出生年為年份減 2 的自家產駒，帶父母名的兩種值與已記的競走馬馬番号（技術設計 4.4「一月」）', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('S1', { fullName: 'チチイチ', baseName: 'チチイチ', nameSource: 'import' }),
      horseRow('S2', { fullName: 'チチニ', baseName: 'チチニ', nameSource: 'manual' }),
      horseRow('M1', { fullName: '(外)ハハイチ', baseName: 'ハハイチ', nameSource: 'import' }),
      horseRow('M2', { fullName: 'ハハニ', baseName: 'ハハニ', nameSource: 'manual' }),
      // 父母連結的馬：經匯入確認的名稱只取匯入的
      horseRow('F1', {
        birthYear: 1988,
        sex: 'male',
        sireId: 'S1',
        damId: 'M1',
        birth: {},
        abilityNumber: '0x0101',
        fullName: 'テイオー',
        baseName: 'テイオー',
        nameSource: 'import',
      }),
      horseRow('F2', {
        birthYear: 1988,
        sex: 'female',
        sireId: 'S2',
        damId: 'M2',
        birth: {},
        fullName: 'カリナ',
        baseName: 'カリナ',
        nameSource: 'manual',
      }),
      // 保存的名稱優先於連結的馬；手動輸入的保存名稱不算經匯入確認
      horseRow('F3', {
        birthYear: 1988,
        sex: 'male',
        sireId: 'S2',
        sireName: 'ガイブチチ',
        damId: 'M1',
        pedigreeSource: 'import',
        birth: {},
      }),
      horseRow('F4', {
        birthYear: 1988,
        sex: 'female',
        sireName: 'テウチチチ',
        damId: 'M2',
        pedigreeSource: 'manual',
        birth: {},
      }),
      // 不讀：其他出生年、市場馬（沒有出生紀錄）、其他局
      horseRow('F5', { birthYear: 1989, sex: 'male', damId: 'M1', birth: {} }),
      horseRow('X1', {
        birthYear: 1988,
        sex: 'female',
        fullName: 'シジョウ',
        baseName: 'シジョウ',
      }),
      horseRow('F6', { gameId: 'G2', birthYear: 1988, birth: {} }),
    ])
    await db.horseNumbers.bulkAdd([
      numberRow('N1', 'F1', 'racehorse', '0x0201'),
      numberRow('N2', 'F1', 'foal', '0x0301'),
      numberRow('N3', 'F2', 'racehorse', '0x0202'),
      numberRow('N4', 'F5', 'racehorse', '0x0203'),
    ])
    const scope = { type: 'january-two-year-olds', year: 1990 } as const
    const snapshot = await loadImportSnapshot(db, GAME, scope)
    expect(snapshot.january).toStrictEqual({
      birthYear: 1988,
      foals: [
        {
          id: 'F1',
          birthYear: 1988,
          abilityNumber: '0x0101',
          fullName: 'テイオー',
          baseName: 'テイオー',
          nameSource: 'import',
          sire: { confirmed: 'チチイチ', known: 'チチイチ' },
          dam: { confirmed: 'ハハイチ', known: 'ハハイチ' },
          racehorseNumbers: ['0x0201'],
        },
        {
          id: 'F2',
          birthYear: 1988,
          fullName: 'カリナ',
          baseName: 'カリナ',
          nameSource: 'manual',
          sire: { known: 'チチニ' },
          dam: { known: 'ハハニ' },
          racehorseNumbers: ['0x0202'],
        },
        {
          id: 'F3',
          birthYear: 1988,
          sire: { confirmed: 'ガイブチチ', known: 'ガイブチチ' },
          dam: { confirmed: 'ハハイチ', known: 'ハハイチ' },
          racehorseNumbers: [],
        },
        {
          id: 'F4',
          birthYear: 1988,
          sire: { known: 'テウチチチ' },
          dam: { known: 'ハハニ' },
          racehorseNumbers: [],
        },
      ],
    })
    expect(snapshot.imports).toStrictEqual([])
    expect(snapshot.may).toBeUndefined()
  })

  it('五月繁殖圈名單：另讀上次五月匯入、定年、這一局的母馬與還沒進過繁殖圈的自家牝駒（技術設計 4.4「五月對帳」）', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.settings.update(GAME, { retirementAge: 24 })
    await db.imports.bulkAdd([
      importRecord('I1', 'may-herd', 1988, { appliedAt: '2026-10-02T00:00:00.000Z' }),
      // 同年有資料更正時，套用時間較晚的是上次
      importRecord('I2', 'may-herd', 1989, { appliedAt: '2026-10-03T00:00:00.000Z' }),
      importRecord('I3', 'may-herd', 1989, {
        appliedAt: '2026-10-04T00:00:00.000Z',
        mode: 'correction',
        corrects: 'I2',
      }),
      // 不算：年份不早於這份名單、其他類型、後來才補匯的較早年份、其他局
      importRecord('I4', 'may-herd', 1990, { appliedAt: '2026-10-05T00:00:00.000Z' }),
      importRecord('I5', 'july-conception', 1989, { appliedAt: '2026-10-06T00:00:00.000Z' }),
      importRecord('I6', 'may-herd', 1987, {
        appliedAt: '2026-10-07T00:00:00.000Z',
        mode: 'catch-up',
      }),
      importRecord('I7', 'may-herd', 1989, {
        gameId: 'G2',
        appliedAt: '2026-10-08T00:00:00.000Z',
      }),
    ])
    await db.horses.bulkAdd([
      horseRow('S1', { fullName: 'チチイチ', baseName: 'チチイチ', nameSource: 'import' }),
      horseRow('D1', { fullName: 'ハハイチ', baseName: 'ハハイチ', nameSource: 'manual' }),
      // 母馬：在圈的自家母駒、已售出的替代母馬（父母名手動輸入）、沒有能力番号的待指定用途
      horseRow('A', {
        fullName: '(外)エーコ',
        baseName: 'エーコ',
        nameSource: 'import',
        abilityNumber: '0x0A00',
        birthYear: 1980,
        sex: 'female',
        sireId: 'S1',
        damId: 'D1',
        birth: { placement: { line: 1, generation: 2 } },
      }),
      horseRow('B', {
        fullName: 'ビーコ',
        baseName: 'ビーコ',
        nameSource: 'manual',
        abilityNumber: '0x0B00',
        birthYear: 1982,
        sex: 'female',
        sireName: 'テウチチチ',
        damName: 'テウチハハ',
        pedigreeSource: 'manual',
      }),
      horseRow('C', {
        fullName: 'シーコ',
        baseName: 'シーコ',
        nameSource: 'manual',
        sex: 'female',
      }),
      // 自家牝駒：指定配種所生、自由配種所生而且已售出
      horseRow('F1', {
        birthYear: 1988,
        sex: 'female',
        sireId: 'S1',
        damId: 'A',
        abilityNumber: '0x0F01',
        fullName: 'エフイチ',
        baseName: 'エフイチ',
        nameSource: 'import',
        birth: { breedingId: 'BR1', placement: { line: 1, generation: 3 } },
        disposition: 'keep',
      }),
      horseRow('F2', {
        birthYear: 1985,
        sex: 'female',
        damId: 'A',
        birth: {},
        disposition: 'sold',
      }),
      // 不讀：出生年晚於年份減 2、牡駒、市場馬、已進過繁殖圈（A）、其他局
      horseRow('F3', { birthYear: 1989, sex: 'female', damId: 'A', birth: {} }),
      horseRow('F4', { birthYear: 1985, sex: 'male', damId: 'A', birth: {} }),
      horseRow('F5', { birthYear: 1985, sex: 'female' }),
      horseRow('F6', { gameId: 'G2', birthYear: 1985, sex: 'female', birth: {} }),
      horseRow('X', { gameId: 'G2', sex: 'female' }),
    ])
    await db.mares.bulkAdd([
      ownMareRow('A', 1, 2, { location: 32 }),
      substituteMareRow('B', 3, 4, { herd: 'sold', location: 33 }),
      ungroupedMareRow('C', 'unassigned'),
      ungroupedMareRow('X', 'unassigned', { gameId: 'G2' }),
    ])
    await db.horseNumbers.bulkAdd([
      numberRow('N1', 'A', 'broodmare', '0x0A01'),
      numberRow('N2', 'A', 'foal', '0x0A02'),
      numberRow('N3', 'B', 'broodmare', '0x0B01'),
      numberRow('N4', 'B', 'broodmare', '0x0B02'),
      numberRow('N5', 'F1', 'foal', '0x0F02'),
    ])
    const scope = { type: 'may-herd', year: 1990 } as const
    const snapshot = await loadImportSnapshot(db, GAME, scope)
    const flags = { entered: false, soldByUser: false, departedThisYear: false }
    expect(snapshot.may).toStrictEqual({
      year: 1990,
      lastMay: { id: 'I3', year: 1989, appliedAt: '2026-10-04T00:00:00.000Z' },
      retirementAge: 24,
      mares: [
        {
          id: 'A',
          abilityNumber: '0x0A00',
          birthYear: 1980,
          fullName: '(外)エーコ',
          baseName: 'エーコ',
          nameSource: 'import',
          sire: { confirmed: 'チチイチ', known: 'チチイチ' },
          dam: { known: 'ハハイチ' },
          usage: 'own',
          groupLine: 1,
          groupGeneration: 2,
          herd: 'in-herd',
          location: 32,
          broodmareNumbers: ['0x0A01'],
          ...flags,
        },
        {
          id: 'B',
          abilityNumber: '0x0B00',
          birthYear: 1982,
          fullName: 'ビーコ',
          baseName: 'ビーコ',
          nameSource: 'manual',
          sire: { known: 'テウチチチ' },
          dam: { known: 'テウチハハ' },
          usage: 'substitute',
          groupLine: 3,
          groupGeneration: 4,
          herd: 'sold',
          location: 33,
          broodmareNumbers: ['0x0B01', '0x0B02'],
          ...flags,
        },
        {
          id: 'C',
          fullName: 'シーコ',
          baseName: 'シーコ',
          nameSource: 'manual',
          sire: {},
          dam: {},
          usage: 'unassigned',
          herd: 'in-herd',
          broodmareNumbers: [],
          ...flags,
        },
      ],
      fillies: [
        {
          id: 'F2',
          birthYear: 1985,
          sire: {},
          dam: { confirmed: 'エーコ', known: 'エーコ' },
          free: true,
          sold: true,
        },
        {
          id: 'F1',
          abilityNumber: '0x0F01',
          birthYear: 1988,
          fullName: 'エフイチ',
          baseName: 'エフイチ',
          nameSource: 'import',
          sire: { confirmed: 'チチイチ', known: 'チチイチ' },
          dam: { confirmed: 'エーコ', known: 'エーコ' },
          free: false,
          sold: false,
        },
      ],
    })
    expect(snapshot.january).toBeUndefined()
  })

  it('五月的三個旗標：上次五月匯入之後寫入的事件依寫入時間排序，取最後一筆離圈事件（技術設計 4.4「五月對帳」）', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    const may1990 = { kind: 'import', importType: 'may-herd', importId: 'I2' } as const
    const candidates = { kind: 'import', importType: 'candidates', importId: 'I3' } as const
    await db.imports.bulkAdd([
      importRecord('I1', 'may-herd', 1989, { appliedAt: at(10) }),
      // 年份與這份名單相同的五月（資料更正時被更正的那一筆）
      importRecord('I2', 'may-herd', 1990, { appliedAt: at(12) }),
      importRecord('I3', 'candidates', 1989, { appliedAt: at(11) }),
      // 上次五月之後才補匯的較早年份五月
      importRecord('I4', 'may-herd', 1987, { appliedAt: at(13), mode: 'catch-up' }),
    ])
    const may1987 = { kind: 'import', importType: 'may-herd', importId: 'I4' } as const
    const ids = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'MR']
    await db.horses.bulkAdd(ids.map((id) => horseRow(id, { sex: 'female' })))
    await db.mares.bulkAdd([
      ungroupedMareRow('M1', 'unassigned'),
      ungroupedMareRow('M2', 'unassigned'),
      ungroupedMareRow('M3', 'unassigned'),
      ungroupedMareRow('M4', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('M5', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('M6', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('M7', 'unassigned', { herd: 'retired' }),
      ungroupedMareRow('M8', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('M9', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('MR', 'unassigned'),
    ])
    const placement = { usage: 'unassigned' } as const
    const added = (horseId: string) =>
      ({ kind: 'mare-added', horseId, placement, mareSource: { kind: 'other' } }) as const
    const sold = (horseId: string) => ({ kind: 'mare-departed', horseId, reason: 'sold' }) as const
    await db.events.bulkAdd([
      // M1、M2：上次五月之後新增、回歸；M3：上次五月之前新增
      eventRow('E1', 1989, at(13), added('M1')),
      eventRow(
        'E2',
        1990,
        at(14),
        { kind: 'mare-returned', horseId: 'M2', from: 'sold' },
        candidates,
      ),
      eventRow('E3', 1989, at(9), added('M3')),
      // M4：上次五月之後手動登記賣出；M5：手動賣出的寫入時間不晚於上次五月的套用時間
      eventRow('E4', 1989, at(15), sold('M4')),
      eventRow('E5', 1989, at(10), sold('M5')),
      // M6：年份與名單相同的五月判定缺席（寫入時間就是那次的套用時間）
      eventRow('E6', 1990, at(12), sold('M6'), may1990),
      // M7：手動改成定年引退，在圈狀態不是售出
      eventRow('E7', 1990, at(16), {
        kind: 'mare-departure-corrected',
        horseId: 'M7',
        from: 'sold',
        to: 'retired',
      }),
      // M8：年份較晚的事件寫入時間較早；依寫入時間，最後一筆是今年五月判定的缺席
      eventRow('E8', 1991, at(17), sold('M8')),
      eventRow('E9', 1990, at(18), sold('M8'), may1990),
      // M9：較早年份的五月判定缺席，不是今年的
      eventRow('E11', 1990, at(13), sold('M9'), may1987),
      // MR：今年五月判定缺席後撤銷，已回到生產中
      eventRow('E12', 1990, at(12), sold('MR'), may1990),
      eventRow('E13', 1990, at(19), {
        kind: 'mare-departure-corrected',
        horseId: 'MR',
        from: 'sold',
        to: 'in-herd',
      }),
      // 其他局
      eventRow('E10', 1990, at(20), added('M3'), { kind: 'manual' }, 'G2'),
    ])
    const scope = { type: 'may-herd', year: 1990 } as const
    const snapshot = await loadImportSnapshot(db, GAME, scope)
    const flags = snapshot.may?.mares.map(({ id, entered, soldByUser, departedThisYear }) => ({
      id,
      entered,
      soldByUser,
      departedThisYear,
    }))
    expect(flags).toStrictEqual([
      { id: 'M1', entered: true, soldByUser: false, departedThisYear: false },
      { id: 'M2', entered: true, soldByUser: false, departedThisYear: false },
      { id: 'M3', entered: false, soldByUser: false, departedThisYear: false },
      { id: 'M4', entered: false, soldByUser: true, departedThisYear: false },
      { id: 'M5', entered: false, soldByUser: false, departedThisYear: false },
      { id: 'M6', entered: false, soldByUser: false, departedThisYear: true },
      { id: 'M7', entered: false, soldByUser: false, departedThisYear: false },
      { id: 'M8', entered: false, soldByUser: false, departedThisYear: true },
      { id: 'M9', entered: false, soldByUser: false, departedThisYear: false },
      { id: 'MR', entered: false, soldByUser: false, departedThisYear: false },
    ])
  })

  it('五月：沒有上次五月匯入時，這一局的全部事件都算', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([horseRow('M1', { sex: 'female' }), horseRow('M2', { sex: 'female' })])
    await db.mares.bulkAdd([
      ungroupedMareRow('M1', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('M2', 'unassigned'),
    ])
    await db.events.bulkAdd([
      eventRow('E1', 1970, at(1), { kind: 'mare-departed', horseId: 'M1', reason: 'sold' }),
      eventRow(
        'E2',
        1970,
        at(2),
        { kind: 'mare-returned', horseId: 'M2', from: 'sold' },
        { kind: 'manual' },
        'G2',
      ),
    ])
    const snapshot = await loadImportSnapshot(db, GAME, { type: 'may-herd', year: 1990 })
    expect(snapshot.may?.lastMay).toBeUndefined()
    expect(
      snapshot.may?.mares.map((mare) => [mare.id, mare.entered, mare.soldByUser]),
    ).toStrictEqual([
      ['M1', false, true],
      ['M2', false, false],
    ])
  })

  it('五月：母馬的馬匹或連結的父母不在 horses 中時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.mares.add(ungroupedMareRow('M1', 'unassigned'))
    const scope = { type: 'may-herd', year: 1990 } as const
    await expect(loadImportSnapshot(db, GAME, scope)).rejects.toThrow('找不到馬匹：M1')
    await db.horses.add(horseRow('M1', { sex: 'female', damId: 'M9' }))
    await expect(loadImportSnapshot(db, GAME, scope)).rejects.toThrow('找不到馬匹：M9')
  })

  it('產駒連結的父母不在 horses 中時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.add(horseRow('F1', { birthYear: 1988, damId: 'M9', birth: {} }))
    const scope = { type: 'january-two-year-olds', year: 1990 } as const
    await expect(loadImportSnapshot(db, GAME, scope)).rejects.toThrow('找不到馬匹：M9')
  })

  it('遊戲局不存在時丟出錯誤', async () => {
    const scope = { type: 'may-herd', year: 1990 } as const
    await expect(loadImportSnapshot(testDatabase(), 'missing', scope)).rejects.toThrow(
      '找不到遊戲局：missing',
    )
  })
})

/** 階段馬番号：1988 年手動記的 */
function numberRow(id: string, horseId: string, stage: HorseStage, number: string): HorseNumberRow {
  return { id, gameId: GAME, horseId, stage, number, year: 1988, source: { kind: 'manual' } }
}

/** 2026-10-01 的 hour 點整（ISO 8601），事件的寫入時間與匯入的套用時間用 */
function at(hour: number): string {
  return `2026-10-01T${String(hour).padStart(2, '0')}:00:00.000Z`
}

/** 一筆事件：來源預設手動，遊戲局預設 GAME */
function eventRow(
  id: string,
  year: number,
  recordedAt: string,
  content: EventContent,
  source: EventSource = { kind: 'manual' },
  gameId = GAME,
): EventRow {
  return { ...content, id, gameId, year, recordedAt, source }
}

describe('applyImport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const NOW = new Date('2026-10-01T03:00:00.000Z')

  /** 1990 年五月繁殖圈名單的計畫；預覽時的更新時間是 addTestGame 的預設值 */
  function plan(fields: Partial<ImportPlan> = {}): ImportPlan {
    return {
      gameId: GAME,
      expectedUpdatedAt: '2026-09-24T00:00:00.000Z',
      type: 'may-herd',
      year: 1990,
      timing: { month: 5, week: 1 },
      fileName: '1990年 5月1週_繁殖牝馬.txt',
      sha256: 'abc',
      mode: 'normal',
      summary: { total: 2, applied: 0, skipped: 2 },
      items: [],
      ...fields,
    }
  }

  it('寫入匯入紀錄，遊戲局的更新時間與應用版本跟著更新；選用匯入不申請權限、不建檢查點、不備份', async () => {
    const db = testDatabase()
    await addTestGame(db, { appVersion: '0.0.0-old' })
    vi.stubGlobal('showDirectoryPicker', async () => ({}))
    const folder = fakeFolder()
    storeFakeFolder(db, folder.folder)
    const downloads = stubDownloads()
    const october = plan({
      type: 'october-mares',
      timing: { month: 10, week: 1 },
      fileName: '1990年10月1週_繁殖牝馬.txt',
    })
    const result = await applyImport(db, october, { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    const { record } = result.value
    expect(result.value).toStrictEqual({ record })
    expect(record).toStrictEqual({
      id: record.id,
      gameId: GAME,
      type: 'october-mares',
      year: 1990,
      timing: { month: 10, week: 1 },
      fileName: '1990年10月1週_繁殖牝馬.txt',
      sha256: 'abc',
      appliedAt: NOW.toISOString(),
      mode: 'normal',
      summary: { total: 2, applied: 0, skipped: 2 },
    })
    expect(await db.imports.toArray()).toStrictEqual([record])
    expect(await loadGame(db, GAME)).toMatchObject({
      currentYear: 1990,
      updatedAt: NOW.toISOString(),
      appVersion: APP_VERSION,
    })
    expect(folder.queryPermission).not.toHaveBeenCalled()
    expect(await listCheckpoints(db, GAME)).toEqual([])
    expect(downloads).toHaveLength(0)
    expect(folder.files.size).toBe(0)
  })

  it('年度匯入：先申請備份權限再開交易；提交後先建立檢查點（時點是目前進度），再自動備份', async () => {
    const db = testDatabase()
    await addTestGame(db)
    vi.stubGlobal('showDirectoryPicker', async () => ({}))
    const folder = fakeFolder('備份', { query: 'prompt' })
    storeFakeFolder(db, folder.folder)
    const read = vi.spyOn(db.games, 'get')
    const addCheckpoint = vi.spyOn(db.checkpoints, 'add')
    const writeFile = vi.spyOn(folder.folder, 'getFileHandle')
    const result = await applyImport(db, plan(), { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    const { record, checkpoint, backup } = result.value
    expect(record).toMatchObject({ type: 'may-herd', mode: 'normal' })
    if (checkpoint?.status !== 'done' || backup?.status !== 'done') throw new Error('沒有完成')
    expect(checkpoint.value.checkpoint).toMatchObject({
      origin: 'auto',
      year: 1990,
      timing: { month: 5, week: 1 },
      createdAt: NOW.toISOString(),
    })
    expect(checkpoint.value.checkpoint).not.toHaveProperty('catchUp')
    expect(backup.value.delivery).toStrictEqual({ kind: 'folder', folderName: '備份' })
    expect(folder.files.has(backup.value.summary.fileName)).toBe(true)
    expect((await loadGame(db, GAME)).lastBackupAt).toBe(NOW.toISOString())
    // 點擊後的第一個 await 就申請權限（技術設計第 7 節）；檢查點在備份之前
    const order = (spy: { mock: { invocationCallOrder: number[] } }) =>
      spy.mock.invocationCallOrder[0]!
    expect(order(folder.requestPermission)).toBeLessThan(order(read))
    expect(order(addCheckpoint)).toBeLessThan(order(writeFile))
  })

  it('CKPT-08 直接補匯：檢查點記目前進度，另記補匯的年與時點；資料更正記被更正的那一筆，進度不變', async () => {
    const db = testDatabase()
    await addTestGame(db)
    stubDownloads()
    await db.imports.bulkAdd([
      importRecord('J90', 'january-two-year-olds', 1990),
      importRecord('M90', 'may-herd', 1990),
      // 別局的進度較晚，不影響這一局
      importRecord('L91', 'july-conception', 1991, { gameId: 'G2' }),
    ])
    const april = plan({
      type: 'april-foals',
      timing: { month: 4, week: 1 },
      fileName: '1990年 4月1週_幼駒誕生.txt',
      mode: 'catch-up',
    })
    const caughtUp = await applyImport(db, april, { now: NOW })
    if (caughtUp.status !== 'done' || caughtUp.value.checkpoint?.status !== 'done') {
      throw new Error('沒有完成')
    }
    expect(caughtUp.value.record.mode).toBe('catch-up')
    expect(caughtUp.value.checkpoint.value.checkpoint).toMatchObject({
      timing: { month: 5, week: 1 },
      catchUp: { year: 1990, timing: { month: 4, week: 1 } },
    })

    const later = new Date('2026-10-01T04:00:00.000Z')
    const january = plan({
      type: 'january-two-year-olds',
      expectedUpdatedAt: NOW.toISOString(),
      timing: { month: 1, week: 1 },
      mode: 'correction',
      corrects: 'J90',
    })
    const corrected = await applyImport(db, january, { now: later })
    if (corrected.status !== 'done' || corrected.value.checkpoint?.status !== 'done') {
      throw new Error('沒有完成')
    }
    expect(corrected.value.record).toMatchObject({ mode: 'correction', corrects: 'J90' })
    const { checkpoint } = corrected.value.checkpoint.value
    expect(checkpoint.timing).toStrictEqual({ month: 5, week: 1 })
    expect(checkpoint).not.toHaveProperty('catchUp')
  })

  it('推進年份與寫入紀錄在同一個交易：確認的警告記在紀錄上；寫入紀錄失敗時推進的年份也回復', async () => {
    const db = testDatabase()
    await addTestGame(db)
    stubDownloads()
    const warnings = [{ kind: 'year-far-ahead' as const, from: 1990, to: 1992 }]
    const ahead = plan({ year: 1992, advanceYear: 1992, confirmedWarnings: warnings })
    const result = await applyImport(db, ahead, { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.record.confirmedWarnings).toStrictEqual(warnings)
    expect((await loadGame(db, GAME)).currentYear).toBe(1992)

    const failing = testDatabase()
    const game = await addTestGame(failing)
    vi.spyOn(failing.imports, 'add').mockRejectedValue(new Error('寫入失敗'))
    await expect(applyImport(failing, ahead, { now: NOW })).rejects.toThrow('寫入失敗')
    expect(await loadGame(failing, GAME)).toStrictEqual(game)
    expect(await listCheckpoints(failing, GAME)).toEqual([])
  })

  it('預覽之後遊戲局有變更時回傳 changed-since-preview，什麼都不寫，也不建檢查點、不備份', async () => {
    const db = testDatabase()
    const game = await addTestGame(db, { updatedAt: '2026-09-30T00:00:00.000Z' })
    const downloads = stubDownloads()
    expect(await applyImport(db, plan({ advanceYear: 1991 }), { now: NOW })).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'changed-since-preview' }],
    })
    expect(await loadGame(db, GAME)).toStrictEqual(game)
    expect(await db.imports.count()).toBe(0)
    expect(await listCheckpoints(db, GAME)).toEqual([])
    expect(downloads).toHaveLength(0)
  })

  it('檢查點或自動備份失敗時不撤銷匯入，結果附上錯誤訊息；檢查點失敗也照樣備份', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const downloads = stubDownloads()
    vi.spyOn(db.checkpoints, 'add').mockRejectedValue(new Error('空間不足'))
    const result = await applyImport(db, plan(), { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.checkpoint).toStrictEqual({
      status: 'failed',
      error: expect.stringContaining('空間不足'),
    })
    expect(result.value.backup?.status).toBe('done')
    expect(downloads).toHaveLength(1)
    expect(await db.imports.count()).toBe(1)

    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    const offline = testDatabase()
    await addTestGame(offline)
    // 沒有 document 時下載丟出例外
    const failed = await applyImport(offline, plan(), { now: NOW })
    if (failed.status !== 'done') throw new Error(failed.status)
    expect(failed.value.checkpoint?.status).toBe('done')
    expect(failed.value.backup).toStrictEqual({
      status: 'failed',
      error: expect.stringContaining('document'),
    })
    expect(await offline.imports.count()).toBe(1)
    expect((await loadGame(offline, GAME)).lastBackupAt).toBeUndefined()
  })

  /** 一月二歲馬總表的計畫：1990 年 1 月 1 週 */
  function januaryPlan(items: FoalNameItem[], fields: Partial<ImportPlan> = {}): ImportPlan {
    return plan({
      type: 'january-two-year-olds',
      timing: { month: 1, week: 1 },
      fileName: '1990年 1月1週._二歲新馬.txt',
      items,
      ...fields,
    })
  }

  /** 1988 年生的自家產駒：F1 是手動名タロ，F2 已由總表填入ハナコ */
  async function januaryGame(fields: Partial<GameRow> = {}) {
    const db = testDatabase()
    await addTestGame(db, fields)
    await db.horses.bulkAdd([
      horseRow('F1', {
        birthYear: 1988,
        birth: {},
        fullName: 'タロ',
        baseName: 'タロ',
        nameSource: 'manual',
      }),
      horseRow('F2', {
        birthYear: 1988,
        birth: {},
        fullName: 'ハナコ',
        baseName: 'ハナコ',
        nameSource: 'import',
        abilityNumber: '0x0002',
      }),
    ])
    return db
  }

  /** 總表的一列：1988 年生，基本馬名與完整馬名相同 */
  function foalItem(horseId: string, name: string, abilityNumber: string, horseNumber: string) {
    const item: FoalNameItem = {
      kind: 'foal-name',
      horseId,
      birthYear: 1988,
      fullName: name,
      baseName: name,
      abilityNumber,
      horseNumber,
    }
    return item
  }

  const ITEMS = [
    foalItem('F1', 'タロウ', '0x0001', '0x1001'),
    foalItem('F2', 'ハナヨ', '0x0002', '0x1002'),
  ]

  it('逐項套用計畫的項目：事件與馬番号帶這次的匯入紀錄與時點；資料更正時經匯入確認的馬名也改', async () => {
    const db = await januaryGame()
    stubDownloads()
    const correction = januaryPlan(ITEMS, { mode: 'correction', corrects: 'J0' })
    const result = await applyImport(db, correction, { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    const source = {
      kind: 'import',
      importType: 'january-two-year-olds',
      importId: result.value.record.id,
    }
    const timing = { month: 1, week: 1 }
    expect(await db.horses.get('F1')).toMatchObject({
      fullName: 'タロウ',
      nameSource: 'import',
      aliases: ['タロ'],
      abilityNumber: '0x0001',
    })
    expect(await db.horses.get('F2')).toMatchObject({ fullName: 'ハナヨ', nameSource: 'import' })
    const events = await db.events.toArray()
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(event).toMatchObject({
        kind: 'foal-name-imported',
        source,
        timing,
        recordedAt: NOW.toISOString(),
      })
    }
    const numbers = await db.horseNumbers.toArray()
    expect(numbers).toHaveLength(2)
    for (const row of numbers) expect(row).toMatchObject({ stage: 'racehorse', source, timing })
  })

  it('某一項被阻止時整筆回復：推進年份、前面的項目與匯入紀錄都不留，回傳 item-blocked 指出第幾項與原因；不建檢查點、不備份', async () => {
    const db = await januaryGame({ currentYear: 1989 })
    const game = await loadGame(db, GAME)
    const horses = await db.horses.toArray()
    const downloads = stubDownloads()
    const result = await applyImport(db, januaryPlan(ITEMS, { advanceYear: 1990 }), { now: NOW })
    expect(result).toStrictEqual({
      status: 'blocked',
      blocks: [
        { kind: 'item-blocked', index: 1, item: ITEMS[1], blocks: [{ kind: 'name-confirmed' }] },
      ],
    })
    expect(await loadGame(db, GAME)).toStrictEqual(game)
    expect(await db.horses.toArray()).toStrictEqual(horses)
    expect(await db.imports.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
    expect(await db.horseNumbers.count()).toBe(0)
    expect(await listCheckpoints(db, GAME)).toEqual([])
    expect(downloads).toHaveLength(0)
  })

  it('遊戲局不存在時丟出錯誤', async () => {
    await expect(applyImport(testDatabase(), plan())).rejects.toThrow('找不到遊戲局：G')
  })
})
