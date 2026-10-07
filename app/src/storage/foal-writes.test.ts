import { describe, expect, it } from 'vitest'
import { foalingHerd } from '../../tests/support/breeding'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow, substituteMareRow } from '../../tests/support/rows'
import type { FoalNameItem } from '../core/imports'
import { loadGame } from './games'
import { addFoal, importFoalName, nameFoal, relinkFoal, setFoalDisposition } from './foal-writes'
import { transferFilly } from './own-mare-writes'
import type { Conception, HorseRow } from './records'

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
      source: { kind: 'import', importType: 'april-foals', importId: 'I1' },
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
    if (same.status !== 'done') throw new Error(same.status)
    // 和其他阻止原因一起時一次列全，sire-mismatch 排在最後
    expect(
      await addFoal(db, GAME, {
        ...filly('D11'),
        ability: { speed: -1 },
        sire: { name: 'トサミドリ' },
      }),
    ).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'foal-exists', horseId: same.value.id },
        { kind: 'ability', field: 'speed' },
        { kind: 'sire-mismatch', breedingId: 'F89' },
      ],
    })
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
    if (empty.status !== 'done') throw new Error(empty.status)
    expect(empty.value).not.toHaveProperty('ability')
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

describe('relinkFoal', () => {
  /**
   * 產駒牧場（foalingHerd）裡，母馬 damId 1989 年的配種紀錄 breedingId 還不是受胎時確認建立的 1990 年產駒，
   * 之後紀錄改成受胎；回傳資料庫與產駒識別
   */
  async function unlinkedFoal(
    damId: string,
    breedingId: string,
    fields: Partial<Parameters<typeof addFoal>[2]> = {},
  ) {
    const db = await foalingHerd()
    await db.breedings.update(breedingId, { conception: '未確認' })
    const added = await addFoal(
      db,
      GAME,
      { damId, sex: 'female', birthYear: 1990, ...fields },
      { confirmed: true },
    )
    if (added.status !== 'done') throw new Error(added.status)
    await db.breedings.update(breedingId, { conception: '受胎' })
    await db.events.clear()
    return { db, foalId: added.value.id }
  }

  it('連到八系指定配種：出生紀錄記配種紀錄與預計產出，父馬取自紀錄，待售改為保留；事件 foal-linked', async () => {
    const { db, foalId } = await unlinkedFoal('SUB21', 'B89')
    expect(await db.horses.get(foalId)).toMatchObject({ birth: {}, disposition: 'for-sale' })
    const result = await relinkFoal(db, GAME, foalId, { now })
    const foal: HorseRow = {
      id: foalId,
      gameId: GAME,
      birthYear: 1990,
      sex: 'female',
      sireId: 'S11',
      damId: 'SUB21',
      birth: { breedingId: 'B89', placement: { line: 1, generation: 2 } },
      disposition: 'keep',
    }
    expect(result).toStrictEqual({ status: 'done', value: foal, warnings: [] })
    expect(await db.horses.get(foalId)).toStrictEqual(foal)
    expect(await db.events.toArray()).toStrictEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-27T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'foal-linked',
        horseId: foalId,
        breedingId: 'B89',
        disposition: { from: 'for-sale', to: 'keep' },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-27T01:02:03.000Z')
  })

  it('連到自由配種：沒有系與代數，處置不變；補上外部父馬名時來源依事件的來源', async () => {
    const manual = await unlinkedFoal('D11', 'F89')
    const result = await relinkFoal(manual.db, GAME, manual.foalId)
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toStrictEqual({
      id: manual.foalId,
      gameId: GAME,
      birthYear: 1990,
      sex: 'female',
      sireName: 'ノーザンダンサー',
      damId: 'D11',
      pedigreeSource: 'manual',
      birth: { breedingId: 'F89' },
      disposition: 'for-sale',
    })
    const [event] = await manual.db.events.toArray()
    expect(event).not.toHaveProperty('disposition')

    const imported = await unlinkedFoal('D11', 'F89')
    const linked = await relinkFoal(imported.db, GAME, imported.foalId, {
      source: { kind: 'import', importType: 'april-foals', importId: 'I1' },
    })
    if (linked.status !== 'done') throw new Error(linked.status)
    expect(linked.value.pedigreeSource).toBe('import')
  })

  it('產駒已記的父馬和紀錄相同時照常連結，父母名的來源不變；已售出的處置不變', async () => {
    const { db, foalId } = await unlinkedFoal('D11', 'F89', {
      sire: { name: 'ノーザンダンサー' },
      sireSystem: 'ノーザンダンサー',
    })
    const result = await relinkFoal(db, GAME, foalId, {
      source: { kind: 'import', importType: 'april-foals', importId: 'I1' },
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toMatchObject({ sireName: 'ノーザンダンサー', pedigreeSource: 'manual' })

    const sold = await unlinkedFoal('SUB21', 'B89')
    await sold.db.horses.update(sold.foalId, { disposition: 'sold' })
    const kept = await relinkFoal(sold.db, GAME, sold.foalId)
    if (kept.status !== 'done') throw new Error(kept.status)
    expect(kept.value).toMatchObject({
      disposition: 'sold',
      birth: { breedingId: 'B89', placement: { line: 1, generation: 2 } },
    })
    const [event] = await sold.db.events.toArray()
    expect(event).not.toHaveProperty('disposition')
  })

  it('前一年的紀錄不是受胎或沒有紀錄時阻止並附那一筆與狀態；產駒已記的父馬不同時阻止，什麼都不寫', async () => {
    const { db, foalId } = await unlinkedFoal('SUB21', 'B89', { sire: { horseId: 'Z1' } })
    expect(await relinkFoal(db, GAME, foalId)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-mismatch', breedingId: 'B89' }],
    })
    for (const conception of ['空胎', '不受胎', '未確認'] as Conception[]) {
      await db.breedings.update('B89', { conception })
      expect(await relinkFoal(db, GAME, foalId)).toEqual({
        status: 'blocked',
        blocks: [{ kind: 'no-conception-record', breedingId: 'B89', conception }],
      })
    }
    await db.breedings.update('B89', { conception: undefined })
    expect(await relinkFoal(db, GAME, foalId)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'no-conception-record', breedingId: 'B89' }],
    })
    await db.breedings.delete('B89')
    expect(await relinkFoal(db, GAME, foalId)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'no-conception-record' }],
    })
    expect(await db.horses.get(foalId)).toMatchObject({ birth: {}, disposition: 'for-sale' })
    expect(await db.events.count()).toBe(0)
  })

  it('已轉入繁殖圈的牝駒連到八系指定配種時阻止；連到自由配種可以，用途仍是自由配種所生', async () => {
    const designated = await unlinkedFoal('SUB21', 'B89')
    expect((await transferFilly(designated.db, GAME, designated.foalId)).status).toBe('done')
    expect(await relinkFoal(designated.db, GAME, designated.foalId)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'mare-entered' }],
    })

    const free = await unlinkedFoal('D11', 'F89')
    expect((await transferFilly(free.db, GAME, free.foalId)).status).toBe('done')
    expect((await relinkFoal(free.db, GAME, free.foalId)).status).toBe('done')
    expect(await free.db.mares.get(free.foalId)).toMatchObject({ usage: 'free' })
  })

  it('馬匹找不到、屬於其他局、不是自家產駒或已經連結配種紀錄時丟出錯誤；缺少母馬或出生年時丟出 RangeError', async () => {
    const { db, foalId } = await unlinkedFoal('SUB21', 'B89')
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('OTHER', { gameId: 'G2', birth: {} }),
      horseRow('NODAM', { birthYear: 1990, birth: {} }),
    ])
    await expect(relinkFoal(db, GAME, 'X')).rejects.toThrow('找不到馬匹：X')
    await expect(relinkFoal(db, GAME, 'OTHER')).rejects.toThrow('找不到馬匹：OTHER')
    await expect(relinkFoal(db, GAME, 'Z1')).rejects.toThrow('不是自家產駒：Z1')
    await expect(relinkFoal(db, GAME, 'NODAM')).rejects.toThrow(RangeError)
    expect((await relinkFoal(db, GAME, foalId)).status).toBe('done')
    await expect(relinkFoal(db, GAME, foalId)).rejects.toThrow(`產駒已經連結配種紀錄：${foalId}`)
  })
})

describe('importFoalName', () => {
  const source = {
    kind: 'import',
    importType: 'january-two-year-olds',
    importId: 'I1',
  } as const
  const timing = { month: 1, week: 1 }
  const options = { now, source, timing }

  /** 1990 年的局與 1988 年生、已售出的自家產駒 F1（父母名經匯入確認）；其他欄位依需要覆寫 */
  async function foalGame(fields: Partial<HorseRow> = {}) {
    const db = testDatabase()
    await addTestGame(db)
    const foal = horseRow('F1', {
      birthYear: 1988,
      sex: 'male',
      sireName: 'チチ',
      damName: 'ハハ',
      pedigreeSource: 'import',
      birth: {},
      disposition: 'sold',
      ...fields,
    })
    await db.horses.add(foal)
    return { db, foal }
  }

  /** 總表的一列：(外)ハイセイコー，能力番号 0x0A1F，競走馬馬番号 0x1B2C */
  function item(fields: Partial<FoalNameItem> = {}): FoalNameItem {
    return {
      kind: 'foal-name',
      horseId: 'F1',
      birthYear: 1988,
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
      abilityNumber: '0x0A1F',
      horseNumber: '0x1B2C',
      ...fields,
    }
  }

  it('手動名被總表取代：馬名改用總表、來源為匯入，手動名加到別名的最後；補上能力番号並記競走馬馬番号；其他欄位不變（BRD-09、JAN-05、IMP-10）', async () => {
    const { db, foal } = await foalGame({
      fullName: 'ハイセイコ',
      baseName: 'ハイセイコ',
      nameSource: 'manual',
      aliases: ['ハイセ'],
    })
    const result = await importFoalName(db, GAME, item(), options)
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toStrictEqual({
      ...foal,
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
      nameSource: 'import',
      aliases: ['ハイセ', 'ハイセイコ'],
      abilityNumber: '0x0A1F',
    })
    expect(await db.horses.get('F1')).toStrictEqual(result.value)
    expect(await db.horseNumbers.toArray()).toStrictEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        horseId: 'F1',
        stage: 'racehorse',
        number: '0x1B2C',
        year: 1990,
        source,
        timing,
      },
    ])
    expect(await db.events.toArray()).toStrictEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: now.toISOString(),
        source,
        timing,
        kind: 'foal-name-imported',
        horseId: 'F1',
        from: 'ハイセイコ',
        to: '(外)ハイセイコー',
        abilityNumber: '0x0A1F',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe(now.toISOString())
  })

  it('原本沒有馬名：填入，不留別名，事件沒有 from；手動名和總表相同：只改來源、不留別名，事件的 from 與 to 相同', async () => {
    const { db, foal } = await foalGame()
    const named = await importFoalName(db, GAME, item(), options)
    if (named.status !== 'done') throw new Error(named.status)
    expect(named.value).toStrictEqual({
      ...foal,
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
      nameSource: 'import',
      abilityNumber: '0x0A1F',
    })
    const [filled] = await db.events.toArray()
    expect(filled).toMatchObject({ to: '(外)ハイセイコー', abilityNumber: '0x0A1F' })
    expect(filled).not.toHaveProperty('from')

    const same = await foalGame({
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
      nameSource: 'manual',
      abilityNumber: '0x0A1F',
    })
    const confirmed = await importFoalName(same.db, GAME, item(), options)
    if (confirmed.status !== 'done') throw new Error(confirmed.status)
    expect(confirmed.value).toStrictEqual({ ...same.foal, nameSource: 'import' })
    const [event] = await same.db.events.toArray()
    expect(event).toMatchObject({ from: '(外)ハイセイコー', to: '(外)ハイセイコー' })
    expect(event).not.toHaveProperty('abilityNumber')
  })

  it('資料更正：經匯入確認的馬名改用新名，不留別名，事件記原名與新名；新的競走馬馬番号另記一筆，舊的留著（JAN-12）', async () => {
    const { db, foal } = await foalGame({
      fullName: 'ハイセイコ',
      baseName: 'ハイセイコ',
      nameSource: 'import',
      abilityNumber: '0x0A1F',
    })
    await db.horseNumbers.add({
      id: 'N0',
      gameId: GAME,
      horseId: 'F1',
      stage: 'racehorse',
      number: '0x1B2B',
      year: 1990,
      source: { kind: 'import', importType: 'january-two-year-olds', importId: 'I0' },
    })
    expect(await importFoalName(db, GAME, item(), options)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'name-confirmed' }],
    })
    const result = await importFoalName(db, GAME, item(), { ...options, correction: true })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toStrictEqual({
      ...foal,
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
    })
    const numbers = (await db.horseNumbers.toArray()).map((row) => row.number)
    expect(numbers.sort()).toEqual(['0x1B2B', '0x1B2C'])
    const [event] = await db.events.toArray()
    expect(event).toMatchObject({ from: 'ハイセイコ', to: '(外)ハイセイコー' })
    expect(event).not.toHaveProperty('abilityNumber')
  })

  it('出生年不同、已有不同的能力番号、另一匹馬已有相同的能力番号與出生年時阻止，原因一次列全；什麼都不寫', async () => {
    const { db, foal } = await foalGame({ abilityNumber: '0x0001' })
    await db.horses.add(horseRow('X1', { abilityNumber: '0x0A1F', birthYear: 1989 }))
    expect(await importFoalName(db, GAME, item({ birthYear: 1989 }), options)).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'birth-year' },
        { kind: 'ability-number' },
        { kind: 'same-horse', horseId: 'X1' },
      ],
    })
    expect(await db.horses.get('F1')).toStrictEqual(foal)
    expect(await db.horseNumbers.count()).toBe(0)
    expect(await db.events.count()).toBe(0)

    const other = await foalGame()
    await other.db.horses.add(horseRow('X2', { abilityNumber: '0x0A1F', birthYear: 1988 }))
    expect(await importFoalName(other.db, GAME, item(), options)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'same-horse', horseId: 'X2' }],
    })
  })

  it('只有前綴或基本馬名空白時阻止；經匯入確認的馬名不同（基本馬名不同也算）而不是資料更正時阻止', async () => {
    const { db } = await foalGame()
    const horseName = { status: 'blocked', blocks: [{ kind: 'horse-name' }] }
    expect(await importFoalName(db, GAME, item({ fullName: '(外)' }), options)).toEqual(horseName)
    expect(await importFoalName(db, GAME, item({ baseName: ' ' }), options)).toEqual(horseName)
    const named = await foalGame({
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
      nameSource: 'import',
      abilityNumber: '0x0A1F',
    })
    expect(await importFoalName(named.db, GAME, item({ baseName: 'ハイセイコ' }), options)).toEqual(
      { status: 'blocked', blocks: [{ kind: 'name-confirmed' }] },
    )
    expect(await named.db.events.count()).toBe(0)
  })

  it('只差競走馬馬番号：記一筆馬番号，不寫事件，馬匹不變；什麼都不用改時阻止，什麼都不寫', async () => {
    const { db, foal } = await foalGame({
      fullName: '(外)ハイセイコー',
      baseName: 'ハイセイコー',
      nameSource: 'import',
      abilityNumber: '0x0A1F',
    })
    expect(await importFoalName(db, GAME, item(), options)).toEqual({
      status: 'done',
      value: foal,
      warnings: [],
    })
    expect(await db.horseNumbers.count()).toBe(1)
    expect(await db.events.count()).toBe(0)
    const later = new Date('2026-09-28T00:00:00.000Z')
    expect(await importFoalName(db, GAME, item(), { ...options, now: later })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await db.horseNumbers.count()).toBe(1)
    expect((await loadGame(db, GAME)).updatedAt).toBe(now.toISOString())
  })

  it('馬匹找不到、屬於其他局或不是自家產駒時丟出錯誤', async () => {
    const { db } = await foalGame()
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([horseRow('F2', { gameId: 'G2', birth: {} }), horseRow('X1')])
    const missing = importFoalName(db, GAME, item({ horseId: 'X' }), options)
    await expect(missing).rejects.toThrow('找不到馬匹：X')
    const otherGame = importFoalName(db, GAME, item({ horseId: 'F2' }), options)
    await expect(otherGame).rejects.toThrow('找不到馬匹：F2')
    const market = importFoalName(db, GAME, item({ horseId: 'X1' }), options)
    await expect(market).rejects.toThrow('不是自家產駒：X1')
  })
})
