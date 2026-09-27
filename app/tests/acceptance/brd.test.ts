import { describe, expect, it } from 'vitest'
import { checkSubAbilityTotal, foalDisplayName, trackingName } from '../../src/core/foal'
import { matchHorse } from '../../src/core/identity'
import { verifySuccessor } from '../../src/core/successor'
import { expectedFoaling, registerBreeding, setConception } from '../../src/storage/breeding-writes'
import { buildPhaseHerd, designatedTo } from '../support/breeding'
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
})
