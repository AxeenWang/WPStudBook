import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow, ungroupedMareRow } from '../../tests/support/rows'
import { lineSystemsOf } from '../../tests/support/systems'
import type { DesignatedOrigin, SuccessorCandidate } from '../core/successor'
import type { WPStudBookDatabase } from './database'
import type { GameTiming, WriteWarning } from './records'
import {
  checkOwnSuccessor,
  confirmation,
  gate,
  loadFoal,
  loadMare,
  loadMareInHerd,
  parentDuplicateWarnings,
  prepareNewHorse,
  runWrite,
  type NewHorseInput,
  type WriteOptions,
} from './writes'
import { APP_VERSION } from './version'

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
        source: { kind: 'manual' },
        kind: 'line-subsystem-changed',
        line: 1,
        from: 'A',
        to: 'B',
      },
    ])
    expect((await db.games.get(GAME))?.updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('done 同時把遊戲局的應用版本設為目前版本（需求規格 12.1）', async () => {
    const db = testDatabase()
    await addTestGame(db, { appVersion: '0.0.0-old' })
    await writeEvent(db)
    expect((await db.games.get(GAME))?.appVersion).toBe(APP_VERSION)
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
        pedigreeSource: 'manual',
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
  it('馬名不符時也照查同一匹馬，阻止原因一次列全', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.add(horseRow('H1', { abilityNumber: '0x030F', birthYear: 1974 }))
    expect(
      await prepare(db, { fullName: '[地]', abilityNumber: '0x030F', birthYear: 1974 }),
    ).toEqual({
      ok: false,
      blocks: [{ kind: 'horse-name' }, { kind: 'same-horse', horseId: 'H1' }],
    })
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

describe('runWrite 的來源與時點（技術設計 4.3）', () => {
  /** 以 timing 寫一筆轉場事件 */
  function writeWithTiming(db: WPStudBookDatabase, timing: GameTiming) {
    return runWrite(db, GAME, [], { now: NOW, timing }, async (context) => {
      await context.addEvent({ kind: 'mare-moved', horseId: 'M1', to: 33 })
      return context.done(null)
    })
  }

  it('事件的來源預設為手動、沒有時點；WriteOptions 帶了來源與時點時照記', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await writeEvent(db)
    const source = { kind: 'import' as const, importType: 'may-herd' as const }
    await runWrite(
      db,
      GAME,
      [],
      { now: NOW, source, timing: { month: 5, week: 1 } },
      async (context) => {
        await context.addEvent({ kind: 'mare-moved', horseId: 'M1', to: 33 })
        return context.done(null)
      },
    )
    const events = await db.events.toArray()
    const manual = events.find((event) => event.kind === 'line-subsystem-changed')
    expect(manual?.source).toEqual({ kind: 'manual' })
    expect(manual).not.toHaveProperty('timing')
    expect(events.find((event) => event.kind === 'mare-moved')).toMatchObject({
      source,
      timing: { month: 5, week: 1 },
    })
  })

  it('寫入操作可以從上下文取得這次的來源與時點；沒有時點時不帶這個欄位', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const source = { kind: 'import' as const, importType: 'july-conception' as const }
    const read = (options: WriteOptions) =>
      runWrite(db, GAME, [], options, async (context) =>
        context.done({
          source: context.source,
          timing: context.timing,
          keys: Object.keys(context),
        }),
      )
    const imported = await read({ source, timing: { month: 7, week: 1 } })
    expect(imported.status === 'done' && imported.value).toMatchObject({
      source,
      timing: { month: 7, week: 1 },
    })
    const manual = await read({})
    if (manual.status !== 'done') throw new Error(manual.status)
    expect(manual.value.source).toEqual({ kind: 'manual' })
    expect(manual.value.keys).not.toContain('timing')
  })

  it('時點不是 1～12 月、1～4 週時丟出錯誤，什麼都不寫', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await expect(writeWithTiming(db, { month: 13, week: 1 })).rejects.toThrow(
      '遊戲內的時點不符：13 月 1 週',
    )
    await expect(writeWithTiming(db, { month: 5, week: 5 })).rejects.toThrow(
      '遊戲內的時點不符：5 月 5 週',
    )
    await expect(writeWithTiming(db, { month: 0, week: 1 })).rejects.toThrow('遊戲內的時點不符')
    await expect(writeWithTiming(db, { month: 1, week: 0 })).rejects.toThrow('遊戲內的時點不符')
    await expect(writeWithTiming(db, { month: 5.5, week: 1 })).rejects.toThrow('遊戲內的時點不符')
    expect(await db.events.count()).toBe(0)
    expect((await writeWithTiming(db, { month: 12, week: 4 })).status).toBe('done')
    expect((await writeWithTiming(db, { month: 1, week: 1 })).status).toBe('done')
  })
})

describe('prepareNewHorse 的父母名（需求規格 6.4）', () => {
  it('父母名去掉前綴、存基本馬名；父母名或父系有填時，它們的來源記為手動', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(
      await prepare(db, { fullName: 'ハクチカラ', sireName: ' (外)トビサクラ ', damName: '昇城' }),
    ).toEqual({
      ok: true,
      value: {
        id: expect.any(String),
        gameId: GAME,
        fullName: 'ハクチカラ',
        baseName: 'ハクチカラ',
        nameSource: 'manual',
        sex: 'male',
        sireName: 'トビサクラ',
        damName: '昇城',
        pedigreeSource: 'manual',
      },
    })
    const damOnly = await prepare(db, { fullName: 'ハクチカラ', damName: '昇城' })
    expect(damOnly.ok && damOnly.value.pedigreeSource).toBe('manual')
    const plain = await prepare(db, { fullName: 'ハクチカラ', sireName: '  ' })
    if (!plain.ok) throw new Error('應該可以建立')
    expect(plain.value).not.toHaveProperty('sireName')
    expect(plain.value).not.toHaveProperty('pedigreeSource')
  })

  it('父母名只有前綴、沒有馬名時阻止', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(
      await prepare(db, { fullName: 'ハクチカラ', sireName: '(外)', damName: '[地]' }),
    ).toEqual({
      ok: false,
      blocks: [
        { kind: 'parent-name', parent: 'sire' },
        { kind: 'parent-name', parent: 'dam' },
      ],
    })
  })
})

describe('loadMare', () => {
  it('在寫入交易內讀取這一局的母馬；找不到或屬於其他局時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.mares.bulkAdd([
      ungroupedMareRow('M', 'unassigned'),
      ungroupedMareRow('M2', 'unassigned', { gameId: 'G2' }),
    ])
    const read = (horseId: string) =>
      runWrite(db, GAME, [db.mares], {}, async (context) =>
        context.done(await loadMare(context, horseId)),
      )
    const found = await read('M')
    expect(found.status === 'done' && found.value.horseId).toBe('M')
    await expect(read('M2')).rejects.toThrow('找不到母馬：M2')
    await expect(read('X')).rejects.toThrow('找不到母馬：X')
  })
})

describe('loadMareInHerd', () => {
  it('在寫入交易內讀取這一局在圈的母馬；不在圈內時丟出錯誤，訊息接上呼叫端的原因', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.mares.bulkAdd([
      ungroupedMareRow('M', 'unassigned'),
      ungroupedMareRow('S', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('R', 'unassigned', { herd: 'retired' }),
    ])
    const read = (horseId: string) =>
      runWrite(db, GAME, [db.mares], {}, async (context) =>
        context.done(await loadMareInHerd(context, horseId, '不能賣出')),
      )
    const found = await read('M')
    expect(found.status === 'done' && found.value.horseId).toBe('M')
    await expect(read('S')).rejects.toThrow('不在繁殖圈內的母馬不能賣出：S')
    await expect(read('R')).rejects.toThrow('不在繁殖圈內的母馬不能賣出：R')
    await expect(read('X')).rejects.toThrow('找不到母馬：X')
  })
})

describe('loadFoal', () => {
  it('在寫入交易內讀取這一局的自家產駒；找不到、屬於其他局或沒有出生紀錄時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('F', { birth: {} }),
      horseRow('M'),
      horseRow('F2', { gameId: 'G2', birth: {} }),
    ])
    const read = (horseId: string) =>
      runWrite(db, GAME, [db.horses], {}, async (context) =>
        context.done(await loadFoal(context, horseId)),
      )
    const found = await read('F')
    expect(found.status === 'done' && found.value.id).toBe('F')
    await expect(read('M')).rejects.toThrow('不是自家產駒：M')
    await expect(read('F2')).rejects.toThrow('找不到馬匹：F2')
    await expect(read('X')).rejects.toThrow('找不到馬匹：X')
  })
})

describe('checkOwnSuccessor', () => {
  /** 第 1 系 4 代 S14 × 第 2 系 4 代自家母駒 D24 所生的第 1 系 5 代 */
  const origin: DesignatedOrigin = {
    kind: 'designated',
    breedingSireId: 'S14',
    breedingDamId: 'D24',
    sire: { line: 1, generation: 4 },
    dam: { kind: 'own', line: 2, generation: 4 },
    recorded: { line: 1, generation: 5 },
  }
  const candidate: SuccessorCandidate = { sireId: 'S14', damId: 'D24', origin }

  it('八系指定配種所生：核對通過時回傳出生紀錄的系與代數；目標省略時就是出生紀錄', () => {
    const passed = { ok: true, value: { line: 1, generation: 5 } }
    expect(checkOwnSuccessor(candidate)).toEqual(passed)
    expect(checkOwnSuccessor(candidate, { line: 1, generation: 5 })).toEqual(passed)
  })

  it('目標與出生紀錄不同、父母不符時阻止，並列出 core 的核對結果', () => {
    expect(checkOwnSuccessor(candidate, { line: 1, generation: 6 })).toEqual({
      ok: false,
      blocks: [
        {
          kind: 'successor',
          mismatches: [{ mismatch: 'target', expected: { line: 1, generation: 5 } }],
        },
      ],
    })
    expect(checkOwnSuccessor({ ...candidate, damId: 'X' })).toEqual({
      ok: false,
      blocks: [{ kind: 'successor', mismatches: [{ mismatch: 'parents' }] }],
    })
  })

  it('自由配種所生或比照自由配種一律阻止（9.5）', () => {
    const free: SuccessorCandidate = { sireId: 'S14', damId: 'D24', origin: { kind: 'free' } }
    const blocked = {
      ok: false,
      blocks: [{ kind: 'successor', mismatches: [{ mismatch: 'free-breeding' }] }],
    }
    expect(checkOwnSuccessor(free)).toEqual(blocked)
    expect(checkOwnSuccessor(free, { line: 1, generation: 5 })).toEqual(blocked)
  })
})
