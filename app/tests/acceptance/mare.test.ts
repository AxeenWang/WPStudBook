import { describe, expect, it } from 'vitest'
import type { LinePosition } from '../../src/core/lines'
import {
  DEFAULT_MARE_AGE_SETTINGS,
  defaultAbsenceReason,
  mareAgeNotices,
  mareListedInTasks,
  suggestSellingMother,
} from '../../src/core/mares'
import {
  chooseKeptSister,
  entrySisterStatus,
  sisterStatusListed,
  type OwnMare,
  type SisterStatusChange,
} from '../../src/core/sisters'
import { updateSettings } from '../../src/storage/games'
import { correctDeparture, returnMare, sellMare } from '../../src/storage/herd-writes'
import { loadRuleSnapshot } from '../../src/storage/loaders'
import { addMarketMare, changeMareUsage } from '../../src/storage/mare-writes'
import type { BreedingRow, MareRow } from '../../src/storage/records'
import { addTestGame, testDatabase } from '../support/database'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  stallionRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../support/rows'

// 需求規格第 15 章「繁殖牝馬（MARE）」中由 core 與儲存層彙整負責的部分；卡片、匯入、事件與畫面由後續計畫補上

/** 父 S、母 D 的女兒 */
const daughter = (id: string, inHerd: boolean, status: OwnMare['status']): OwnMare => ({
  id,
  sireId: 'S',
  damId: 'D',
  inHerd,
  status,
})

/** 套用接替狀態的變更 */
const apply = (mares: readonly OwnMare[], changes: readonly SisterStatusChange[]): OwnMare[] =>
  mares.map((mare) => {
    const change = changes.find((entry) => entry.id === mare.id)
    return change ? { ...mare, status: change.to } : mare
  })

describe('繁殖牝馬（MARE）', () => {
  it('MARE-12 同父同母姊妹先後轉入 → 第二匹不被阻止；比較後只能有一匹正式保留，被取代者保留紀錄', () => {
    const elder = daughter('A', true, entrySisterStatus({ id: 'A', sireId: 'S', damId: 'D' }, []))
    const younger = daughter(
      'B',
      true,
      entrySisterStatus({ id: 'B', sireId: 'S', damId: 'D' }, [elder]),
    )
    expect([elder.status, younger.status]).toEqual(['provisional', 'candidate'])

    const decided = apply([elder, younger], chooseKeptSister('B', [elder, younger]))
    expect(decided.filter((mare) => mare.status === 'kept').map((mare) => mare.id)).toEqual(['B'])
    expect(decided.find((mare) => mare.id === 'A')).toMatchObject({ status: 'replaced' })
  })

  it('MARE-24 姊妹一匹暫定保留、一匹候選 → 兩匹都列入任務；其中一匹被取代後只剩另一匹', () => {
    const sisters = [daughter('A', true, 'provisional'), daughter('B', true, 'candidate')]
    expect(
      sisters.filter((mare) => sisterStatusListed(mare.status)).map((mare) => mare.id),
    ).toEqual(['A', 'B'])
    const decided = apply(sisters, chooseKeptSister('A', sisters))
    expect(
      decided.filter((mare) => sisterStatusListed(mare.status)).map((mare) => mare.id),
    ).toEqual(['A'])
  })

  it('MARE-30 妹妹已售出後買回被取代的姊姊 → 姊姊回歸為暫定保留，可改選正式保留；妹妹仍在圈時姊姊為候選', () => {
    const elder = { id: 'A', sireId: 'S', damId: 'D' }
    expect(entrySisterStatus(elder, [daughter('B', false, 'sold')])).toBe('provisional')
    expect(entrySisterStatus(elder, [daughter('B', true, 'kept')])).toBe('candidate')

    const returned = [daughter('A', true, 'candidate'), daughter('B', true, 'kept')]
    expect(chooseKeptSister('A', returned)).toEqual([
      { id: 'A', from: 'candidate', to: 'kept' },
      { id: 'B', from: 'kept', to: 'replaced' },
    ])
  })

  it('MARE-09 上年在圈、五月缺席 → 上次馬齡達定年預設「定年引退」，否則「售出」', () => {
    expect(defaultAbsenceReason(25, DEFAULT_MARE_AGE_SETTINGS)).toBe('retired')
    expect(defaultAbsenceReason(20, DEFAULT_MARE_AGE_SETTINGS)).toBe('sold')
  })

  it('MARE-10 修改定年設定 → 依新設定判斷', () => {
    const settings = { ...DEFAULT_MARE_AGE_SETTINGS, retirementAge: 23 }
    expect(defaultAbsenceReason(23, DEFAULT_MARE_AGE_SETTINGS)).toBe('sold')
    expect(defaultAbsenceReason(23, settings)).toBe('retired')
  })

  it('MARE-11 定年 25 歲時 → 24 歲顯示最後配種年齡提醒，25 歲顯示已達定年且不列入任務', () => {
    expect(mareAgeNotices(24, DEFAULT_MARE_AGE_SETTINGS)).toContain('last-breeding')
    expect(mareListedInTasks({ inHerd: true, age: 24 }, DEFAULT_MARE_AGE_SETTINGS)).toBe(true)
    expect(mareAgeNotices(25, DEFAULT_MARE_AGE_SETTINGS)).toEqual(['retirement-age'])
    expect(mareListedInTasks({ inHerd: true, age: 25 }, DEFAULT_MARE_AGE_SETTINGS)).toBe(false)
  })

  it('MARE-23 女兒暫定保留轉入後，母親當年四月已生產 → 顯示可出售母親提示', () => {
    expect(suggestSellingMother(['provisional'], true)).toBe(true)
    expect(suggestSellingMother(['provisional'], false)).toBe(false)
  })

  it('MARE-25 母馬達高齡提醒年齡（預設 18 歲）→ 提示可考慮出售，不影響列入任務；修改設定後依新年齡判斷', () => {
    expect(mareAgeNotices(18, DEFAULT_MARE_AGE_SETTINGS)).toEqual(['senior'])
    expect(mareListedInTasks({ inHerd: true, age: 18 }, DEFAULT_MARE_AGE_SETTINGS)).toBe(true)
    expect(mareAgeNotices(18, { ...DEFAULT_MARE_AGE_SETTINGS, seniorAge: 20 })).toEqual([])
  })
})

describe('繁殖牝馬（MARE）：儲存層彙整', () => {
  /** 寫入母馬與她們的馬匹資料（1990 年 5 歲），回傳第 line 系的母馬群快照 */
  async function mareGroupsAfter(mares: MareRow[], line: LinePosition) {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd(mares.map((mare) => horseRow(mare.horseId, { birthYear: 1985 })))
    await db.mares.bulkAdd(mares)
    const groups = async () =>
      (await loadRuleSnapshot(db, GAME)).eightLines.lines[line - 1]!.mareGroups
    return { db, groups }
  }

  it('MARE-02 第 3 系 3 代母馬群 → 只算該系該代的自家母馬與替代母馬', async () => {
    const { groups } = await mareGroupsAfter(
      [
        ownMareRow('A', 3, 3),
        substituteMareRow('B', 3, 3),
        ownMareRow('C', 3, 2),
        substituteMareRow('D', 2, 3),
        ungroupedMareRow('E', 'unassigned'),
      ],
      3,
    )
    expect((await groups()).find((group) => group.generation === 3)).toEqual({
      generation: 3,
      established: true,
      activeMares: 2,
      ownMares: 1,
    })
  })

  it('MARE-04 某代唯一的母馬離圈 → 該代仍為已成立', async () => {
    const { db, groups } = await mareGroupsAfter([ownMareRow('A', 3, 3)], 3)
    expect(await groups()).toEqual([
      { generation: 3, established: true, activeMares: 1, ownMares: 1 },
    ])
    await db.mares.update('A', { herd: 'sold', sisterStatus: 'sold' })
    expect(await groups()).toEqual([
      { generation: 3, established: true, activeMares: 0, ownMares: 0 },
    ])
  })

  it('MARE-24 姊妹一匹暫定保留、一匹候選 → 兩匹都列入任務；其中一匹被取代後只剩另一匹', async () => {
    const { db, groups } = await mareGroupsAfter(
      [
        ownMareRow('A', 1, 2),
        ownMareRow('B', 1, 2, { sisterStatus: 'candidate', establishedGeneration: false }),
      ],
      1,
    )
    expect((await groups())[0]!.activeMares).toBe(2)
    await db.mares.update('B', { sisterStatus: 'replaced' })
    expect((await groups())[0]!.activeMares).toBe(1)
  })

  it('MARE-10 修改定年設定 → 之後的規則輸入快照依新設定判斷是否列入任務', async () => {
    const { db, groups } = await mareGroupsAfter([ownMareRow('A', 1, 2)], 1)
    await db.horses.update('A', { birthYear: 1966 })
    expect((await groups())[0]!.activeMares).toBe(1)
    expect((await updateSettings(db, GAME, { retirementAge: 24 })).status).toBe('done')
    expect((await groups())[0]!.activeMares).toBe(0)
  })
})

describe('繁殖牝馬（MARE）：儲存層寫入', () => {
  it('MARE-05 在「第 6 系 6 代種牡馬 × 第 3 系 6 代母馬」任務的種牡馬底下新增市場母馬 → 記為替代第 3 系 6 代、來源市場，只出現在第 3 系 6 代母馬群，不宣告屬於第 3 系', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.bulkAdd([lineRow(3, '系3子'), lineRow(6, '系6子')])
    await db.stallions.add(stallionRow('S66', 6, 6))
    await db.horses.add(horseRow('F', { birthYear: 1985 }))
    await db.mares.add(ownMareRow('F', 3, 6))
    const result = await addMarketMare(db, GAME, {
      horse: { fullName: '補血の母', sireSystem: 'ハイペリオン' },
      assignment: { kind: 'pairing', line: 6, generation: 7 },
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.mare).toMatchObject({
      usage: 'substitute',
      groupLine: 3,
      groupGeneration: 6,
      source: { kind: 'market-supplement' },
    })
    expect(result.value.horse.sireSystem).toBe('ハイペリオン')
    const { eightLines } = await loadRuleSnapshot(db, GAME)
    expect(eightLines.lines[2]!.mareGroups).toEqual([
      { generation: 6, established: true, activeMares: 2, ownMares: 1 },
    ])
    expect(eightLines.lines[5]!.mareGroups).toEqual([])
  })

  it('MARE-26 從「待指定用途」清單新增母馬 → 標示待指定用途，指定前不進入任務', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.stallions.add(stallionRow('Z1', 1, 0))
    const before = (await loadRuleSnapshot(db, GAME)).eightLines
    const result = await addMarketMare(db, GAME, {
      horse: { fullName: '混血用の母' },
      assignment: { kind: 'unassigned' },
      sourceKind: 'market-crossbreed',
    })
    expect(result.status === 'done' && result.value.mare.usage).toBe('unassigned')
    expect((await loadRuleSnapshot(db, GAME)).eightLines).toEqual(before)
  })

  it('MARE-29 手動新增的母馬馬名與已售出的母馬相同 → 提示是否為買回，確認前不建立新馬', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.add(
      horseRow('OLD', { fullName: 'ハナカゴ', baseName: 'ハナカゴ', nameSource: 'import' }),
    )
    await db.mares.add(ungroupedMareRow('OLD', 'unassigned', { herd: 'sold' }))
    expect(
      await addMarketMare(db, GAME, {
        horse: { fullName: 'ハナカゴ' },
        assignment: { kind: 'unassigned' },
      }),
    ).toEqual({
      status: 'unconfirmed',
      warnings: [{ kind: 'possible-buyback', horseIds: ['OLD'] }],
    })
    expect(await db.horses.count()).toBe(1)
  })

  it('MARE-31 在零代市場種牡馬的配對底下新增母馬 → 標示「例外補入」，需確認並填寫原因；建系起點新增起點母馬不需確認', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.stallions.add(stallionRow('Z1', 1, 0))
    const start = await addMarketMare(db, GAME, {
      horse: { fullName: '起點の母' },
      assignment: { kind: 'pairing', line: 1, generation: 1 },
    })
    expect(start.status === 'done' && start.value.mare).toMatchObject({
      usage: 'start',
      groupLine: 1,
      groupGeneration: 0,
    })

    await db.stallions.add(stallionRow('S11', 1, 1))
    const found = {
      horse: { fullName: '補入の母' },
      assignment: { kind: 'pairing' as const, line: 2 as const, generation: 2 },
    }
    expect(await addMarketMare(db, GAME, found)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    const withReason = { ...found, exceptionReason: '自家母駒不足' }
    expect(await addMarketMare(db, GAME, withReason)).toEqual({
      status: 'unconfirmed',
      warnings: [{ kind: 'exception-entry', line: 2, generation: 2 }],
    })
    const confirmed = await addMarketMare(db, GAME, withReason, { confirmed: true })
    expect(confirmed.status === 'done' && confirmed.value.mare.exceptionReason).toBe('自家母駒不足')
  })

  it('MARE-28 已有八系指定配種紀錄的市場母馬修改用途 → 舊紀錄保留規則快照，新用途從下一次配種生效；自家母駒不能修改系與代數', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('S11', 1, 1)])
    await db.horses.bulkAdd([horseRow('M'), horseRow('F')])
    await db.mares.bulkAdd([substituteMareRow('M', 2, 1), ownMareRow('F', 1, 1)])
    const breeding: BreedingRow = {
      id: 'B1',
      gameId: GAME,
      mareId: 'M',
      year: 1989,
      kind: 'designated',
      sireId: 'S11',
      rule: {
        distance: 1,
        sire: { line: 1, generation: 1 },
        dam: { kind: 'substitute', forLine: 2, forGeneration: 1 },
        output: { line: 1, generation: 2 },
      },
    }
    await db.breedings.add(breeding)

    const result = await changeMareUsage(db, GAME, 'M', { assignment: { kind: 'unassigned' } })
    expect(result.status === 'done' && result.value.mare.usage).toBe('unassigned')
    expect(await db.breedings.get('B1')).toEqual(breeding)
    await expect(
      changeMareUsage(db, GAME, 'F', { assignment: { kind: 'unassigned' } }),
    ).rejects.toThrow('不能修改用途')
  })

  it('MARE-08 賣出母馬 → 離開母馬群（不再列入任務），紀錄可查', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.horses.add(horseRow('K', { birthYear: 1985 }))
    await db.mares.add(ownMareRow('K', 1, 2))
    expect((await sellMare(db, GAME, 'K')).status).toBe('done')
    const { eightLines } = await loadRuleSnapshot(db, GAME)
    expect(eightLines.lines[0]!.mareGroups).toEqual([
      { generation: 2, established: true, activeMares: 0, ownMares: 0 },
    ])
    expect(await db.mares.get('K')).toMatchObject({ herd: 'sold' })
    expect(await db.events.where('[gameId+horseId]').equals([GAME, 'K']).toArray()).toEqual([
      expect.objectContaining({ kind: 'mare-departed', reason: 'sold' }),
    ])
  })

  it('MARE-32 誤按賣出後撤銷 → 回到生產中與原本的接替狀態（例：正式保留），不建立回歸事件；圈內已有另一匹正式保留的姊妹時改為候選', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([
      horseRow('A', { sireId: 'S', damId: 'D' }),
      horseRow('B', { sireId: 'S', damId: 'D' }),
    ])
    await db.mares.bulkAdd([
      ownMareRow('A', 1, 2, { sisterStatus: 'kept' }),
      ownMareRow('B', 1, 2, { sisterStatus: 'replaced' }),
    ])
    expect((await sellMare(db, GAME, 'A')).status).toBe('done')
    expect((await correctDeparture(db, GAME, 'A', 'in-herd')).status).toBe('done')
    expect(await db.mares.get('A')).toMatchObject({ herd: 'in-herd', sisterStatus: 'kept' })
    expect((await db.events.toArray()).map((event) => event.kind).sort()).toEqual([
      'mare-departed',
      'mare-departure-corrected',
    ])

    expect((await sellMare(db, GAME, 'A')).status).toBe('done')
    await db.mares.update('B', { sisterStatus: 'kept' })
    const revoked = await correctDeparture(db, GAME, 'A', 'in-herd')
    expect(revoked.status === 'done' && revoked.value.sisterStatus).toBe('candidate')
  })

  it('MARE-29 手動新增時確認是買回 → 沿用原識別並建立回歸事件，不建立新馬', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.stallions.add(stallionRow('Z1', 1, 0))
    await db.horses.add(
      horseRow('OLD', { fullName: 'ハナカゴ', baseName: 'ハナカゴ', nameSource: 'import' }),
    )
    await db.mares.add(ungroupedMareRow('OLD', 'unassigned', { herd: 'sold' }))
    const assignment = { kind: 'pairing' as const, line: 1 as const, generation: 1 }
    const added = await addMarketMare(db, GAME, { horse: { fullName: 'ハナカゴ' }, assignment })
    expect(added).toEqual({
      status: 'unconfirmed',
      warnings: [{ kind: 'possible-buyback', horseIds: ['OLD'] }],
    })

    const returned = await returnMare(db, GAME, 'OLD', { assignment, location: 32 })
    expect(returned.status === 'done' && returned.value.mare).toMatchObject({
      horseId: 'OLD',
      herd: 'in-herd',
      usage: 'start',
      location: 32,
    })
    expect(await db.horses.count()).toBe(1)
    expect((await db.events.toArray()).map((event) => event.kind)).toEqual(['mare-returned'])
  })

  it('MARE-30 妹妹已售出後買回被取代的姊姊 → 姊姊回歸為暫定保留；妹妹仍在圈時姊姊為候選', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([
      horseRow('ELDER', { sireId: 'S', damId: 'D' }),
      horseRow('YOUNGER', { sireId: 'S', damId: 'D' }),
    ])
    await db.mares.bulkAdd([
      ownMareRow('ELDER', 1, 3, { sisterStatus: 'replaced', herd: 'sold' }),
      ownMareRow('YOUNGER', 1, 3, { sisterStatus: 'kept' }),
    ])
    const candidate = await returnMare(db, GAME, 'ELDER')
    expect(candidate.status === 'done' && candidate.value.mare.sisterStatus).toBe('candidate')

    await db.mares.update('ELDER', { herd: 'sold', sisterStatus: 'replaced' })
    expect((await sellMare(db, GAME, 'YOUNGER')).status).toBe('done')
    const provisional = await returnMare(db, GAME, 'ELDER')
    expect(provisional.status === 'done' && provisional.value.mare.sisterStatus).toBe('provisional')
  })
})
