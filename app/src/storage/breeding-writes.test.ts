import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import {
  BUILD_PHASE_PEDIGREE,
  buildPhaseHerd,
  cyclePhaseHerd,
  designatedTo,
} from '../../tests/support/breeding'
import {
  GAME,
  horseRow,
  ownMareRow,
  restorationRow,
  stallionRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../../tests/support/rows'
import { correctBreeding, registerBreeding } from './breeding-writes'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import type { BreedingRow } from './records'

const now = new Date('2026-09-27T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 自由配種：種牡馬是內部馬匹 */
const freeWith = (horseId: string) => ({ kind: 'free' as const, sire: { horseId } })

/** 自由配種：種牡馬只有外部名稱 */
const freeNamed = (name: string) => ({ kind: 'free' as const, sire: { name } })

/** 目前遊戲年 1990：待指定用途的在圈母馬 M（1980 年生）、牡馬 S 與牝馬 F */
async function herd(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.horses.bulkAdd([
    horseRow('M', { sex: 'female', baseName: 'ハナカゴ', birthYear: 1980 }),
    horseRow('S', { sex: 'male', baseName: 'トサミドリ' }),
    horseRow('F', { sex: 'female' }),
  ])
  await db.mares.add(ungroupedMareRow('M', 'unassigned'))
  return db
}

/** 母馬 M 在 year 年的自由配種紀錄，種牡馬為 S */
function freeBreeding(id: string, year: number, fields: Partial<BreedingRow> = {}): BreedingRow {
  return { id, gameId: GAME, mareId: 'M', year, kind: 'free', sireId: 'S', ...fields }
}

describe('registerBreeding：自由配種', () => {
  it('種牡馬是內部馬匹：寫入今年的配種紀錄與事件，不做規則與血統檢查', async () => {
    const db = await herd()
    const result = await registerBreeding(db, GAME, 'M', freeWith('S'), { now })
    if (result.status !== 'done') throw new Error(result.status)
    const { breeding } = result.value
    expect(result).toEqual({
      status: 'done',
      value: { breeding, parentSystemUnknown: false },
      warnings: [],
    })
    expect(breeding).toStrictEqual({
      id: breeding.id,
      gameId: GAME,
      mareId: 'M',
      year: 1990,
      kind: 'free',
      sireId: 'S',
    })
    expect(await db.breedings.get(breeding.id)).toStrictEqual(breeding)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-27T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'breeding-registered',
        horseId: 'M',
        breedingId: breeding.id,
        breeding: { kind: 'free', sireId: 'S' },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-27T01:02:03.000Z')
  })

  it('種牡馬只有外部名稱：去掉前後空白與前綴存基本馬名；空白或只有前綴時阻止，什麼都不寫', async () => {
    const db = await herd()
    expect(await registerBreeding(db, GAME, 'M', freeNamed('(外)'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-name' }],
    })
    expect(await registerBreeding(db, GAME, 'M', freeNamed('  '))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-name' }],
    })
    expect(await db.breedings.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)

    const result = await registerBreeding(db, GAME, 'M', freeNamed(' (外)ノーザンダンサー '))
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.breeding).toStrictEqual({
      id: result.value.breeding.id,
      gameId: GAME,
      mareId: 'M',
      year: 1990,
      kind: 'free',
      sireName: 'ノーザンダンサー',
    })
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'breeding-registered',
      breeding: { kind: 'free', sireName: 'ノーザンダンサー' },
    })
  })

  it('母馬在圈就好：自由配種所生、已被取代的姊妹、已達定年的母馬都可以登記（需求規格 7.8）', async () => {
    const db = await herd()
    await db.horses.bulkAdd([
      horseRow('FR', { sex: 'female' }),
      horseRow('R', { sex: 'female' }),
      horseRow('OLD', { sex: 'female', birthYear: 1965 }),
    ])
    await db.mares.bulkAdd([
      ungroupedMareRow('FR', 'free'),
      ownMareRow('R', 1, 2, { sisterStatus: 'replaced' }),
      ungroupedMareRow('OLD', 'unassigned'),
    ])
    for (const mareId of ['FR', 'R', 'OLD']) {
      const result = await registerBreeding(db, GAME, mareId, freeWith('S'))
      expect(result.status).toBe('done')
    }
    expect(await db.breedings.count()).toBe(3)
  })

  it('這匹母馬今年已有配種紀錄時阻止並指出那一筆，阻止原因一次列全；往年的紀錄不算', async () => {
    const db = await herd()
    await db.breedings.add(freeBreeding('B89', 1989))
    const first = await registerBreeding(db, GAME, 'M', freeWith('S'))
    if (first.status !== 'done') throw new Error(first.status)
    expect(await registerBreeding(db, GAME, 'M', freeNamed('(外)'))).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'already-registered', breedingId: first.value.breeding.id },
        { kind: 'sire-name' },
      ],
    })
    expect(await db.breedings.count()).toBe(2)
  })

  it('母馬或種牡馬找不到、屬於其他局，母馬不在圈內，或種牡馬是牝馬時丟出錯誤', async () => {
    const db = await herd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('M2', { gameId: 'G2', sex: 'female' }),
      horseRow('S2', { gameId: 'G2', sex: 'male' }),
      horseRow('SOLD', { sex: 'female' }),
    ])
    await db.mares.bulkAdd([
      ungroupedMareRow('M2', 'unassigned', { gameId: 'G2' }),
      ungroupedMareRow('SOLD', 'unassigned', { herd: 'sold' }),
    ])
    await expect(registerBreeding(db, GAME, 'X', freeWith('S'))).rejects.toThrow('找不到母馬：X')
    await expect(registerBreeding(db, GAME, 'M2', freeWith('S'))).rejects.toThrow('找不到母馬：M2')
    await expect(registerBreeding(db, GAME, 'SOLD', freeWith('S'))).rejects.toThrow(
      '不在繁殖圈內的母馬不能登記配種：SOLD',
    )
    await expect(registerBreeding(db, GAME, 'M', freeWith('X'))).rejects.toThrow('找不到馬匹：X')
    await expect(registerBreeding(db, GAME, 'M', freeWith('S2'))).rejects.toThrow('找不到馬匹：S2')
    await expect(registerBreeding(db, GAME, 'M', freeWith('F'))).rejects.toThrow(
      '牝馬不能當種牡馬：F',
    )
    expect(await db.breedings.count()).toBe(0)
  })
})

describe('correctBreeding：自由配種', () => {
  it('更正今年的紀錄：換種牡馬，受胎狀態不變；事件記原內容與新內容', async () => {
    const db = await herd()
    await db.breedings.add(freeBreeding('B', 1990, { conception: '受胎' }))
    const result = await correctBreeding(db, GAME, 'B', freeNamed('ノーザンダンサー'), { now })
    if (result.status !== 'done') throw new Error(result.status)
    const breeding = {
      id: 'B',
      gameId: GAME,
      mareId: 'M',
      year: 1990,
      conception: '受胎',
      kind: 'free',
      sireName: 'ノーザンダンサー',
    }
    expect(result).toEqual({
      status: 'done',
      value: { breeding, parentSystemUnknown: false },
      warnings: [],
    })
    expect(await db.breedings.get('B')).toStrictEqual(breeding)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-27T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'breeding-corrected',
        horseId: 'M',
        breedingId: 'B',
        from: { kind: 'free', sireId: 'S' },
        to: { kind: 'free', sireName: 'ノーザンダンサー' },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-27T01:02:03.000Z')
  })

  it('和目前相同時阻止；往年的紀錄只能看，不能更正（BRD-25）', async () => {
    const db = await herd()
    await db.breedings.bulkAdd([freeBreeding('B', 1990), freeBreeding('B89', 1989)])
    expect(await correctBreeding(db, GAME, 'B', freeWith('S'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await correctBreeding(db, GAME, 'B89', freeNamed('ノーザンダンサー'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'past-year' }],
    })
    expect(await db.events.count()).toBe(0)
  })

  it('已有產駒的出生紀錄連到這一筆時阻止並指出那匹產駒，阻止原因一次列全（BRD-25）', async () => {
    const db = await herd()
    await db.breedings.add(freeBreeding('B', 1990))
    // 同一匹母馬其他配種的產駒不算
    await db.horses.add(horseRow('EARLIER', { damId: 'M', birth: { breedingId: 'B89' } }))
    const corrected = await correctBreeding(db, GAME, 'B', freeNamed('ノーザンダンサー'))
    expect(corrected.status).toBe('done')
    await db.horses.add(horseRow('FOAL', { damId: 'M', birth: { breedingId: 'B' } }))
    expect(await correctBreeding(db, GAME, 'B', freeNamed('(外)'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'foal-exists', horseId: 'FOAL' }, { kind: 'sire-name' }],
    })
  })

  it('配種紀錄找不到或屬於其他局時丟出錯誤', async () => {
    const db = await herd()
    await addTestGame(db, { id: 'G2' })
    await db.breedings.add(freeBreeding('B2', 1990, { gameId: 'G2' }))
    await expect(correctBreeding(db, GAME, 'X', freeWith('S'))).rejects.toThrow('找不到配種紀錄：X')
    await expect(correctBreeding(db, GAME, 'B2', freeWith('S'))).rejects.toThrow(
      '找不到配種紀錄：B2',
    )
  })
})

describe('registerBreeding：指定配種', () => {
  it('第 1 系 1 代 × 替代第 2 系 1 代 → 第 1 系 2 代：寫入規則快照與事件；建系期不計算活血', async () => {
    const db = await buildPhaseHerd()
    const result = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'), { now })
    if (result.status !== 'done') throw new Error(result.status)
    const { breeding } = result.value
    expect(result).toEqual({
      status: 'done',
      value: { breeding, parentSystemUnknown: false },
      warnings: [],
    })
    expect(breeding).toStrictEqual({
      id: breeding.id,
      gameId: GAME,
      mareId: 'SUB21',
      year: 1990,
      kind: 'designated',
      sireId: 'S11',
      rule: {
        distance: 1,
        sire: { line: 1, generation: 1 },
        dam: { kind: 'substitute', forLine: 2, forGeneration: 1 },
        output: { line: 1, generation: 2 },
        pedigree: BUILD_PHASE_PEDIGREE,
      },
    })
    expect(await db.breedings.get(breeding.id)).toStrictEqual(breeding)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-27T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'breeding-registered',
        horseId: 'SUB21',
        breedingId: breeding.id,
        breeding: { kind: 'designated', sireId: 'S11', output: { line: 1, generation: 2 } },
      },
    ])
  })

  it('自家母駒配零代種牡馬是一般情況，不警告；傳了例外補入的原因也不保存', async () => {
    const db = await buildPhaseHerd()
    const result = await registerBreeding(
      db,
      GAME,
      'D11',
      designatedTo(2, 2, 'Z2', '不是例外補入，不保存'),
    )
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.warnings).toEqual([])
    expect(result.value.breeding).not.toHaveProperty('exceptionReason')
    expect(result.value.breeding.rule).toMatchObject({
      distance: 1,
      sire: { line: 2, generation: 0 },
      dam: { kind: 'own', line: 1, generation: 1 },
      output: { line: 2, generation: 2 },
    })
  })

  it('產出那一系那一代的配對不在任務看板上時只回傳 no-pairing', async () => {
    const db = await buildPhaseHerd()
    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 3, 'S11'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'no-pairing' }],
    })
    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(3, 3, 'S11'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'no-pairing' }],
    })
    // 第 2 系還沒開啟時，產出第 2 系 2 代的建立新系只是可開啟分支的配對，還不是任務
    await db.lines.delete([GAME, 2])
    await db.stallions.delete('Z2')
    expect(await registerBreeding(db, GAME, 'D11', designatedTo(2, 2, 'Z2'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'no-pairing' }],
    })
    expect(await db.breedings.count()).toBe(0)
  })

  it('八系以外的種牡馬、待指定用途的母馬：身分不符而阻止（10.3）', async () => {
    const db = await buildPhaseHerd()
    await db.horses.bulkAdd([horseRow('X', { sex: 'male' }), horseRow('U', { sex: 'female' })])
    await db.mares.add(ungroupedMareRow('U', 'unassigned'))
    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'X'))).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'rule',
          rule: { side: 'sire', expected: { line: 1, generation: 1 }, mismatches: ['role'] },
        },
      ],
    })
    expect(await registerBreeding(db, GAME, 'U', designatedTo(1, 2, 'S11'))).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'rule',
          rule: { side: 'dam', expected: { line: 2, generation: 1 }, mismatches: ['role'] },
        },
      ],
    })
    expect(await db.breedings.count()).toBe(0)
  })

  it('系與代數相符、但不是那一格在崗的種牡馬時阻止：已被取代、還沒正式供用的預定後繼', async () => {
    const db = await buildPhaseHerd()
    await db.horses.bulkAdd([horseRow('S11B', { sex: 'male' }), horseRow('W', { sex: 'male' })])
    await db.stallions.update('S11', { status: 'replaced' })
    await db.stallions.bulkAdd([
      stallionRow('S11B', 1, 1),
      stallionRow('W', 1, 1, { status: undefined, readiness: 'racing' }),
    ])
    for (const sireId of ['S11', 'W']) {
      expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, sireId))).toEqual({
        status: 'blocked',
        blocks: [{ kind: 'sire-not-active' }],
      })
    }
    const result = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11B'))
    expect(result.status).toBe('done')
  })

  it('母馬沒有列入任務時阻止，阻止原因一次列全', async () => {
    const db = await buildPhaseHerd()
    await db.horses.add(horseRow('OLD', { sex: 'female', birthYear: 1965 }))
    await db.mares.add(substituteMareRow('OLD', 2, 1))
    expect(await registerBreeding(db, GAME, 'OLD', designatedTo(1, 2, 'Z1'))).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'mare-not-listed' },
        {
          kind: 'rule',
          rule: { side: 'sire', expected: { line: 1, generation: 1 }, mismatches: ['generation'] },
        },
      ],
    })
  })

  it('例外補入要確認，確認前什麼都不寫；原因沿用母馬登記時的，另外填時去掉前後空白後保存（BRD-22）', async () => {
    const db = await buildPhaseHerd()
    const warning = { kind: 'exception-entry', line: 2, generation: 2 }
    expect(await registerBreeding(db, GAME, 'SUB11', designatedTo(2, 2, 'Z2'))).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.breedings.count()).toBe(0)
    expect(await db.events.count()).toBe(0)

    const result = await registerBreeding(db, GAME, 'SUB11', designatedTo(2, 2, 'Z2'), {
      confirmed: true,
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.warnings).toEqual([warning])
    expect(result.value.breeding).toMatchObject({
      exceptionReason: '自家母駒不足',
      confirmedWarnings: [warning],
      rule: { dam: { kind: 'substitute', forLine: 1, forGeneration: 1 } },
    })
    expect((await db.events.toArray())[0]).toMatchObject({
      breeding: { exceptionReason: '自家母駒不足' },
      confirmedWarnings: [warning],
    })

    const corrected = await correctBreeding(
      db,
      GAME,
      result.value.breeding.id,
      designatedTo(2, 2, 'Z2', ' 市場母馬的血統較好 '),
      { confirmed: true },
    )
    expect(corrected.status === 'done' && corrected.value.breeding.exceptionReason).toBe(
      '市場母馬的血統較好',
    )
  })

  it('補公系配對：用補入的零代種牡馬，規則快照記 restoration；母馬登記時沒有原因就要在配種時填（BRD-22）', async () => {
    const db = await buildPhaseHerd()
    // 第 1 系 1 代的種牡馬已引退，宣告補公系並補入零代市場種牡馬 ZR；
    // 先前撤銷的宣告 R0 底下的任用留著，但不算這一格
    await db.stallions.update('S11', { status: 'retired' })
    await db.restorations.bulkAdd([
      restorationRow('R0', 1, 1, 'sire', { revoked: true }),
      restorationRow('R1', 1, 1, 'sire'),
    ])
    await db.horses.bulkAdd([horseRow('ZOLD', { sex: 'male' }), horseRow('ZR', { sex: 'male' })])
    await db.stallions.bulkAdd([
      stallionRow('ZOLD', 1, 0, { restorationId: 'R0' }),
      stallionRow('ZR', 1, 0, { restorationId: 'R1' }),
    ])

    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'ZR'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    const reason = '第 1 系 1 代沒有種牡馬'
    for (const sireId of ['Z1', 'ZOLD']) {
      expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, sireId, reason))).toEqual(
        { status: 'blocked', blocks: [{ kind: 'sire-not-active' }] },
      )
    }
    const result = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'ZR', reason), {
      confirmed: true,
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.warnings).toEqual([{ kind: 'exception-entry', line: 1, generation: 2 }])
    expect(result.value.breeding).toMatchObject({
      sireId: 'ZR',
      exceptionReason: reason,
      rule: {
        distance: 1,
        sire: { line: 1, generation: 0 },
        dam: { kind: 'substitute', forLine: 2, forGeneration: 1 },
        output: { line: 1, generation: 2 },
        restoration: true,
      },
    })
  })

  it('替代母馬在配種時重做 8.3 親系統檢查：撞到時要確認；自身父系不明時只提示', async () => {
    const db = await buildPhaseHerd()
    await db.horses.update('SUB21', { sireSystem: 'マンノウォー' })
    const warning = {
      kind: 'substitute-parent-system',
      line: 2,
      generation: 1,
      conflicts: [
        { kind: 'line', parentSystem: 'マッチェム', lines: [1] },
        { kind: 'substitute', parentSystem: 'マッチェム', lines: [1] },
      ],
    }
    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'))).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    await db.horses.update('SUB21', { sireSystem: undefined })
    const result = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'))
    expect(result).toEqual({
      status: 'done',
      value: { breeding: expect.any(Object), parentSystemUnknown: true },
      warnings: [],
    })
  })
})

describe('correctBreeding：指定配種', () => {
  it('指定與自由可以互換，檢查照登記重做；事件記原內容與新內容', async () => {
    const db = await buildPhaseHerd()
    const registered = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'))
    if (registered.status !== 'done') throw new Error(registered.status)
    const { id } = registered.value.breeding

    const free = await correctBreeding(db, GAME, id, {
      kind: 'free',
      sire: { name: 'ノーザンダンサー' },
    })
    if (free.status !== 'done') throw new Error(free.status)
    expect(free.value.breeding).toStrictEqual({
      id,
      gameId: GAME,
      mareId: 'SUB21',
      year: 1990,
      kind: 'free',
      sireName: 'ノーザンダンサー',
    })
    expect(
      (await db.events.toArray()).find((event) => event.kind === 'breeding-corrected'),
    ).toMatchObject({
      from: { kind: 'designated', sireId: 'S11', output: { line: 1, generation: 2 } },
      to: { kind: 'free', sireName: 'ノーザンダンサー' },
    })
    expect(await correctBreeding(db, GAME, id, designatedTo(1, 2, 'Z1'))).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'rule',
          rule: { side: 'sire', expected: { line: 1, generation: 1 }, mismatches: ['generation'] },
        },
      ],
    })
  })
})

describe('registerBreeding：血統檢查（10.2）', () => {
  it('循環期有要確認的血統警告時警告並確認，確認前什麼都不寫；規則快照存檢查的完整結果', async () => {
    const db = await cyclePhaseHerd()
    const warning = { kind: 'pedigree', warnings: ['insufficient-data'] }
    expect(await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'))).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.breedings.count()).toBe(0)
    expect(await db.events.count()).toBe(0)

    const result = await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'), {
      confirmed: true,
    })
    if (result.status !== 'done') throw new Error(result.status)
    const { breeding } = result.value
    expect(result.warnings).toEqual([warning])
    expect(breeding.confirmedWarnings).toEqual([warning])
    expect(breeding.rule?.pedigree).toMatchObject({
      estimate: {
        count: 0,
        status: 'insufficient',
        established: false,
        missingLines: [1, 2, 3, 4, 5, 6, 7, 8],
        unknownSlots: [0, 1, 2, 3, 4, 5, 6, 7],
      },
      duplicates: [],
      warnings: [{ kind: 'insufficient-data', hintOnly: false }],
    })
    expect(breeding.rule?.pedigree.estimate?.slots).toHaveLength(8)
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'breeding-registered',
      confirmedWarnings: [warning],
    })
  })
})
