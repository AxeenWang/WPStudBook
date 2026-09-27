import { describe, expect, it } from 'vitest'
import { buildPhaseHerd } from '../../tests/support/breeding'
import { GAME } from '../../tests/support/rows'
import { rateMating } from './rating-writes'

const now = new Date('2026-09-27T01:02:03.000Z')

describe('rateMating', () => {
  it('同一組同一年整組取代，跨年另起一列、舊值保留；事件記原值與新值（BRD-17）', async () => {
    const db = await buildPhaseHerd()
    const first = await rateMating(
      db,
      GAME,
      'D11',
      { sire: { horseId: 'S11' }, grade: 'A', burst: 12 },
      { now },
    )
    if (first.status !== 'done') throw new Error(first.status)
    const { id } = first.value
    expect(first).toEqual({
      status: 'done',
      value: { id, gameId: GAME, mareId: 'D11', sireId: 'S11', year: 1990, grade: 'A', burst: 12 },
      warnings: [],
    })
    expect(await db.matingRatings.get(id)).toStrictEqual(first.value)

    const edited = await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'S' })
    expect(edited).toEqual({
      status: 'done',
      value: { id, gameId: GAME, mareId: 'D11', sireId: 'S11', year: 1990, grade: 'S' },
      warnings: [],
    })
    expect(await db.matingRatings.get(id)).toStrictEqual(edited.status === 'done' && edited.value)

    await db.games.update(GAME, { currentYear: 1991 })
    const nextYear = await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'B' })
    if (nextYear.status !== 'done') throw new Error(nextYear.status)
    expect(nextYear.value.id).not.toBe(id)
    expect(await db.matingRatings.count()).toBe(2)
    expect((await db.matingRatings.get(id))?.grade).toBe('S')

    const events = (await db.events.toArray()).filter((event) => event.kind === 'mating-rated')
    expect(events).toHaveLength(3)
    expect(events).toContainEqual({
      id: expect.any(String),
      gameId: GAME,
      year: 1990,
      recordedAt: '2026-09-27T01:02:03.000Z',
      source: { kind: 'manual' },
      kind: 'mating-rated',
      horseId: 'D11',
      ratingId: id,
      to: { grade: 'A', burst: 12 },
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        ratingId: id,
        from: { grade: 'A', burst: 12 },
        to: { grade: 'S' },
      }),
    )
  })

  it('種牡馬可以只有外部名稱，去掉前綴存基本馬名；和內部識別登記的算不同的組合', async () => {
    const db = await buildPhaseHerd()
    await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'A' })
    const named = await rateMating(db, GAME, 'D11', {
      sire: { name: ' (外)トサミドリ ' },
      burst: 0,
    })
    if (named.status !== 'done') throw new Error(named.status)
    expect(named.value).toStrictEqual({
      id: named.value.id,
      gameId: GAME,
      mareId: 'D11',
      sireName: 'トサミドリ',
      year: 1990,
      burst: 0,
    })
    expect(await db.matingRatings.count()).toBe(2)
    const again = await rateMating(db, GAME, 'D11', { sire: { name: 'トサミドリ' }, burst: 3 })
    expect(again.status === 'done' && again.value.id).toBe(named.value.id)
  })

  it('評價與爆發力都沒有填、爆發力不是 0 以上的整數、外部名稱只有前綴時阻止，一次列全；和目前相同時阻止', async () => {
    const db = await buildPhaseHerd()
    expect(await rateMating(db, GAME, 'D11', { sire: { name: '(外)' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'empty' }, { kind: 'sire-name' }],
    })
    for (const burst of [-1, 1.5]) {
      expect(await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, burst })).toEqual({
        status: 'blocked',
        blocks: [{ kind: 'burst' }],
      })
    }
    await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'C', burst: 5 })
    expect(
      await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'C', burst: 5 }),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'unchanged' }] })
    expect(await db.matingRatings.count()).toBe(1)
  })

  it('母馬不限在圈；母馬或種牡馬有誤、總合評價不是 S～D 時丟出錯誤', async () => {
    const db = await buildPhaseHerd()
    await db.mares.update('D11', { herd: 'sold' })
    const sold = await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'D' })
    expect(sold.status).toBe('done')
    await expect(
      rateMating(db, GAME, 'X', { sire: { horseId: 'S11' }, grade: 'A' }),
    ).rejects.toThrow('找不到母馬：X')
    await expect(
      rateMating(db, GAME, 'D11', { sire: { horseId: 'SUB21' }, grade: 'A' }),
    ).rejects.toThrow('牝馬不能當種牡馬：SUB21')
    await expect(
      rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'E' as 'A' }),
    ).rejects.toThrow('總合評價不符：E')
  })
})
