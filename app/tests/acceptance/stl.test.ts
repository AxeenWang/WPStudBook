import { describe, expect, it } from 'vitest'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { checkMarketStallionSystem } from '../../src/core/stallions'
import { openLine } from '../../src/storage/line-writes'
import { loadRuleSnapshot } from '../../src/storage/loaders'
import { assignZeroStallion, setStallionStatus } from '../../src/storage/stallion-writes'
import { appointStallion } from '../../src/storage/successor-writes'
import { cp932 } from '../support/ce-bytes'
import { SAMPLES, exportText } from '../support/ce-files'
import { addTestGame, testDatabase } from '../support/database'
import { GAME, horseRow, lineRow, stallionRow } from '../support/rows'
import { successorHerd } from '../support/successor'
import { lineSystemsOf, systemTableOf } from '../support/systems'

// 需求規格第 15 章「種牡馬匯入（STL）」中由 core 與儲存層寫入負責的部分；匯入與配對由後續計畫補上

describe('種牡馬匯入（STL）', () => {
  it('STL-07 替換種牡馬的子系統與該系不同 → 警告並確認，確認後更新目前子系統名稱', () => {
    const table = systemTableOf([
      ['マンノウォー', 'マッチェム'],
      ['フェアウェイ', 'ファラリス'],
    ])
    const [, , lineThree] = lineSystemsOf({ 3: ['マンノウォー', 'マッチェム'] })
    expect(checkMarketStallionSystem(lineThree, 'フェアウェイ', table).subsystem).toEqual({
      current: 'マンノウォー',
      replacement: 'フェアウェイ',
    })
    expect(checkMarketStallionSystem(lineThree, 'マンノウォー', table).subsystem).toBeNull()
  })
})

describe('種牡馬匯入（STL）：儲存層寫入', () => {
  it('STL-17 建立新系時手動建立零代市場種牡馬、未填能力番号 → 可正常開啟分支', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await openLine(db, GAME, {
      line: 1,
      subsystem: 'マンノウォー',
      parentSystem: 'マッチェム',
      color: '#1f77b4',
      stallion: { kind: 'new', horse: { fullName: 'ウォーアドミラル' } },
    })
    expect(result.status).toBe('done')
    const [horse] = await db.horses.toArray()
    expect(horse?.abilityNumber).toBeUndefined()
    expect((await loadRuleSnapshot(db, GAME)).eightLines.lines[0]).toMatchObject({
      opened: true,
      stallions: [{ generation: 0, state: 'active' }],
    })
  })

  it('STL-06 第 3 系零代目標種牡馬被史實引退，以同子系統的其他種牡馬替換 → 位置與零代不變，前任紀錄仍連結原種牡馬', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(3, 'マンノウォー'))
    await db.horses.add(horseRow('Z3', { sex: 'male', sireSystem: 'マンノウォー' }))
    await db.stallions.add(stallionRow('Z3', 3, 0))
    const lineThree = async () => (await loadRuleSnapshot(db, GAME)).eightLines.lines[2]!

    expect((await setStallionStatus(db, GAME, 'Z3', 'retired')).status).toBe('done')
    expect((await lineThree()).stallions).toEqual([{ generation: 0, state: 'ended' }])

    const result = await assignZeroStallion(db, GAME, {
      slot: { kind: 'founding', line: 3 },
      stallion: { kind: 'new', horse: { fullName: 'ウォーレリック', sireSystem: 'マンノウォー' } },
      reason: { kind: 'historical-retirement' },
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.appointment).toMatchObject({ line: 3, generation: 0, status: 'active' })
    expect((await lineThree()).stallions).toEqual([{ generation: 0, state: 'active' }])
    expect(await db.stallions.get('Z3')).toEqual(stallionRow('Z3', 3, 0, { status: 'retired' }))
    const [assigned] = await db.events
      .where('[gameId+horseId]')
      .equals([GAME, result.value.horse.id])
      .toArray()
    expect(assigned).toMatchObject({ kind: 'stallion-assigned', replacedHorseIds: ['Z3'] })
  })

  it('STL-07 替換種牡馬的子系統與該系不同 → 警告並確認，確認後更新目前子系統名稱並保存歷程', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(3, 'マンノウォー'))
    await db.horses.add(horseRow('Z3', { sex: 'male' }))
    await db.stallions.add(stallionRow('Z3', 3, 0, { status: 'retired' }))
    const input = {
      slot: { kind: 'founding' as const, line: 3 as const },
      stallion: {
        kind: 'new' as const,
        horse: { fullName: 'ハイペリオン', sireSystem: 'ハイペリオン' },
      },
      reason: { kind: 'historical-retirement' as const },
    }
    expect((await assignZeroStallion(db, GAME, input)).status).toBe('unconfirmed')
    expect(await db.lines.get([GAME, 3])).toEqual(lineRow(3, 'マンノウォー'))

    expect((await assignZeroStallion(db, GAME, input, { confirmed: true })).status).toBe('done')
    expect(await db.lines.get([GAME, 3])).toEqual(lineRow(3, 'ハイペリオン'))
    const renamed = await db.events
      .where('[gameId+line]')
      .equals([GAME, 3])
      .filter((event) => event.kind === 'line-subsystem-changed')
      .toArray()
    expect(renamed).toEqual([
      expect.objectContaining({ year: 1990, from: 'マンノウォー', to: 'ハイペリオン' }),
    ])
  })

  it('STL-03 自家種牡馬接任 → 從既有馬匹選取，不需匯入；沿用內部識別，可以輸入種牡馬馬番号', async () => {
    const db = await successorHerd()
    const horses = await db.horses.count()
    const result = await appointStallion(db, GAME, { horseId: 'C87', horseNumber: '0x0123' })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.appointment).toMatchObject({ horseId: 'C87', status: 'active' })
    expect(await db.horses.count()).toBe(horses)
    expect(await db.horseNumbers.toArray()).toEqual([
      expect.objectContaining({ horseId: 'C87', stage: 'stallion', number: '0x0123' }),
    ])
  })
})

// 解析負責的部分（CE 匯入子計畫 4-1）；實檔的筆數在 tests/local/ce-samples.test.ts

describe('種牡馬匯入（STL）：解析', () => {
  it('STL-04 目標種牡馬 TXT 含 0 匹或 2 匹以上 → 停止，不寫入', () => {
    const none = exportText('stallion', [])
    const two = exportText('stallion', [SAMPLES.stallion, { ...SAMPLES.stallion, 59: '0x0011' }])
    expect(parseImportFile(none, 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'row-count', value: '0' }],
    })
    expect(parseImportFile(two, 'target-stallion', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'row-count', value: '2' }],
    })
  })

  it('STL-08 匯入 1968年5月1週_種牡馬.txt → 檔名解析為 1968 年 5 月 1 週；63 欄，出生年為 1968 減 年，牧場不套用範圍檢查，種付料的逗號不影響分隔', () => {
    const text = exportText('stallion', [
      SAMPLES.stallion,
      { ...SAMPLES.stallion, 3: '12', 37: '12,000', 53: '2', 59: '0x0011' },
    ])
    const read = readImportFile(cp932(text), '1968年5月1週_種牡馬.txt')
    if (read.status !== 'ok') throw new Error('應該讀得出來')
    expect(read.nameInfo).toStrictEqual({
      year: 1968,
      timing: { month: 5, week: 1 },
      type: 'stallion-list',
    })
    expect(parseImportFile(read.text, 'stallion-list', 1968)).toMatchObject({
      status: 'ok',
      entries: [
        { birthYear: 1962, farm: 240, studFee: '1,500', abilityNumber: '0x0010' },
        { birthYear: 1956, farm: 2, studFee: '12,000', abilityNumber: '0x0011' },
      ],
    })
  })
})
