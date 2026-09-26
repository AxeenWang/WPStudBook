import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow, lineRow, stallionRow } from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { changeLineColor, changeLineSubsystem, openLine, type OpenLineInput } from './line-writes'
import type { EventRow } from './records'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 開啟第 1 系（建系起點）的輸入：零代市場種牡馬新建 */
const startInput: OpenLineInput = {
  line: 1,
  subsystem: 'マンノウォー系',
  parentSystem: 'マッチェム',
  color: '#1f77b4',
  stallion: {
    kind: 'new',
    horse: { fullName: 'ウォーアドミラル', birthYear: 1934, sireSystem: 'マンノウォー' },
  },
}

/** 開啟第 2 系的輸入：親系統與第 1 系不同 */
const lineTwoInput: OpenLineInput = {
  ...startInput,
  line: 2,
  subsystem: 'ハイペリオン',
  parentSystem: 'ファラリス',
}

/** 事件依種類排序：同一次操作寫的事件識別是亂數，順序不固定 */
async function eventKinds(db: WPStudBookDatabase): Promise<EventRow['kind'][]> {
  return (await db.events.toArray()).map((event) => event.kind).sort()
}

/** 第 1 系已開啟、已有 1 代的種牡馬紀錄：可以開啟第 2 系 */
async function lineOneReachedGenerationOne(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.add(lineRow(1, 'マンノウォー'))
  await db.systems.add({ gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' })
  await db.horses.add(horseRow('Z1', { sex: 'male' }))
  await db.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('S11', 1, 1)])
  return db
}

describe('openLine', () => {
  it('開啟建立起點的第 1 系：寫入系、對照表、零代市場種牡馬與在崗任用，以及事件', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await openLine(db, GAME, startInput, { now })
    if (result.status !== 'done') throw new Error(result.status)
    const { line, appointment, horse } = result.value
    expect(line).toEqual({
      gameId: GAME,
      line: 1,
      subsystem: 'マンノウォー',
      color: '#1f77b4',
      openedYear: 1990,
    })
    expect(horse).toEqual({
      id: horse.id,
      gameId: GAME,
      fullName: 'ウォーアドミラル',
      baseName: 'ウォーアドミラル',
      nameSource: 'manual',
      birthYear: 1934,
      sex: 'male',
      sireSystem: 'マンノウォー',
      pedigreeSource: 'manual',
    })
    expect(appointment).toEqual({
      id: appointment.id,
      gameId: GAME,
      line: 1,
      generation: 0,
      horseId: horse.id,
      status: 'active',
    })
    expect(await db.lines.toArray()).toEqual([line])
    expect(await db.horses.toArray()).toEqual([horse])
    expect(await db.stallions.toArray()).toEqual([appointment])
    expect(await db.systems.toArray()).toEqual([
      { gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
    ])
    expect(await eventKinds(db)).toEqual(['line-opened', 'system-added'])
    expect(await db.events.where('[gameId+line]').equals([GAME, 1]).toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'line-opened',
        line: 1,
        horseId: horse.id,
        stallionId: appointment.id,
        subsystem: 'マンノウォー',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('子系統已登錄：親系統相同時不動對照表；不同時改為填入的親系統並寫對照表事件', async () => {
    const same = testDatabase()
    await addTestGame(same)
    await same.systems.add({ gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' })
    expect((await openLine(same, GAME, startInput)).status).toBe('done')
    expect(await eventKinds(same)).toEqual(['line-opened'])

    const changed = testDatabase()
    await addTestGame(changed)
    await changed.systems.add({
      gameId: GAME,
      subsystem: 'マンノウォー',
      parentSystem: 'エクリプス',
      origin: 'フェアプレイ',
    })
    expect((await openLine(changed, GAME, startInput)).status).toBe('done')
    expect(await changed.systems.toArray()).toEqual([
      {
        gameId: GAME,
        subsystem: 'マンノウォー',
        parentSystem: 'マッチェム',
        origin: 'フェアプレイ',
      },
    ])
    expect(await eventKinds(changed)).toEqual(['line-opened', 'system-changed'])
  })

  it('原系到達分支前一代後才能開啟新系；已開啟的系不能再開（技術設計 4.2「可開啟的分支」）', async () => {
    const db = await lineOneReachedGenerationOne()
    expect(await openLine(db, GAME, { ...lineTwoInput, line: 3 })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'not-openable' }],
    })
    expect(await openLine(db, GAME, { ...lineTwoInput, line: 1 })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'not-openable' }],
    })
    expect((await openLine(db, GAME, lineTwoInput)).status).toBe('done')
  })

  it('名稱空白、代表色格式不符、種牡馬的輸入不符時阻止，列出每一項，什麼都不寫', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await openLine(db, GAME, {
      ...startInput,
      subsystem: '系',
      parentSystem: ' ',
      color: 'blue',
      stallion: { kind: 'new', horse: { fullName: '[地]' } },
    })
    expect(result).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'blank', field: 'subsystem' },
        { kind: 'blank', field: 'parentSystem' },
        { kind: 'color' },
        { kind: 'horse-name' },
      ],
    })
    for (const table of [db.lines, db.systems, db.horses, db.stallions, db.events]) {
      expect(await table.count()).toBe(0)
    }
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('零代市場種牡馬可以選既有的市場馬；自家產駒或牝馬阻止；找不到時丟出錯誤', async () => {
    const db = await lineOneReachedGenerationOne()
    await db.horses.bulkAdd([
      horseRow('M', { sex: 'male' }),
      horseRow('F', { sex: 'female' }),
      horseRow('O', { sex: 'male', birth: { placement: { line: 1, generation: 1 } } }),
    ])
    for (const horseId of ['F', 'O']) {
      const input = { ...lineTwoInput, stallion: { kind: 'existing' as const, horseId } }
      expect(await openLine(db, GAME, input)).toEqual({
        status: 'blocked',
        blocks: [{ kind: 'not-market-stallion' }],
      })
    }
    await expect(
      openLine(db, GAME, { ...lineTwoInput, stallion: { kind: 'existing', horseId: 'X' } }),
    ).rejects.toThrow('找不到馬匹：X')
    const result = await openLine(db, GAME, {
      ...lineTwoInput,
      stallion: { kind: 'existing', horseId: 'M' },
    })
    expect(result.status === 'done' && result.value.appointment.horseId).toBe('M')
    expect(await db.horses.count()).toBe(4)
  })

  it('親系統與其他系重複時，要確認才開啟，確認紀錄存在開啟事件（需求規格 7.2、LINE-03）', async () => {
    const db = await lineOneReachedGenerationOne()
    const input = { ...lineTwoInput, subsystem: 'フェアプレイ', parentSystem: 'マッチェム' }
    const warning = {
      kind: 'parent-system-duplicate',
      line: 2,
      parentSystem: 'マッチェム',
      lines: [1],
    }
    expect(await openLine(db, GAME, input)).toEqual({ status: 'unconfirmed', warnings: [warning] })
    expect(await db.lines.count()).toBe(1)
    expect(await db.events.count()).toBe(0)

    const result = await openLine(db, GAME, input, { confirmed: true })
    expect(result.status === 'done' && result.warnings).toEqual([warning])
    const [opened] = await db.events.where('[gameId+line]').equals([GAME, 2]).toArray()
    expect(opened?.confirmedWarnings).toEqual([warning])
  })
})

describe('changeLineSubsystem', () => {
  it('只改名稱：系的子系統改為新名稱，事件記原名稱、新名稱與年份，任用不變（LINE-06）', async () => {
    const db = await lineOneReachedGenerationOne()
    const stallions = await db.stallions.toArray()
    const result = await changeLineSubsystem(
      db,
      GAME,
      1,
      { subsystem: 'ウォーアドミラル系' },
      { now },
    )
    const renamed = lineRow(1, 'ウォーアドミラル')
    expect(result).toEqual({ status: 'done', value: renamed, warnings: [] })
    expect(await db.lines.toArray()).toEqual([renamed])
    expect(await db.stallions.toArray()).toEqual(stallions)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'line-subsystem-changed',
        line: 1,
        from: 'マンノウォー',
        to: 'ウォーアドミラル',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('一併填親系統時照對照表的規則新增一筆', async () => {
    const db = await lineOneReachedGenerationOne()
    const result = await changeLineSubsystem(db, GAME, 1, {
      subsystem: 'ウォーアドミラル',
      parentSystem: 'マッチェム',
    })
    expect(result.status).toBe('done')
    expect(await db.systems.get([GAME, 'ウォーアドミラル'])).toEqual({
      gameId: GAME,
      subsystem: 'ウォーアドミラル',
      parentSystem: 'マッチェム',
    })
    expect(await eventKinds(db)).toEqual(['line-subsystem-changed', 'system-added'])
  })

  it('名稱空白、與目前相同、填了親系統卻是空白時阻止；系還沒開啟時丟出錯誤', async () => {
    const db = await lineOneReachedGenerationOne()
    expect(await changeLineSubsystem(db, GAME, 1, { subsystem: ' ', parentSystem: '系' })).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'blank', field: 'subsystem' },
        { kind: 'blank', field: 'parentSystem' },
      ],
    })
    expect(await changeLineSubsystem(db, GAME, 1, { subsystem: 'マンノウォー系' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    await expect(changeLineSubsystem(db, GAME, 2, { subsystem: 'ネアルコ' })).rejects.toThrow(
      '第 2 系還沒開啟',
    )
    expect(await db.events.count()).toBe(0)
  })

  it('新的親系統與其他系重複時，要確認才寫入，確認紀錄存在名稱變更事件', async () => {
    const db = await lineOneReachedGenerationOne()
    await db.lines.add(lineRow(2, 'ネアルコ'))
    await db.systems.add({ gameId: GAME, subsystem: 'ネアルコ', parentSystem: 'ファラリス' })
    const input = { subsystem: 'フェアウェイ', parentSystem: 'マッチェム' }
    const warning = {
      kind: 'parent-system-duplicate',
      line: 2,
      parentSystem: 'マッチェム',
      lines: [1],
    }
    expect(await changeLineSubsystem(db, GAME, 2, input)).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.lines.get([GAME, 2])).toEqual(lineRow(2, 'ネアルコ'))

    expect((await changeLineSubsystem(db, GAME, 2, input, { confirmed: true })).status).toBe('done')
    const [changed] = await db.events.where('[gameId+line]').equals([GAME, 2]).toArray()
    expect(changed?.confirmedWarnings).toEqual([warning])
  })
})

describe('changeLineColor', () => {
  it('改代表色：不寫事件，更新時間設為現在', async () => {
    const db = await lineOneReachedGenerationOne()
    const result = await changeLineColor(db, GAME, 1, '#FF7F0E', { now })
    expect(result).toEqual({
      status: 'done',
      value: lineRow(1, 'マンノウォー', { color: '#FF7F0E' }),
      warnings: [],
    })
    expect(await db.lines.get([GAME, 1])).toEqual(lineRow(1, 'マンノウォー', { color: '#FF7F0E' }))
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('格式不符時阻止；和目前相同時不寫入；系還沒開啟時丟出錯誤', async () => {
    const db = await lineOneReachedGenerationOne()
    expect(await changeLineColor(db, GAME, 1, '#12345')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'color' }],
    })
    expect(await changeLineColor(db, GAME, 1, '#1f77b4')).toEqual({
      status: 'done',
      value: lineRow(1, 'マンノウォー'),
      warnings: [],
    })
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
    await expect(changeLineColor(db, GAME, 2, '#1f77b4')).rejects.toThrow('第 2 系還沒開啟')
  })
})
