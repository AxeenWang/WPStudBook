import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, lineRow } from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import type { SystemRow } from './records'
import { addSystem, changeSystem } from './system-writes'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

function systemRow(subsystem: string, parentSystem: string, origin?: string): SystemRow {
  return origin === undefined
    ? { gameId: GAME, subsystem, parentSystem }
    : { gameId: GAME, subsystem, parentSystem, origin }
}

/** 第 1 系 マンノウォー（親系統 マッチェム）、第 2 系 ネアルコ（對照表沒有登錄） */
async function twoLines(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.bulkAdd([lineRow(1, 'マンノウォー'), lineRow(2, 'ネアルコ')])
  await db.systems.add(systemRow('マンノウォー', 'マッチェム'))
  return db
}

describe('addSystem', () => {
  it('新增一筆：名稱去掉前後空白與結尾「系」，寫入事件，更新時間設為現在', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await addSystem(
      db,
      GAME,
      {
        subsystem: ' ノーザンダンサー系 ',
        parentSystem: 'ノーザンダンサー',
        origin: 'ニアークティック系',
      },
      { now },
    )
    const row = systemRow('ノーザンダンサー', 'ノーザンダンサー', 'ニアークティック')
    expect(result).toEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.systems.toArray()).toEqual([row])
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'system-added',
        system: 'ノーザンダンサー',
        parentSystem: 'ノーザンダンサー',
        origin: 'ニアークティック',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('分出來源留空或只有空白時不寫那個欄位', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await addSystem(db, GAME, {
      subsystem: 'エクリプス',
      parentSystem: 'エクリプス',
      origin: ' ',
    })
    expect(result).toEqual({
      status: 'done',
      value: systemRow('エクリプス', 'エクリプス'),
      warnings: [],
    })
  })

  it('名稱空白、分出來源是自己、子系統已經登錄時阻止，什麼都不寫', async () => {
    const db = await twoLines()
    expect(await addSystem(db, GAME, { subsystem: ' 系 ', parentSystem: '' })).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'blank', field: 'subsystem' },
        { kind: 'blank', field: 'parentSystem' },
      ],
    })
    expect(
      await addSystem(db, GAME, {
        subsystem: 'エクリプス',
        parentSystem: 'エクリプス',
        origin: 'エクリプス系',
      }),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'origin-is-self' }] })
    expect(
      await addSystem(db, GAME, { subsystem: 'マンノウォー系', parentSystem: 'ファラリス' }),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'already-registered' }] })
    expect(await db.systems.count()).toBe(1)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('已開啟的系因此有了親系統、而且與其他系重複時，要確認才寫入，確認紀錄存在事件（需求規格 7.2）', async () => {
    const db = await twoLines()
    const input = { subsystem: 'ネアルコ', parentSystem: 'マッチェム' }
    const warning = {
      kind: 'parent-system-duplicate',
      line: 2,
      parentSystem: 'マッチェム',
      lines: [1],
    }
    expect(await addSystem(db, GAME, input)).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.systems.count()).toBe(1)
    expect(await db.events.count()).toBe(0)

    const result = await addSystem(db, GAME, input, { confirmed: true })
    expect(result).toEqual({
      status: 'done',
      value: systemRow('ネアルコ', 'マッチェム'),
      warnings: [warning],
    })
    expect((await db.events.toArray())[0]?.confirmedWarnings).toEqual([warning])
  })

  it('沒有系在用的子系統不會造成重複，不警告', async () => {
    const db = await twoLines()
    const result = await addSystem(db, GAME, {
      subsystem: 'フェアウェイ',
      parentSystem: 'マッチェム',
    })
    expect(result.status).toBe('done')
  })
})

describe('changeSystem', () => {
  it('子系統升格：親系統改為新值，事件記原值、新值與年份（需求規格 7.2）', async () => {
    const db = await twoLines()
    const result = await changeSystem(
      db,
      GAME,
      'マンノウォー',
      { parentSystem: 'マンノウォー' },
      { now },
    )
    expect(result).toEqual({
      status: 'done',
      value: systemRow('マンノウォー', 'マンノウォー'),
      warnings: [],
    })
    expect(await db.systems.get([GAME, 'マンノウォー'])).toEqual(
      systemRow('マンノウォー', 'マンノウォー'),
    )
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'system-changed',
        system: 'マンノウォー',
        from: { parentSystem: 'マッチェム' },
        to: { parentSystem: 'マンノウォー' },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('可以設定或清除分出來源', async () => {
    const db = await twoLines()
    const withOrigin = systemRow('マンノウォー', 'マッチェム', 'フェアプレイ')
    expect(
      await changeSystem(db, GAME, 'マンノウォー', {
        parentSystem: 'マッチェム',
        origin: 'フェアプレイ',
      }),
    ).toEqual({ status: 'done', value: withOrigin, warnings: [] })
    const withoutOrigin = systemRow('マンノウォー', 'マッチェム')
    expect(await changeSystem(db, GAME, 'マンノウォー', { parentSystem: 'マッチェム' })).toEqual({
      status: 'done',
      value: withoutOrigin,
      warnings: [],
    })
    expect(await db.systems.get([GAME, 'マンノウォー'])).toEqual(withoutOrigin)
    expect(await db.events.count()).toBe(2)
  })

  it('沒有變更時不寫入，更新時間不變', async () => {
    const db = await twoLines()
    const result = await changeSystem(db, GAME, 'マンノウォー', { parentSystem: 'マッチェム系' })
    expect(result).toEqual({
      status: 'done',
      value: systemRow('マンノウォー', 'マッチェム'),
      warnings: [],
    })
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('親系統空白或分出來源是自己時阻止；子系統沒有登錄時丟出錯誤', async () => {
    const db = await twoLines()
    expect(await changeSystem(db, GAME, 'マンノウォー', { parentSystem: ' ' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'blank', field: 'parentSystem' }],
    })
    expect(
      await changeSystem(db, GAME, 'マンノウォー', {
        parentSystem: 'マッチェム',
        origin: 'マンノウォー',
      }),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'origin-is-self' }] })
    await expect(changeSystem(db, GAME, 'ネアルコ', { parentSystem: 'ネアルコ' })).rejects.toThrow(
      '找不到系統對照表的子系統：ネアルコ',
    )
  })

  it('升格造成親系統與其他系重複時，要確認才寫入（需求規格 7.2）', async () => {
    const db = await twoLines()
    await db.systems.add(systemRow('ネアルコ', 'ファラリス'))
    const result = await changeSystem(db, GAME, 'ネアルコ', { parentSystem: 'マッチェム' })
    expect(result).toEqual({
      status: 'unconfirmed',
      warnings: [
        { kind: 'parent-system-duplicate', line: 2, parentSystem: 'マッチェム', lines: [1] },
      ],
    })
    expect(await db.systems.get([GAME, 'ネアルコ'])).toEqual(systemRow('ネアルコ', 'ファラリス'))
  })
})
