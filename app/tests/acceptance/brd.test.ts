import { describe, expect, it } from 'vitest'
import { checkSubAbilityTotal, foalDisplayName, trackingName } from '../../src/core/foal'
import { matchHorse } from '../../src/core/identity'
import { verifySuccessor } from '../../src/core/successor'
import { expectedFoaling, registerBreeding, setConception } from '../../src/storage/breeding-writes'
import { addFoal, nameFoal, relinkFoal, setFoalDisposition } from '../../src/storage/foal-writes'
import { buildSuccessorCandidate } from '../../src/storage/inputs'
import { loadSuccessorCandidate } from '../../src/storage/loaders'
import { rateMating } from '../../src/storage/rating-writes'
import { buildPhaseHerd, designatedTo, foalingHerd } from '../support/breeding'
import { GAME, horseRow, restorationRow, stallionRow } from '../support/rows'

// 需求規格第 15 章「配種與產駒（BRD）」中由 core 與儲存層負責的部分；匯入與畫面由後續計畫補上

describe('配種與產駒（BRD）', () => {
  it('BRD-07 1990 年出生未命名的產駒 → 顯示 オオトリモナーコス1990', () => {
    expect(trackingName('オオトリモナーコス', 1990)).toBe('オオトリモナーコス1990')
    expect(foalDisplayName(undefined, 'オオトリモナーコス', 1990)).toBe('オオトリモナーコス1990')
  })

  it('BRD-08 補登正式馬名 → 主要顯示正式馬名；清空後回退追蹤名', () => {
    expect(foalDisplayName('ハイセイコー', 'ハイユウ', 1970)).toBe('ハイセイコー')
    expect(foalDisplayName('', 'ハイユウ', 1970)).toBe('ハイユウ1970')
  })

  it('BRD-09 一月總表唯一配對的名稱 → 取代手動名稱，不列為衝突', () => {
    // 手動補登的正式馬名尚未經匯入確認；總表以能力番号＋出生年配到同一匹產駒
    const foal = {
      id: 'F1',
      abilityNumber: '0x2000',
      birthYear: 1968,
      name: 'ハイセイコ',
      manualName: true,
    }
    expect(
      matchHorse({ abilityNumber: '0x2000', birthYear: 1968, name: 'ハイセイコー' }, [foal]),
    ).toEqual({ kind: 'same', id: 'F1' })
  })

  it('BRD-11 輸入七項副能力 → 自動算出 0～105 的 サ；匯入值不符 → 警告', () => {
    const abilities = {
      power: 'A',
      burst: 'A',
      guts: 'A',
      flexibility: 'A',
      spirit: 'A',
      wisdom: 'A',
      health: 'A',
    } as const
    expect(checkSubAbilityTotal(abilities, 84)).toEqual({ total: 84, mismatch: false })
    expect(checkSubAbilityTotal(abilities, 80)).toEqual({ total: 84, mismatch: true })
  })

  it('BRD-15 自由配種產駒 → 不能選為八系後繼', () => {
    expect(
      verifySuccessor(
        { sireId: 'X', damId: 'D35', origin: { kind: 'free' } },
        { line: 1, generation: 6 },
      ),
    ).toEqual([{ mismatch: 'free-breeding' }])
  })

  it('BRD-22 零代市場種牡馬 × 替代母馬的指定配種 → 警告並確認，原因預填登記時的、可修改；登記時沒有原因 → 配種時要填', async () => {
    const db = await buildPhaseHerd()
    // 第 2 系零代 × 替代第 1 系 1 代：登記母馬時已填原因「自家母駒不足」
    const warning = { kind: 'exception-entry', line: 2, generation: 2 }
    expect(await registerBreeding(db, GAME, 'SUB11', designatedTo(2, 2, 'Z2'))).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    const kept = await registerBreeding(db, GAME, 'SUB11', designatedTo(2, 2, 'Z2'), {
      confirmed: true,
    })
    expect(kept.status === 'done' && kept.value.breeding.exceptionReason).toBe('自家母駒不足')

    // 之後才宣告第 1 系 1 代補公系：替代第 2 系 1 代的母馬登記時不是例外補入，沒有原因
    await db.stallions.update('S11', { status: 'retired' })
    await db.restorations.add(restorationRow('R1', 1, 1, 'sire'))
    await db.horses.add(horseRow('ZR', { sex: 'male' }))
    await db.stallions.add(stallionRow('ZR', 1, 0, { restorationId: 'R1' }))
    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'ZR'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    const filled = await registerBreeding(
      db,
      GAME,
      'SUB21',
      designatedTo(1, 2, 'ZR', '第 1 系 1 代沒有種牡馬'),
      { confirmed: true },
    )
    expect(filled.status === 'done' && filled.value.breeding.exceptionReason).toBe(
      '第 1 系 1 代沒有種牡馬',
    )
  })

  it('BRD-01 遊戲年 Y 受胎 → 預定 Y+1 年 4 月 1 週出生；登記受胎不建立產駒', async () => {
    const db = await buildPhaseHerd()
    const registered = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'))
    if (registered.status !== 'done') throw new Error(registered.status)
    const result = await setConception(db, GAME, registered.value.breeding.id, '受胎')
    if (result.status !== 'done') throw new Error(result.status)
    expect(expectedFoaling(result.value)).toEqual({ year: 1991, timing: { month: 4, week: 1 } })
    expect(await db.horses.where('[gameId+damId]').equals([GAME, 'SUB21']).count()).toBe(0)
  })

  it('BRD-02 四種受胎狀態 → 分別保存，空胎與不受胎不合併，未確認不是缺值', async () => {
    const db = await buildPhaseHerd()
    const registered = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'))
    if (registered.status !== 'done') throw new Error(registered.status)
    const { id } = registered.value.breeding
    for (const conception of ['空胎', '不受胎', '未確認', '受胎'] as const) {
      await setConception(db, GAME, id, conception)
      expect((await db.breedings.get(id))?.conception).toBe(conception)
    }
  })

  it('BRD-06 同一母馬同一出生年新增第二匹產駒 → 阻止並指出既有產駒', async () => {
    const db = await foalingHerd()
    const first = await addFoal(db, GAME, { damId: 'SUB21', sex: 'female', birthYear: 1990 })
    if (first.status !== 'done') throw new Error(first.status)
    expect(await addFoal(db, GAME, { damId: 'SUB21', sex: 'male', birthYear: 1990 })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'foal-exists', horseId: first.value.id }],
    })
    // 同一匹母馬其他年份的產駒不受影響
    await db.games.update(GAME, { currentYear: 1991 })
    const next = await addFoal(
      db,
      GAME,
      { damId: 'SUB21', sex: 'male', birthYear: 1991 },
      {
        confirmed: true,
      },
    )
    expect(next.status).toBe('done')
  })

  it('BRD-11 七項副能力算出的 サ 與匯入值不符 → 警告並確認，兩個值都看得到', async () => {
    const db = await foalingHerd()
    const ability = {
      subAbilities: {
        power: 'A',
        burst: 'A',
        guts: 'A',
        flexibility: 'A',
        spirit: 'A',
        wisdom: 'A',
        health: 'A',
      },
      subTotal: 80,
    } as const
    const input = { damId: 'SUB21', sex: 'female', birthYear: 1990, ability } as const
    const warning = { kind: 'sub-ability-total', total: 84, imported: 80 }
    expect(await addFoal(db, GAME, input)).toEqual({ status: 'unconfirmed', warnings: [warning] })
    const result = await addFoal(db, GAME, input, { confirmed: true })
    expect(result.status === 'done' && result.value.ability?.subTotal).toBe(80)
  })

  it('BRD-13、BRD-14 芝與ダート分開保存；距離適性保存範圍文字', async () => {
    const db = await foalingHerd()
    const result = await addFoal(db, GAME, {
      damId: 'SUB21',
      sex: 'male',
      birthYear: 1990,
      ability: { turf: '○', dirt: '◎', distance: '1700～3100m' },
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.ability).toStrictEqual({ turf: '○', dirt: '◎', distance: '1700～3100m' })
  })

  it('BRD-24 手動建立產駒，母馬前一年沒有受胎紀錄 → 警告並確認；確認後比照自由配種產駒，待售、不能選為八系後繼', async () => {
    const db = await foalingHerd()
    const input = {
      damId: 'SUB11',
      sex: 'female',
      birthYear: 1990,
      sire: { horseId: 'S11' },
    } as const
    // SUB11 在 1989 年的配種紀錄 N89：受胎以外的狀態都警告，附那一筆的識別與狀態
    for (const conception of ['空胎', '未確認', '不受胎'] as const) {
      await db.breedings.update('N89', { conception })
      expect(await addFoal(db, GAME, input)).toEqual({
        status: 'unconfirmed',
        warnings: [{ kind: 'no-conception-record', breedingId: 'N89', conception }],
      })
    }
    const result = await addFoal(db, GAME, input, { confirmed: true })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toMatchObject({ sireId: 'S11', disposition: 'for-sale' })
    expect(result.value.birth).toStrictEqual({})
    // 從建立的產駒組出後繼候選：出生紀錄沒有連結配種，比照自由配種所生
    expect(
      verifySuccessor(buildSuccessorCandidate(result.value, undefined), {
        line: 1,
        generation: 2,
      }),
    ).toEqual([{ mismatch: 'free-breeding' }])
  })

  it('BRD-08 補登正式馬名 → 主要顯示正式馬名，識別、母馬、出生年、能力不變；清空後回退追蹤名', async () => {
    const db = await foalingHerd()
    const added = await addFoal(db, GAME, {
      damId: 'D11',
      sex: 'male',
      birthYear: 1990,
      ability: { speed: 72 },
    })
    if (added.status !== 'done') throw new Error(added.status)
    const foal = added.value
    const named = await nameFoal(db, GAME, foal.id, 'ハイセイコー')
    if (named.status !== 'done') throw new Error(named.status)
    expect(named.value).toMatchObject({
      id: foal.id,
      damId: 'D11',
      birthYear: 1990,
      ability: { speed: 72 },
    })
    expect(foalDisplayName(named.value.fullName, 'ハナカゴ', 1990)).toBe('ハイセイコー')
    const cleared = await nameFoal(db, GAME, foal.id, null)
    if (cleared.status !== 'done') throw new Error(cleared.status)
    expect(foalDisplayName(cleared.value.fullName, 'ハナカゴ', 1990)).toBe('ハナカゴ1990')
  })

  it('BRD-10 已售出產駒補名 → 售出狀態不變', async () => {
    const db = await foalingHerd()
    const added = await addFoal(db, GAME, { damId: 'SUB21', sex: 'male', birthYear: 1990 })
    if (added.status !== 'done') throw new Error(added.status)
    await setFoalDisposition(db, GAME, added.value.id, 'sold')
    const named = await nameFoal(db, GAME, added.value.id, 'ハイセイコー')
    expect(named.status === 'done' && named.value.disposition).toBe('sold')
  })

  it('BRD-15、BRD-26 八系指定配種所生預設保留；自由配種所生待售，不能改為保留', async () => {
    const db = await foalingHerd()
    const designated = await addFoal(db, GAME, { damId: 'SUB21', sex: 'male', birthYear: 1990 })
    expect(designated.status === 'done' && designated.value.disposition).toBe('keep')
    const free = await addFoal(db, GAME, { damId: 'D11', sex: 'male', birthYear: 1990 })
    if (free.status !== 'done') throw new Error(free.status)
    expect(free.value.disposition).toBe('for-sale')
    expect(await setFoalDisposition(db, GAME, free.value.id, 'keep')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'free-foal' }],
    })
  })

  it('BRD-16 自由配種產駒售出後 → 仍可從母馬查到父母、出生年、追蹤名與正式馬名', async () => {
    const db = await foalingHerd()
    const free = await addFoal(db, GAME, { damId: 'D11', sex: 'female', birthYear: 1990 })
    if (free.status !== 'done') throw new Error(free.status)
    await nameFoal(db, GAME, free.value.id, 'ダンサーズイメージ')
    await setFoalDisposition(db, GAME, free.value.id, 'sold')
    const foals = await db.horses.where('[gameId+damId]').equals([GAME, 'D11']).toArray()
    expect(foals).toHaveLength(1)
    expect(foals[0]).toMatchObject({
      sireName: 'ノーザンダンサー',
      damId: 'D11',
      birthYear: 1990,
      fullName: 'ダンサーズイメージ',
      disposition: 'sold',
    })
    expect(trackingName('ハナカゴ', foals[0].birthYear ?? 0)).toBe('ハナカゴ1990')
  })

  it('BRD-17 總合評價與爆發力 → 可隨時新增或編輯；同年直接更新，跨年舊值可查', async () => {
    const db = await buildPhaseHerd()
    await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'B', burst: 8 })
    await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'A', burst: 10 })
    await db.games.update(GAME, { currentYear: 1991 })
    await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'S', burst: 15 })
    const rows = await db.matingRatings.where('[gameId+mareId]').equals([GAME, 'D11']).toArray()
    expect(rows.map(({ year, grade, burst }) => ({ year, grade, burst }))).toEqual(
      expect.arrayContaining([
        { year: 1990, grade: 'A', burst: 10 },
        { year: 1991, grade: 'S', burst: 15 },
      ]),
    )
    expect(rows).toHaveLength(2)
  })

  it('BRD-18 總合評價選項 → S、A、B、C、D', async () => {
    const db = await buildPhaseHerd()
    for (const grade of ['S', 'A', 'B', 'C', 'D'] as const) {
      const result = await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade })
      expect(result.status === 'done' && result.value.grade).toBe(grade)
    }
    await expect(
      rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, grade: 'E' as 'S' }),
    ).rejects.toThrow('總合評價不符：E')
  })

  it('BRD-23 爆發力輸入 0 以上的整數以外的值 → 不能保存', async () => {
    const db = await buildPhaseHerd()
    for (const burst of [-1, 2.5]) {
      expect(await rateMating(db, GAME, 'D11', { sire: { horseId: 'S11' }, burst })).toEqual({
        status: 'blocked',
        blocks: [{ kind: 'burst' }],
      })
    }
    expect(await db.matingRatings.count()).toBe(0)
  })

  it('BRD-27 產駒建立時母馬前一年還不是受胎，之後改成受胎 → 重新連結後取得系與代數、待售改為保留，可以成為後繼；父馬不同 → 阻止', async () => {
    const db = await foalingHerd()
    await setConception(db, GAME, 'B89', '未確認')
    const added = await addFoal(
      db,
      GAME,
      { damId: 'SUB21', sex: 'male', birthYear: 1990 },
      { confirmed: true },
    )
    if (added.status !== 'done') throw new Error(added.status)
    expect((await setConception(db, GAME, 'B89', '受胎')).status).toBe('done')
    const linked = await relinkFoal(db, GAME, added.value.id)
    if (linked.status !== 'done') throw new Error(linked.status)
    expect(linked.value).toMatchObject({
      sireId: 'S11',
      birth: { breedingId: 'B89', placement: { line: 1, generation: 2 } },
      disposition: 'keep',
    })
    const candidate = await loadSuccessorCandidate(db, GAME, added.value.id)
    expect(verifySuccessor(candidate, { line: 1, generation: 2 })).toEqual([])

    // SUB11 的產駒記了別的父馬，前一年的紀錄改成受胎後也不能連結
    const other = await addFoal(
      db,
      GAME,
      { damId: 'SUB11', sex: 'female', birthYear: 1990, sire: { name: 'トサミドリ' } },
      { confirmed: true },
    )
    if (other.status !== 'done') throw new Error(other.status)
    await setConception(db, GAME, 'N89', '受胎')
    expect(await relinkFoal(db, GAME, other.value.id)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-mismatch', breedingId: 'N89' }],
    })
  })
})
