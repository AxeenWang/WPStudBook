import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow, lineRow, restorationRow, stallionRow } from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { loadRuleSnapshot } from './loaders'
import type { EventRow } from './records'
import { declareRestoration } from './restoration-writes'
import { assignZeroStallion, setStallionStatus } from './stallion-writes'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

const historical = { kind: 'historical-retirement' as const }

/**
 * 第 1 系 ネアルコ（親系統 ファラリス）、第 3 系 マンノウォー（親系統 マッチェム）；
 * 第 3 系建系的零代種牡馬 Z3 狀態為 status（預設已引退）
 */
async function lineThree(status: 'active' | 'retired' = 'retired'): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.bulkAdd([lineRow(1, 'ネアルコ'), lineRow(3, 'マンノウォー')])
  await db.systems.bulkAdd([
    { gameId: GAME, subsystem: 'ネアルコ', parentSystem: 'ファラリス' },
    { gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
    { gameId: GAME, subsystem: 'フェアウェイ', parentSystem: 'ファラリス' },
    { gameId: GAME, subsystem: 'ハイペリオン', parentSystem: 'ハイペリオン' },
  ])
  await db.horses.add(horseRow('Z3', { sex: 'male', sireSystem: 'マンノウォー' }))
  await db.stallions.add(stallionRow('Z3', 3, 0, { status }))
  return db
}

/** 替換第 3 系建系零代種牡馬的輸入：新建一匹父系為 sireSystem 的市場種牡馬 */
function replaceLineThree(sireSystem?: string) {
  return {
    slot: { kind: 'founding' as const, line: 3 as const },
    stallion: {
      kind: 'new' as const,
      horse: { fullName: 'ウォーレリック', ...(sireSystem === undefined ? {} : { sireSystem }) },
    },
    reason: historical,
  }
}

/** 事件依種類排序：同一次操作寫的事件識別是亂數，順序不固定 */
async function eventsByKind(db: WPStudBookDatabase): Promise<EventRow[]> {
  return (await db.events.toArray()).sort((a, b) => a.kind.localeCompare(b.kind))
}

describe('assignZeroStallion', () => {
  it('替換建系的零代種牡馬：新增在崗的零代任用，前任的任用保持原連結；事件記原因與前任', async () => {
    const db = await lineThree()
    const result = await assignZeroStallion(db, GAME, replaceLineThree('マンノウォー'), { now })
    if (result.status !== 'done') throw new Error(result.status)
    const { appointment, horse } = result.value
    expect(result.warnings).toEqual([])
    expect(appointment).toEqual({
      id: appointment.id,
      gameId: GAME,
      line: 3,
      generation: 0,
      horseId: horse.id,
      status: 'active',
    })
    expect(horse).toMatchObject({ fullName: 'ウォーレリック', sex: 'male', nameSource: 'manual' })
    expect(await db.horses.get(horse.id)).toEqual(horse)
    expect(await db.stallions.get('Z3')).toEqual(stallionRow('Z3', 3, 0, { status: 'retired' }))
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'stallion-assigned',
        line: 3,
        horseId: horse.id,
        stallionId: appointment.id,
        reason: { kind: 'historical-retirement' },
        replacedHorseIds: ['Z3'],
      },
    ])
    expect(await db.lines.get([GAME, 3])).toEqual(lineRow(3, 'マンノウォー'))
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
    const lineThreeSnapshot = (await loadRuleSnapshot(db, GAME)).eightLines.lines[2]!
    expect(lineThreeSnapshot.stallions).toEqual([{ generation: 0, state: 'active' }])
  })

  it('那一格還有在崗的種牡馬、替換沒附原因、選的馬已在這一格任用過時阻止，什麼都不寫', async () => {
    const active = await lineThree('active')
    expect(await assignZeroStallion(active, GAME, replaceLineThree('マンノウォー'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'slot-occupied' }],
    })
    const db = await lineThree()
    const { slot, stallion } = replaceLineThree('マンノウォー')
    expect(await assignZeroStallion(db, GAME, { slot, stallion })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    const again = { ...replaceLineThree(), stallion: { kind: 'existing' as const, horseId: 'Z3' } }
    expect(await assignZeroStallion(db, GAME, again)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'already-in-slot' }],
    })
    expect(await db.stallions.count()).toBe(1)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('父系與該系的子系統不同：要確認才寫入，確認後該系的子系統改為他的父系並留下歷程（STL-07）', async () => {
    const db = await lineThree()
    const input = replaceLineThree('ハイペリオン系')
    const warning = {
      kind: 'stallion-system',
      line: 3,
      subsystem: { current: 'マンノウォー', replacement: 'ハイペリオン' },
      parentSystem: { current: 'マッチェム', replacement: 'ハイペリオン' },
    }
    expect(await assignZeroStallion(db, GAME, input)).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.stallions.count()).toBe(1)

    const result = await assignZeroStallion(db, GAME, input, { confirmed: true })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.warnings).toEqual([warning])
    expect(await db.lines.get([GAME, 3])).toEqual(lineRow(3, 'ハイペリオン'))
    const [renamed, assigned] = await eventsByKind(db)
    expect(assigned).toMatchObject({ kind: 'stallion-assigned', confirmedWarnings: [warning] })
    expect(renamed).toMatchObject({
      kind: 'line-subsystem-changed',
      line: 3,
      horseId: result.value.horse.id,
      from: 'マンノウォー',
      to: 'ハイペリオン',
    })
  })

  it('改名造成親系統與其他系重複時，列在同一份警告', async () => {
    const db = await lineThree()
    const result = await assignZeroStallion(db, GAME, replaceLineThree('フェアウェイ'))
    expect(result).toEqual({
      status: 'unconfirmed',
      warnings: [
        {
          kind: 'stallion-system',
          line: 3,
          subsystem: { current: 'マンノウォー', replacement: 'フェアウェイ' },
          parentSystem: { current: 'マッチェム', replacement: 'ファラリス' },
        },
        { kind: 'parent-system-duplicate', line: 3, parentSystem: 'ファラリス', lines: [1] },
      ],
    })
  })

  it('父系不明時不比較，該系的子系統不變', async () => {
    const db = await lineThree()
    const result = await assignZeroStallion(db, GAME, replaceLineThree())
    expect(result.status).toBe('done')
    expect(await db.lines.get([GAME, 3])).toEqual(lineRow(3, 'マンノウォー'))
    expect(await db.events.count()).toBe(1)
  })

  it('補公系第一次選定不需原因；可以沿用建系時的零代種牡馬，任用記在這次補系，建系那一格不變', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(5, 'ハイペリオン'))
    await db.horses.add(horseRow('Z5', { sex: 'male' }))
    await db.stallions.bulkAdd([
      stallionRow('Z5', 5, 0),
      stallionRow('S512', 5, 12, { status: 'retired' }),
    ])
    const declared = await declareRestoration(db, GAME, {
      line: 5,
      generation: 12,
      side: 'sire',
      reason: '後繼無法延續',
    })
    if (declared.status !== 'done') throw new Error(declared.status)
    const restorationId = declared.value.id
    const result = await assignZeroStallion(db, GAME, {
      slot: { kind: 'restoration', restorationId },
      stallion: { kind: 'existing', horseId: 'Z5' },
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.appointment).toEqual({
      id: result.value.appointment.id,
      gameId: GAME,
      line: 5,
      generation: 0,
      restorationId,
      horseId: 'Z5',
      status: 'active',
    })
    expect(await db.horses.count()).toBe(1)
    const lineFive = (await loadRuleSnapshot(db, GAME)).eightLines.lines[4]!
    expect(lineFive.restorations).toEqual([{ side: 'sire', generation: 12, stallion: 'active' }])
    expect(lineFive.stallions).toEqual([
      { generation: 0, state: 'active' },
      { generation: 12, state: 'ended' },
    ])
  })

  it('系還沒開啟、補系宣告找不到、屬於其他局、已撤銷或是補母系時丟出錯誤', async () => {
    const db = await lineThree()
    await addTestGame(db, { id: 'G2' })
    await db.restorations.bulkAdd([
      restorationRow('R2', 3, 5, 'sire', { gameId: 'G2' }),
      restorationRow('RV', 3, 5, 'sire', { revoked: true }),
      restorationRow('RD', 3, 5, 'dam'),
    ])
    const stallion = replaceLineThree().stallion
    await expect(
      assignZeroStallion(db, GAME, { slot: { kind: 'founding', line: 4 }, stallion }),
    ).rejects.toThrow('第 4 系還沒開啟')
    for (const restorationId of ['X', 'R2']) {
      await expect(
        assignZeroStallion(db, GAME, { slot: { kind: 'restoration', restorationId }, stallion }),
      ).rejects.toThrow(`找不到補系宣告：${restorationId}`)
    }
    for (const restorationId of ['RV', 'RD']) {
      await expect(
        assignZeroStallion(db, GAME, { slot: { kind: 'restoration', restorationId }, stallion }),
      ).rejects.toThrow(`補系宣告不是有效的補公系：${restorationId}`)
    }
  })
  it('替換者的父系沒登錄在對照表時，親系統的替換值為 null，提示補登', async () => {
    const db = await lineThree()
    expect(await assignZeroStallion(db, GAME, replaceLineThree('未登録系'))).toEqual({
      status: 'unconfirmed',
      warnings: [
        {
          kind: 'stallion-system',
          line: 3,
          subsystem: { current: 'マンノウォー', replacement: '未登録' },
          parentSystem: { current: 'マッチェム', replacement: null },
        },
      ],
    })
  })

  it('原因的說明去掉前後空白；只有空白時不寫說明', async () => {
    const db = await lineThree()
    /** 這匹馬的補入或替換事件記下的原因 */
    const reasonOfHorse = async (horseId: string) => {
      const events = await db.events.where('[gameId+horseId]').equals([GAME, horseId]).toArray()
      const assigned = events.find((event) => event.kind === 'stallion-assigned')
      return assigned?.kind === 'stallion-assigned' ? assigned.reason : undefined
    }
    const first = await assignZeroStallion(db, GAME, {
      ...replaceLineThree('マンノウォー'),
      reason: { kind: 'other', note: ' 史実で早期引退 ' },
    })
    if (first.status !== 'done') throw new Error(first.status)
    const retired = await setStallionStatus(db, GAME, first.value.appointment.id, 'retired')
    expect(retired.status).toBe('done')
    const second = await assignZeroStallion(db, GAME, {
      slot: { kind: 'founding', line: 3 },
      stallion: {
        kind: 'new',
        horse: { fullName: 'ウォーレリック二世', sireSystem: 'マンノウォー' },
      },
      reason: { kind: 'other', note: '  ' },
    })
    if (second.status !== 'done') throw new Error(second.status)
    expect(await reasonOfHorse(first.value.horse.id)).toEqual({
      kind: 'other',
      note: '史実で早期引退',
    })
    expect(await reasonOfHorse(second.value.horse.id)).toEqual({ kind: 'other' })
  })
})

describe('setStallionStatus', () => {
  it('在崗標示為已引退：事件記原狀態與新狀態；那一格成為已離場', async () => {
    const db = await lineThree('active')
    const result = await setStallionStatus(db, GAME, 'Z3', 'retired', { now })
    const retired = stallionRow('Z3', 3, 0, { status: 'retired' })
    expect(result).toEqual({ status: 'done', value: retired, warnings: [] })
    expect(await db.stallions.get('Z3')).toEqual(retired)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'stallion-status-changed',
        line: 3,
        horseId: 'Z3',
        stallionId: 'Z3',
        generation: 0,
        from: 'active',
        to: 'retired',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
    const lineThreeSnapshot = (await loadRuleSnapshot(db, GAME)).eightLines.lines[2]!
    expect(lineThreeSnapshot.stallions).toEqual([{ generation: 0, state: 'ended' }])
  })

  it('已被取代的也可以標示退出生產行列', async () => {
    const db = await lineThree()
    await db.stallions.add(stallionRow('B', 3, 4, { status: 'replaced' }))
    expect((await setStallionStatus(db, GAME, 'B', 'withdrawn')).status).toBe('done')
  })

  it('不能這樣改時阻止：已引退改退出、預定後繼標示引退、在崗改在崗', async () => {
    const db = await lineThree()
    await db.stallions.bulkAdd([
      stallionRow('W', 3, 4, { status: undefined, readiness: 'racing' }),
      stallionRow('A', 3, 5),
    ])
    const invalid = { status: 'blocked', blocks: [{ kind: 'invalid-transition' }] }
    expect(await setStallionStatus(db, GAME, 'Z3', 'withdrawn')).toEqual(invalid)
    expect(await setStallionStatus(db, GAME, 'W', 'retired')).toEqual(invalid)
    expect(await setStallionStatus(db, GAME, 'A', 'active')).toEqual(invalid)
    expect(await db.events.count()).toBe(0)
  })

  it('更正回在崗：同一格沒有其他在崗時可以；有的話阻止並指出那一匹；補公系的任用是另一格', async () => {
    const db = await lineThree()
    expect((await setStallionStatus(db, GAME, 'Z3', 'active')).status).toBe('done')
    await db.stallions.bulkAdd([
      stallionRow('R', 3, 0, { restorationId: 'RS', status: 'retired' }),
      stallionRow('Y', 3, 0, { status: 'retired' }),
    ])
    expect(await setStallionStatus(db, GAME, 'Y', 'active')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'slot-active', stallionId: 'Z3' }],
    })
    expect((await setStallionStatus(db, GAME, 'R', 'active')).status).toBe('done')
  })

  it('任用找不到或屬於其他局時丟出錯誤', async () => {
    const db = await lineThree()
    await addTestGame(db, { id: 'G2' })
    await db.stallions.add(stallionRow('O', 3, 0, { gameId: 'G2' }))
    for (const id of ['X', 'O']) {
      await expect(setStallionStatus(db, GAME, id, 'retired')).rejects.toThrow(
        `找不到種牡馬的任用：${id}`,
      )
    }
  })

  it('誤標為退出或引退的已被取代種牡馬，可以更正回已被取代；同一格沒有在崗時阻止（使用者 2026-09-26 決定）', async () => {
    const db = await lineThree('active')
    await db.stallions.add(stallionRow('B', 3, 0, { status: 'retired' }))
    const result = await setStallionStatus(db, GAME, 'B', 'replaced', { now })
    const replaced = stallionRow('B', 3, 0, { status: 'replaced' })
    expect(result).toEqual({ status: 'done', value: replaced, warnings: [] })
    expect(await db.events.toArray()).toEqual([
      expect.objectContaining({
        kind: 'stallion-status-changed',
        stallionId: 'B',
        from: 'retired',
        to: 'replaced',
      }),
    ])

    expect((await setStallionStatus(db, GAME, 'Z3', 'retired')).status).toBe('done')
    await db.stallions.update('B', { status: 'withdrawn' })
    expect(await setStallionStatus(db, GAME, 'B', 'replaced')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'no-incumbent' }],
    })
  })

  it('在崗不能直接改成已被取代：換人要用更換現任', async () => {
    const db = await lineThree('active')
    await db.stallions.add(stallionRow('B', 3, 0, { status: 'retired' }))
    expect(await setStallionStatus(db, GAME, 'Z3', 'replaced')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'invalid-transition' }],
    })
  })
})
