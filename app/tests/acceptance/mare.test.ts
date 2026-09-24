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
import { loadRuleSnapshot } from '../../src/storage/loaders'
import type { MareRow } from '../../src/storage/records'
import { addTestGame, testDatabase } from '../support/database'
import { GAME, horseRow, ownMareRow, substituteMareRow, ungroupedMareRow } from '../support/rows'

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
})
