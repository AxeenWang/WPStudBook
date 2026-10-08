import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  stallionRow,
  startMareRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { correctHorse, fillHorseIdentity } from './horse-writes'
import type { HorseRow } from './records'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 手動新增、尚未經匯入確認的市場母馬 M（待指定用途） */
const manualMare: HorseRow = horseRow('M', {
  fullName: 'ハナカゴ',
  baseName: 'ハナカゴ',
  nameSource: 'manual',
  abilityNumber: '0x0100',
  birthYear: 1980,
  sex: 'female',
  sireName: '手動の父',
  pedigreeSource: 'manual',
})

async function withManualMare(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.horses.add(manualMare)
  await db.mares.add(ungroupedMareRow('M', 'unassigned'))
  return db
}

describe('correctHorse', () => {
  it('只改填了的欄位，基本馬名跟著完整馬名重算；事件只記有改的欄位', async () => {
    const db = await withManualMare()
    const result = await correctHorse(
      db,
      GAME,
      'M',
      { fullName: '(外)ハナカゴ', birthYear: 1981 },
      { now },
    )
    const horse = { ...manualMare, fullName: '(外)ハナカゴ', birthYear: 1981 }
    expect(result).toEqual({
      status: 'done',
      value: { horse, parentSystemUnknown: false },
      warnings: [],
    })
    expect(await db.horses.get('M')).toEqual(horse)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'horse-corrected',
        horseId: 'M',
        from: { fullName: 'ハナカゴ', birthYear: 1980 },
        to: { fullName: '(外)ハナカゴ', birthYear: 1981 },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('null 清除選填欄位，事件記 null；父母名與父系都沒有值時不再記來源', async () => {
    const db = await withManualMare()
    const result = await correctHorse(db, GAME, 'M', { abilityNumber: null, sireName: null })
    expect(result.status === 'done' && result.value.horse).toEqual({
      id: 'M',
      gameId: GAME,
      fullName: 'ハナカゴ',
      baseName: 'ハナカゴ',
      nameSource: 'manual',
      birthYear: 1980,
      sex: 'female',
    })
    expect((await db.events.toArray())[0]).toMatchObject({
      from: { abilityNumber: '0x0100', sireName: '手動の父' },
      to: { abilityNumber: null, sireName: null },
    })
  })

  it('父母名與父系：去掉前綴存基本馬名、父系去掉「系」，來源記為手動；其他欄位不變', async () => {
    const db = await withManualMare()
    await db.horses.update('M', { sireName: undefined, pedigreeSource: undefined, damId: 'D' })
    const result = await correctHorse(db, GAME, 'M', {
      damName: ' (外)手動の母 ',
      sireSystem: 'ハイペリオン系',
    })
    expect(result.status === 'done' && result.value.horse).toMatchObject({
      damName: '手動の母',
      sireSystem: 'ハイペリオン',
      pedigreeSource: 'manual',
      damId: 'D',
      sex: 'female',
      abilityNumber: '0x0100',
    })
  })

  it('檢查同手動建立的馬，原因一起列出；同一匹馬的比對排除自己；什麼都沒改時阻止', async () => {
    const db = await withManualMare()
    await db.horses.add(horseRow('O', { abilityNumber: '0x0200', birthYear: 1975 }))
    expect(
      await correctHorse(db, GAME, 'M', {
        fullName: '(外)',
        abilityNumber: 'xyz',
        birthYear: 1991,
        sireName: '[地]',
      }),
    ).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'horse-name' },
        { kind: 'ability-number' },
        { kind: 'birth-year' },
        { kind: 'parent-name', parent: 'sire' },
      ],
    })
    expect(await correctHorse(db, GAME, 'M', { abilityNumber: '0x200', birthYear: 1975 })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'same-horse', horseId: 'O' }],
    })
    expect(
      await correctHorse(db, GAME, 'M', { abilityNumber: '0x100', fullName: 'ハナカゴ' }),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'unchanged' }] })
    expect(await correctHorse(db, GAME, 'M', {})).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await db.horses.get('M')).toEqual(manualMare)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('替代母馬改了自身父系時重做 8.3：撞到要確認，未知時帶提示；只改馬名時不重做', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.systems.add({ gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' })
    await db.horses.add(
      horseRow('S', {
        fullName: '替代の母',
        baseName: '替代の母',
        nameSource: 'manual',
        sireSystem: 'マンノウォー',
        pedigreeSource: 'manual',
      }),
    )
    await db.mares.add(substituteMareRow('S', 2, 1, { herd: 'sold' }))
    expect((await correctHorse(db, GAME, 'S', { fullName: '替代の母二' })).status).toBe('done')

    await correctHorse(db, GAME, 'S', { sireSystem: 'ハイペリオン' })
    const warning = {
      kind: 'substitute-parent-system',
      line: 2,
      generation: 1,
      conflicts: [{ kind: 'line', parentSystem: 'マッチェム', lines: [1] }],
    }
    expect(await correctHorse(db, GAME, 'S', { sireSystem: 'マンノウォー' })).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    const confirmed = await correctHorse(
      db,
      GAME,
      'S',
      { sireSystem: 'マンノウォー' },
      { confirmed: true },
    )
    expect(confirmed.status === 'done' && confirmed.warnings).toEqual([warning])
    expect(await db.events.toArray()).toContainEqual(
      expect.objectContaining({ kind: 'horse-corrected', confirmedWarnings: [warning] }),
    )
    const unknown = await correctHorse(db, GAME, 'S', { sireSystem: null })
    expect(unknown.status === 'done' && unknown.value.parentSystemUnknown).toBe(true)

    await db.horses.add(
      horseRow('T', { fullName: '起點の母', baseName: '起點の母', nameSource: 'manual' }),
    )
    await db.mares.add(startMareRow('T'))
    const start = await correctHorse(db, GAME, 'T', { sireSystem: 'マンノウォー' })
    expect(start.status === 'done' && start.warnings).toEqual([])
  })

  it('零代市場種牡馬改了父系時不重做 7.7 的比對', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.horses.add(
      horseRow('Z1', { fullName: '零代', baseName: '零代', nameSource: 'manual', sex: 'male' }),
    )
    await db.stallions.add(stallionRow('Z1', 1, 0))
    const result = await correctHorse(db, GAME, 'Z1', { sireSystem: 'ハイペリオン' })
    expect(result.status === 'done' && result.warnings).toEqual([])
    expect(await db.lines.get([GAME, 1])).toEqual(lineRow(1, 'マンノウォー'))
  })

  it('馬匹找不到、屬於其他局、有出生紀錄或經匯入確認時丟出錯誤', async () => {
    const db = await withManualMare()
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('X', { gameId: 'G2', fullName: 'X', baseName: 'X', nameSource: 'manual' }),
      horseRow('F', { fullName: 'F', baseName: 'F', nameSource: 'manual', birth: {} }),
      horseRow('I', { fullName: 'I', baseName: 'I', nameSource: 'import' }),
    ])
    await db.mares.add(ownMareRow('F', 1, 2))
    await expect(correctHorse(db, GAME, 'Q', {})).rejects.toThrow('找不到馬匹：Q')
    await expect(correctHorse(db, GAME, 'X', {})).rejects.toThrow('找不到馬匹：X')
    await expect(correctHorse(db, GAME, 'F', { fullName: 'G' })).rejects.toThrow(
      '只有手動輸入、尚未經匯入確認的市場馬可以更正：F',
    )
    await expect(correctHorse(db, GAME, 'I', { fullName: 'J' })).rejects.toThrow(
      '只有手動輸入、尚未經匯入確認的市場馬可以更正：I',
    )
  })
})

describe('fillHorseIdentity', () => {
  const source = { kind: 'import', importType: 'may-herd', importId: 'I1' } as const

  it('只補空白的能力番号與出生年，其他欄位不變；事件只記補上的值', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const blank = horseRow('B', {
      fullName: 'ブランク',
      baseName: 'ブランク',
      nameSource: 'manual',
    })
    const known = horseRow('K', { birthYear: 1984, sireName: '手動の父', pedigreeSource: 'manual' })
    await db.horses.bulkAdd([blank, known])
    const identity = { abilityNumber: '0x0B00', birthYear: 1984 }
    const result = await fillHorseIdentity(db, GAME, 'B', identity, { now, source })
    const filled = { ...blank, abilityNumber: '0x0B00', birthYear: 1984 }
    expect(result).toStrictEqual({ status: 'done', value: filled, warnings: [] })
    expect(await db.horses.get('B')).toStrictEqual(filled)
    expect(await db.events.toArray()).toStrictEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source,
        kind: 'horse-identity-filled',
        horseId: 'B',
        abilityNumber: '0x0B00',
        birthYear: 1984,
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')

    await fillHorseIdentity(db, GAME, 'K', { abilityNumber: '0x0C00', birthYear: 1984 }, { source })
    expect(await db.horses.get('K')).toStrictEqual({ ...known, abilityNumber: '0x0C00' })
    const [event] = await db.events.where('[gameId+horseId]').equals([GAME, 'K']).toArray()
    expect(event).toMatchObject({ kind: 'horse-identity-filled', abilityNumber: '0x0C00' })
    expect(event).not.toHaveProperty('birthYear')
  })

  it('另一匹馬已有相同的能力番号與出生年時阻止並附那一匹；兩者都已有相同的值時阻止；什麼都不寫', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([
      horseRow('B', { birthYear: 1984 }),
      horseRow('S', { abilityNumber: '0x0B00', birthYear: 1984 }),
      horseRow('F', { abilityNumber: '0x0F00', birthYear: 1985 }),
    ])
    expect(
      await fillHorseIdentity(db, GAME, 'B', { abilityNumber: '0x0B00', birthYear: 1984 }),
    ).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'same-horse', horseId: 'S' }],
    })
    expect(
      await fillHorseIdentity(db, GAME, 'F', { abilityNumber: '0x0F00', birthYear: 1985 }),
    ).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await db.horses.get('B')).toStrictEqual(horseRow('B', { birthYear: 1984 }))
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('馬匹找不到、屬於其他局，或已有不同的能力番号或出生年時丟出錯誤；能力番号沒有統一寫法或出生年不是整數時丟出 RangeError', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('X', { gameId: 'G2' }),
      horseRow('A', { abilityNumber: '0x0A00' }),
      horseRow('Y', { birthYear: 1980 }),
    ])
    const identity = { abilityNumber: '0x0B00', birthYear: 1984 }
    await expect(fillHorseIdentity(db, GAME, 'Q', identity)).rejects.toThrow('找不到馬匹：Q')
    await expect(fillHorseIdentity(db, GAME, 'X', identity)).rejects.toThrow('找不到馬匹：X')
    await expect(fillHorseIdentity(db, GAME, 'A', identity)).rejects.toThrow(
      '能力番号與名單不同：A',
    )
    await expect(fillHorseIdentity(db, GAME, 'Y', identity)).rejects.toThrow('出生年與名單不同：Y')
    await expect(
      fillHorseIdentity(db, GAME, 'A', { abilityNumber: '0x0a00', birthYear: 1984 }),
    ).rejects.toThrow(RangeError)
    await expect(
      fillHorseIdentity(db, GAME, 'A', { abilityNumber: '0x0A00', birthYear: 1984.5 }),
    ).rejects.toThrow('出生年不是整數：1984.5')
    expect(await db.events.count()).toBe(0)
  })
})
