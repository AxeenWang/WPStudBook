import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow } from '../../tests/support/rows'
import { lineSystemsOf } from '../../tests/support/systems'
import type { WPStudBookDatabase } from './database'
import type { WriteWarning } from './records'
import {
  confirmation,
  gate,
  parentDuplicateWarnings,
  prepareNewHorse,
  runWrite,
  type NewHorseInput,
} from './writes'

const NOW = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

const warning: WriteWarning = {
  kind: 'parent-system-duplicate',
  line: 2,
  parentSystem: 'マッチェム',
  lines: [1],
}

/** 測試用：寫一筆事件的操作 */
function writeEvent(db: WPStudBookDatabase, gameId = GAME) {
  return runWrite(db, gameId, [], { now: NOW }, async (context) => {
    await context.addEvent({ kind: 'line-subsystem-changed', line: 1, from: 'A', to: 'B' })
    return context.done('寫好了')
  })
}

/** 測試用：在寫入交易內驗證手動輸入的馬 */
async function prepare(db: WPStudBookDatabase, input: NewHorseInput) {
  const result = await runWrite(db, GAME, [db.horses], {}, async (context) => ({
    status: 'done' as const,
    value: await prepareNewHorse(context, input, 'male'),
    warnings: [],
  }))
  if (result.status !== 'done') throw new Error('不會發生')
  return result.value
}

describe('runWrite', () => {
  it('在交易內寫入：事件帶遊戲局、目前遊戲年與寫入時間，遊戲局的更新時間設為寫入時間', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(await writeEvent(db)).toEqual({ status: 'done', value: '寫好了', warnings: [] })
    const events = await db.events.toArray()
    expect(events).toEqual([
      {
        id: events[0]!.id,
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        kind: 'line-subsystem-changed',
        line: 1,
        from: 'A',
        to: 'B',
      },
    ])
    expect((await db.games.get(GAME))?.updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('沒有呼叫 done 時（阻止或待確認）不更新遊戲局的更新時間', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await runWrite(db, GAME, [], { now: NOW }, async () => ({
      status: 'blocked' as const,
      blocks: ['原因'],
    }))
    expect(result).toEqual({ status: 'blocked', blocks: ['原因'] })
    expect((await db.games.get(GAME))?.updatedAt).toBe(CREATED_AT)
  })

  it('找不到遊戲局時丟出錯誤', async () => {
    const db = testDatabase()
    await expect(writeEvent(db, 'X')).rejects.toThrow('找不到遊戲局：X')
  })

  it('可以包進外層交易：外層失敗時，裡面每個操作寫入的都一起回復（技術設計 4.4）', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await expect(
      db.transaction('rw', db.tables, async () => {
        await writeEvent(db)
        await writeEvent(db)
        expect(await db.events.count()).toBe(2)
        throw new Error('外層失敗')
      }),
    ).rejects.toThrow('外層失敗')
    expect(await db.events.count()).toBe(0)
    expect((await db.games.get(GAME))?.updatedAt).toBe(CREATED_AT)
  })
})

describe('gate', () => {
  it('有阻止時回傳 blocked，不看警告', () => {
    expect(gate(['原因'], [warning], true)).toEqual({ status: 'blocked', blocks: ['原因'] })
  })

  it('有警告而還沒確認時回傳 unconfirmed；確認後可以寫入', () => {
    expect(gate([], [warning], false)).toEqual({ status: 'unconfirmed', warnings: [warning] })
    expect(gate([], [warning], true)).toBeNull()
  })

  it('沒有阻止也沒有警告時可以寫入', () => {
    expect(gate([], [], false)).toBeNull()
  })
})

describe('confirmation', () => {
  it('有確認過的警告時才加上 confirmedWarnings', () => {
    expect(confirmation([])).toEqual({})
    expect(confirmation([warning])).toEqual({ confirmedWarnings: [warning] })
  })
})

describe('prepareNewHorse', () => {
  it('組出手動建立的馬：基本馬名去掉前綴、能力番号統一寫法、父系去掉「系」，馬名來源為手動輸入；不寫入', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(
      await prepare(db, {
        fullName: ' (外)マルゼンスキー ',
        abilityNumber: '0x30f',
        birthYear: 1974,
        sireSystem: 'ニジンスキー系',
      }),
    ).toEqual({
      ok: true,
      value: {
        id: expect.any(String),
        gameId: GAME,
        fullName: '(外)マルゼンスキー',
        baseName: 'マルゼンスキー',
        nameSource: 'manual',
        abilityNumber: '0x030F',
        birthYear: 1974,
        sex: 'male',
        sireSystem: 'ニジンスキー',
      },
    })
    expect(await db.horses.count()).toBe(0)
  })

  it('選填欄位沒有填或只有空白時，不寫那些欄位', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(
      await prepare(db, { fullName: 'シンザン', abilityNumber: '  ', sireSystem: ' ' }),
    ).toEqual({
      ok: true,
      value: {
        id: expect.any(String),
        gameId: GAME,
        fullName: 'シンザン',
        baseName: 'シンザン',
        nameSource: 'manual',
        sex: 'male',
      },
    })
  })

  it('馬名空白或只有前綴、能力番号格式不符、出生年不是整數或晚於目前遊戲年時阻止', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(await prepare(db, { fullName: '(外)' })).toEqual({
      ok: false,
      blocks: [{ kind: 'horse-name' }],
    })
    expect(await prepare(db, { fullName: '  ', abilityNumber: '030F', birthYear: 1991 })).toEqual({
      ok: false,
      blocks: [{ kind: 'horse-name' }, { kind: 'ability-number' }, { kind: 'birth-year' }],
    })
    expect(await prepare(db, { fullName: 'シンザン', birthYear: 1961.5 })).toEqual({
      ok: false,
      blocks: [{ kind: 'birth-year' }],
    })
    expect((await prepare(db, { fullName: 'シンザン', birthYear: 1990 })).ok).toBe(true)
  })

  it('能力番号與出生年都和這一局既有的馬相同時阻止並指出那匹馬（需求規格 6.2）；別局的馬不算', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horses.add(horseRow('H1', { abilityNumber: '0x030F', birthYear: 1974 }))
    await db.horses.add(horseRow('H2', { gameId: 'G2', abilityNumber: '0x0100', birthYear: 1974 }))
    const sameHorse = { fullName: '別の馬', abilityNumber: '0x30f', birthYear: 1974 }
    expect(await prepare(db, sameHorse)).toEqual({
      ok: false,
      blocks: [{ kind: 'same-horse', horseId: 'H1' }],
    })
    const otherYear = { fullName: '別の馬', abilityNumber: '0x030F', birthYear: 1975 }
    expect((await prepare(db, otherYear)).ok).toBe(true)
    const otherGame = { fullName: '別の馬', abilityNumber: '0x0100', birthYear: 1974 }
    expect((await prepare(db, otherGame)).ok).toBe(true)
  })
})

describe('parentDuplicateWarnings', () => {
  const before = lineSystemsOf({
    1: ['ネアルコ', 'ファラリス'],
    2: ['フェアウェイ', 'ファラリス'],
    3: ['マンノウォー', 'マッチェム'],
  })

  it('親系統改變的系與其他系重複時列出；原本就重複、這次沒有變的系不列', () => {
    const after = lineSystemsOf({
      1: ['ネアルコ', 'ファラリス'],
      2: ['フェアウェイ', 'ファラリス'],
      3: ['マンノウォー', 'ファラリス'],
    })
    expect(parentDuplicateWarnings(before, after)).toEqual([
      { kind: 'parent-system-duplicate', line: 3, parentSystem: 'ファラリス', lines: [1, 2] },
    ])
  })

  it('這次才開啟的系也要檢查', () => {
    const after = lineSystemsOf({
      1: ['ネアルコ', 'ファラリス'],
      2: ['フェアウェイ', 'ファラリス'],
      3: ['マンノウォー', 'マッチェム'],
      4: ['ハイペリオン', 'マッチェム'],
    })
    expect(parentDuplicateWarnings(before, after)).toEqual([
      { kind: 'parent-system-duplicate', line: 4, parentSystem: 'マッチェム', lines: [3] },
    ])
  })

  it('親系統變成查不到時不警告', () => {
    const after = before.map((entry) =>
      entry.line === 3 ? { ...entry, subsystem: '未登録', parentSystem: null } : entry,
    )
    expect(parentDuplicateWarnings(before, after)).toEqual([])
  })
})
