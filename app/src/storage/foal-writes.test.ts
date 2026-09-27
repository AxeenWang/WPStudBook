import { describe, expect, it } from 'vitest'
import { foalingHerd } from '../../tests/support/breeding'
import { addTestGame } from '../../tests/support/database'
import { GAME, horseRow, substituteMareRow } from '../../tests/support/rows'
import { loadGame } from './games'
import { addFoal, nameFoal, setFoalDisposition } from './foal-writes'
import type { HorseRow } from './records'

const now = new Date('2026-09-27T01:02:03.000Z')

/** 1990 年出生的牝駒 */
const filly = (damId: string) => ({ damId, sex: 'female' as const, birthYear: 1990 })

describe('addFoal', () => {
  it('連結前一年受胎的指定配種：父馬取自配種紀錄，出生紀錄記預計產出，處置為保留；事件 foal-added', async () => {
    const db = await foalingHerd()
    const result = await addFoal(
      db,
      GAME,
      {
        ...filly('SUB21'),
        ability: {
          speed: 72,
          stamina: 45,
          subAbilities: {
            power: 'A',
            burst: 'B',
            guts: 'C',
            flexibility: 'D',
            spirit: 'E',
            wisdom: 'F',
            health: 'G',
          },
          subTotal: 42,
          turf: '◎',
          dirt: '△',
          distance: ' 1700～3100m ',
          offspringQuality: 12,
        },
        femaleLine: ' ハナ系 ',
        note: ' 馬體良好 ',
      },
      { now },
    )
    if (result.status !== 'done') throw new Error(result.status)
    const foal = result.value
    expect(result.warnings).toEqual([])
    expect(foal).toStrictEqual({
      id: foal.id,
      gameId: GAME,
      birthYear: 1990,
      sex: 'female',
      sireId: 'S11',
      damId: 'SUB21',
      birth: { breedingId: 'B89', placement: { line: 1, generation: 2 } },
      ability: {
        speed: 72,
        stamina: 45,
        subAbilities: {
          power: 'A',
          burst: 'B',
          guts: 'C',
          flexibility: 'D',
          spirit: 'E',
          wisdom: 'F',
          health: 'G',
        },
        subTotal: 42,
        turf: '◎',
        dirt: '△',
        distance: '1700～3100m',
        offspringQuality: 12,
      },
      femaleLine: 'ハナ系',
      disposition: 'keep',
      note: '馬體良好',
    })
    expect(await db.horses.get(foal.id)).toStrictEqual(foal)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-27T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'foal-added',
        horseId: foal.id,
        breedingId: 'B89',
        disposition: 'keep',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-27T01:02:03.000Z')
  })

  it('連結前一年受胎的自由配種：沒有系與代數，處置為待售；父馬照配種紀錄的外部名稱（9.5）', async () => {
    const db = await foalingHerd()
    const result = await addFoal(db, GAME, { ...filly('D11'), sireSystem: 'ノーザンダンサー系' })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toStrictEqual({
      id: result.value.id,
      gameId: GAME,
      birthYear: 1990,
      sex: 'female',
      sireName: 'ノーザンダンサー',
      damId: 'D11',
      sireSystem: 'ノーザンダンサー',
      pedigreeSource: 'manual',
      birth: { breedingId: 'F89' },
      disposition: 'for-sale',
    })
  })

  it('父母名與父系的來源依事件的來源：匯入時為經匯入確認', async () => {
    const db = await foalingHerd()
    const result = await addFoal(db, GAME, filly('D11'), {
      source: { kind: 'import', importType: 'april-foals' },
    })
    expect(result.status === 'done' && result.value.pedigreeSource).toBe('import')
  })

  it('傳了父馬而和連結的配種紀錄不同時阻止；相同時可以', async () => {
    const db = await foalingHerd()
    expect(await addFoal(db, GAME, { ...filly('SUB21'), sire: { horseId: 'Z1' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-mismatch', breedingId: 'B89' }],
    })
    expect(await addFoal(db, GAME, { ...filly('D11'), sire: { name: 'トサミドリ' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-mismatch', breedingId: 'F89' }],
    })
    const same = await addFoal(db, GAME, {
      ...filly('D11'),
      sire: { name: '(外)ノーザンダンサー' },
    })
    expect(same.status).toBe('done')
    const byId = await addFoal(db, GAME, { ...filly('SUB21'), sire: { horseId: 'S11' } })
    expect(byId.status).toBe('done')
  })

  it('沒有前一年的配種紀錄時也警告並確認，確認後比照自由配種；父馬可以不知道', async () => {
    const db = await foalingHerd()
    await db.horses.add(horseRow('M', { sex: 'female' }))
    await db.mares.add(substituteMareRow('M', 2, 1))
    expect(await addFoal(db, GAME, filly('M'))).toEqual({
      status: 'unconfirmed',
      warnings: [{ kind: 'no-conception-record' }],
    })
    expect(await db.horses.count()).toBe(7)
    const result = await addFoal(db, GAME, filly('M'), { confirmed: true })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toStrictEqual({
      id: result.value.id,
      gameId: GAME,
      birthYear: 1990,
      sex: 'female',
      damId: 'M',
      birth: {},
      disposition: 'for-sale',
    })
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'foal-added',
      disposition: 'for-sale',
      confirmedWarnings: [{ kind: 'no-conception-record' }],
    })
    expect((await db.events.toArray())[0]).not.toHaveProperty('breedingId')
  })

  it('出生年、能力番号與能力值不合法時阻止，阻止原因一次列全', async () => {
    const db = await foalingHerd()
    await db.horses.update('Z1', { abilityNumber: '0x0010', birthYear: 1990 })
    expect(
      await addFoal(db, GAME, {
        damId: 'SUB21',
        sex: 'male',
        birthYear: 1991,
        abilityNumber: 'x',
        ability: {
          speed: -1,
          stamina: 1.5,
          subAbilities: { power: 'X' as 'A' },
          subTotal: 106,
          turf: '◎◎' as '◎',
          dirt: 'x' as '×',
          offspringQuality: 16,
        },
        sire: { name: '(外)' },
      }),
    ).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'birth-year' },
        { kind: 'ability-number' },
        { kind: 'ability', field: 'speed' },
        { kind: 'ability', field: 'stamina' },
        { kind: 'ability', field: 'subAbilities' },
        { kind: 'ability', field: 'subTotal' },
        { kind: 'ability', field: 'turf' },
        { kind: 'ability', field: 'dirt' },
        { kind: 'ability', field: 'offspringQuality' },
        { kind: 'sire-name' },
      ],
    })
    expect(await addFoal(db, GAME, { ...filly('SUB21'), abilityNumber: ' 0x10 ' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'same-horse', horseId: 'Z1' }],
    })
    const numbered = await addFoal(db, GAME, { ...filly('SUB21'), abilityNumber: ' 0x20 ' })
    expect(numbered.status === 'done' && numbered.value.abilityNumber).toBe('0x0020')
  })

  it('能力都沒有填時不存 ability；邊界值可以保存', async () => {
    const db = await foalingHerd()
    const empty = await addFoal(db, GAME, { ...filly('SUB21'), ability: { distance: '  ' } })
    expect(empty.status === 'done' && empty.value).not.toHaveProperty('ability')
    const edge = await addFoal(db, GAME, {
      ...filly('D11'),
      ability: { speed: 0, subTotal: 105, offspringQuality: 15 },
    })
    expect(edge.status === 'done' && edge.value.ability).toStrictEqual({
      speed: 0,
      subTotal: 105,
      offspringQuality: 15,
    })
  })

  it('母馬找不到或屬於其他局，或父馬是找不到的馬匹或牝馬時丟出錯誤', async () => {
    const db = await foalingHerd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.add(horseRow('M2', { gameId: 'G2', sex: 'female' }))
    await db.mares.add(substituteMareRow('M2', 2, 1, { gameId: 'G2' }))
    await expect(addFoal(db, GAME, filly('X'))).rejects.toThrow('找不到母馬：X')
    await expect(addFoal(db, GAME, filly('M2'))).rejects.toThrow('找不到母馬：M2')
    await expect(
      addFoal(db, GAME, { ...filly('SUB21'), sire: { horseId: 'D11' } }),
    ).rejects.toThrow('牝馬不能當種牡馬：D11')
  })
})

/** 在 foalingHerd 建立一匹 1990 年出生的牝駒：SUB21 的產駒為八系指定配種所生，D11 的為自由配種所生 */
async function foalOf(
  db: Awaited<ReturnType<typeof foalingHerd>>,
  damId: string,
): Promise<HorseRow> {
  const result = await addFoal(db, GAME, filly(damId))
  if (result.status !== 'done') throw new Error(result.status)
  return result.value
}

describe('nameFoal', () => {
  it('填入、更正與清空正式馬名：基本馬名跟著完整馬名，來源為手動；其他欄位不變，事件記原名與新名（BRD-08）', async () => {
    const db = await foalingHerd()
    const foal = await foalOf(db, 'SUB21')
    const named = await nameFoal(db, GAME, foal.id, ' (外)ハイセイコー ', { now })
    if (named.status !== 'done') throw new Error(named.status)
    expect(named.value).toStrictEqual({
      ...foal,
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
      nameSource: 'manual',
    })
    expect(await db.horses.get(foal.id)).toStrictEqual(named.value)

    const corrected = await nameFoal(db, GAME, foal.id, 'ハイセイコー')
    expect(corrected.status === 'done' && corrected.value.baseName).toBe('ハイセイコー')
    const cleared = await nameFoal(db, GAME, foal.id, null)
    expect(cleared).toEqual({ status: 'done', value: foal, warnings: [] })
    expect(await db.horses.get(foal.id)).toStrictEqual(foal)

    const events = (await db.events.toArray()).filter((event) => event.kind === 'foal-named')
    expect(events).toHaveLength(3)
    expect(events).toContainEqual({
      id: expect.any(String),
      gameId: GAME,
      year: 1990,
      recordedAt: '2026-09-27T01:02:03.000Z',
      source: { kind: 'manual' },
      kind: 'foal-named',
      horseId: foal.id,
      to: '(外)ハイセイコー',
    })
    expect(events).toContainEqual(
      expect.objectContaining({ from: '(外)ハイセイコー', to: 'ハイセイコー' }),
    )
    const clearing = events.find(
      (event) => event.kind === 'foal-named' && event.from === 'ハイセイコー',
    )
    expect(clearing).not.toHaveProperty('to')
  })

  it('只有前綴、和目前相同，或原本沒有馬名時清空，都阻止', async () => {
    const db = await foalingHerd()
    const foal = await foalOf(db, 'SUB21')
    expect(await nameFoal(db, GAME, foal.id, '[地]')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'horse-name' }],
    })
    expect(await nameFoal(db, GAME, foal.id, '  ')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    await nameFoal(db, GAME, foal.id, 'ハイセイコー')
    expect(await nameFoal(db, GAME, foal.id, ' ハイセイコー ')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
  })

  it('馬名經匯入確認後不能手動修改或清空（9.4）', async () => {
    const db = await foalingHerd()
    const foal = await foalOf(db, 'SUB21')
    await db.horses.update(foal.id, {
      fullName: 'ハイセイコー',
      baseName: 'ハイセイコー',
      nameSource: 'import',
    })
    for (const fullName of ['ハイセイコ', null]) {
      expect(await nameFoal(db, GAME, foal.id, fullName)).toEqual({
        status: 'blocked',
        blocks: [{ kind: 'name-confirmed' }],
      })
    }
  })

  it('馬匹找不到、屬於其他局或不是自家產駒時丟出錯誤', async () => {
    const db = await foalingHerd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.add(horseRow('F2', { gameId: 'G2', birth: {} }))
    await expect(nameFoal(db, GAME, 'X', 'A')).rejects.toThrow('找不到馬匹：X')
    await expect(nameFoal(db, GAME, 'F2', 'A')).rejects.toThrow('找不到馬匹：F2')
    await expect(nameFoal(db, GAME, 'SUB21', 'A')).rejects.toThrow('不是自家產駒：SUB21')
  })
})

describe('setFoalDisposition', () => {
  it('保留、待售、已售出可以互改；事件記原處置與新處置', async () => {
    const db = await foalingHerd()
    const foal = await foalOf(db, 'SUB21')
    const sold = await setFoalDisposition(db, GAME, foal.id, 'sold', { now })
    expect(sold).toEqual({ status: 'done', value: { ...foal, disposition: 'sold' }, warnings: [] })
    expect((await db.horses.get(foal.id))?.disposition).toBe('sold')
    const kept = await setFoalDisposition(db, GAME, foal.id, 'keep')
    expect(kept.status === 'done' && kept.value.disposition).toBe('keep')
    expect(
      (await db.events.toArray()).filter((event) => event.kind === 'foal-disposition-changed'),
    ).toContainEqual({
      id: expect.any(String),
      gameId: GAME,
      year: 1990,
      recordedAt: '2026-09-27T01:02:03.000Z',
      source: { kind: 'manual' },
      kind: 'foal-disposition-changed',
      horseId: foal.id,
      from: 'keep',
      to: 'sold',
    })
  })

  it('出生紀錄沒有系與代數的產駒不能改為保留；和目前相同時阻止', async () => {
    const db = await foalingHerd()
    const free = await foalOf(db, 'D11')
    expect(await setFoalDisposition(db, GAME, free.id, 'keep')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'free-foal' }],
    })
    expect(await setFoalDisposition(db, GAME, free.id, 'for-sale')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    const sold = await setFoalDisposition(db, GAME, free.id, 'sold')
    expect(sold.status === 'done' && sold.value.disposition).toBe('sold')
  })

  it('馬匹不是自家產駒、處置不是三種之一，或自家產駒缺少處置時丟出錯誤', async () => {
    const db = await foalingHerd()
    const foal = await foalOf(db, 'SUB21')
    await expect(setFoalDisposition(db, GAME, 'SUB21', 'sold')).rejects.toThrow(
      '不是自家產駒：SUB21',
    )
    await expect(setFoalDisposition(db, GAME, foal.id, 'gone' as 'sold')).rejects.toThrow(
      '牧場處置不符：gone',
    )
    await db.horses.update(foal.id, { disposition: undefined })
    await expect(setFoalDisposition(db, GAME, foal.id, 'sold')).rejects.toThrow(
      `自家產駒缺少牧場處置：${foal.id}`,
    )
  })
})
