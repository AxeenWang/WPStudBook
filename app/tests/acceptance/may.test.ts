import { describe, expect, it } from 'vitest'
import { buildImportPlan } from '../../src/ce-import/flow'
import { mayContent } from '../../src/ce-import/may'
import { parseImportFile } from '../../src/ce-import/parse'
import type { WPStudBookDatabase } from '../../src/storage/database'
import { sellMare } from '../../src/storage/herd-writes'
import { applyImport } from '../../src/storage/imports'
import { addMarketMare } from '../../src/storage/mare-writes'
import { transferFilly } from '../../src/storage/own-mare-writes'
import type { HorseRow, MareRow } from '../../src/storage/records'
import { SAMPLES, exportText } from '../support/ce-files'
import { addTestGame, testDatabase } from '../support/database'
import { applyMayFile, mayRow, previewMayFile } from '../support/import-flow'
import { GAME, horseRow, lineRow, stallionRow, ungroupedMareRow } from '../support/rows'
import { successorHerd } from '../support/successor'

// 需求規格第 15 章「五月繁殖牝馬（MAY）」：解析的部分（CE 匯入子計畫 4-1），以及對帳、預覽與套用（4-4）；
// 年度資料與血統的補齊（MAY-04、05、07、08）由 4-5 補上，實檔的預覽在 tests/local/ce-samples.test.ts

describe('五月繁殖牝馬（MAY）：解析', () => {
  it('MAY-01 繋養牧場番号不在 32～35 或缺少 → 整份停止並提示範圍異常', () => {
    const text = exportText('broodmare', [
      SAMPLES.broodmare,
      { ...SAMPLES.broodmare, 48: '31', 57: '0x0b02' },
      { ...SAMPLES.broodmare, 48: '', 57: '0x0b03' },
    ])
    expect(parseImportFile(text, 'may-herd', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'scope', line: 3, header: '牧場', value: '31' },
        { reason: 'scope', line: 4, header: '牧場', value: '' },
      ],
    })
  })
})

/** 1990 年的測試局（目前遊戲年 1990）加上這些馬與母馬 */
async function herdGame(
  horses: readonly HorseRow[],
  mares: readonly MareRow[],
): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.horses.bulkAdd([...horses])
  await db.mares.bulkAdd([...mares])
  return db
}

/** 馬名經匯入確認的牝馬：馬名、能力番号與出生年 */
function mareHorse(id: string, name: string, abilityNumber: string, birthYear: number): HorseRow {
  return horseRow(id, {
    fullName: name,
    baseName: name,
    nameSource: 'import',
    abilityNumber,
    birthYear,
    sex: 'female',
  })
}

/**
 * 第 1 系已開啟（マンノウォー，親系統 マッチェム），零代與 1 代種牡馬在崗：
 * 產出第 1 系 2 代的配對在任務看板上，母馬替代第 2 系 1 代
 */
async function lineOneGame(): Promise<WPStudBookDatabase> {
  const db = await herdGame([], [])
  await db.lines.add(lineRow(1, 'マンノウォー'))
  await db.systems.add({ gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' })
  await db.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('S11', 1, 1)])
  return db
}

/** 產出第 1 系 2 代的配對 */
const PAIRING = { kind: 'pairing', line: 1, generation: 2 } as const

/**
 * 後繼牧場（successorHerd）加上能力番号，與 1992 年五月名單的列：D24、D24B 繼續在圈；
 * F88、F90（同父同母）是第 1 系 4 代 S14 的指定配種所生的牝駒，FREE90 是自由配種所生
 */
async function successorMay() {
  const db = await successorHerd()
  const horses: [string, string, number][] = [
    ['D24', '0x0D24', 1980],
    ['D24B', '0x0D2B', 1981],
    ['F88', '0x0F88', 1988],
    ['F90', '0x0F90', 1990],
    ['FREE90', '0x0F9F', 1990],
  ]
  for (const [id, abilityNumber] of horses) await db.horses.update(id, { abilityNumber })
  const rows = horses.map(([id, abilityNumber, birthYear]) =>
    mayRow({
      fullName: `ウマ${id}`,
      age: 1992 - birthYear,
      ...(id === 'FREE90' ? { sire: 'ノーザンダンサー' } : {}),
      abilityNumber,
      horseNumber: `0x1${abilityNumber.slice(3)}`,
    }),
  )
  return { db, rows }
}

describe('五月繁殖牝馬（MAY）：對帳與套用', () => {
  it('MAY-02 預覽 → 顯示繼續在圈、新進、回歸、定年引退、售出、轉場、未配對、衝突筆數與據點分布', async () => {
    const db = await herdGame(
      [
        mareHorse('C', 'シー', '0x0101', 1980),
        mareHorse('T', 'ティー', '0x0102', 1980),
        mareHorse('R', 'アール', '0x0103', 1980),
        mareHorse('A25', 'エーニジュウゴ', '0x0104', 1964),
        mareHorse('A20', 'エーニジュウ', '0x0105', 1970),
        mareHorse('X', 'エックス', '0x0106', 1980),
        horseRow('U', {
          fullName: 'ミカク',
          baseName: 'ミカク',
          nameSource: 'manual',
          sex: 'female',
        }),
      ],
      [
        ungroupedMareRow('C', 'unassigned', { location: 32 }),
        ungroupedMareRow('T', 'unassigned', { location: 32 }),
        ungroupedMareRow('R', 'unassigned', { herd: 'sold' }),
        ungroupedMareRow('A25', 'unassigned'),
        ungroupedMareRow('A20', 'unassigned'),
        ungroupedMareRow('X', 'unassigned'),
        ungroupedMareRow('U', 'unassigned'),
      ],
    )
    const rows = [
      mayRow({ fullName: 'シー', age: 10, abilityNumber: '0x0101', horseNumber: '0x1101' }),
      mayRow({
        fullName: 'ティー',
        age: 10,
        farm: '33',
        abilityNumber: '0x0102',
        horseNumber: '0x1102',
      }),
      mayRow({
        fullName: 'アール',
        age: 10,
        farm: '34',
        abilityNumber: '0x0103',
        horseNumber: '0x1103',
      }),
      mayRow({
        fullName: 'ニュー',
        age: 5,
        farm: '35',
        abilityNumber: '0x0201',
        horseNumber: '0x1201',
      }),
      // 經匯入確認的馬名不同：衝突
      mayRow({ fullName: 'エックスツー', age: 10, abilityNumber: '0x0106', horseNumber: '0x1106' }),
    ]
    const { preview } = await previewMayFile(db, rows)
    expect(preview.year).toBe(1990)
    expect(preview.total).toBe(5)
    expect(preview.herd).toStrictEqual({
      continuing: 2,
      newArrivals: 1,
      returned: 1,
      retired: 1,
      sold: 1,
      moved: 1,
      unmatched: 1,
      conflicts: 1,
      bases: { 32: 2, 33: 1, 34: 1, 35: 1 },
    })
  })

  it('MAY-03 配對不到既有產駒的新進母馬 → 生產中、「待指定用途」，指定前不進入任務；馬名、能力番号、出生年與血統照名單、經匯入確認', async () => {
    const db = await herdGame([], [])
    const row = mayRow({
      fullName: '(外)ニュー',
      age: 5,
      sire: '(外)ソト',
      sireSystem: 'エクリプス系',
      dam: 'ハハ',
      abilityNumber: '0x0201',
      horseNumber: '0x1201',
    })
    await applyMayFile(db, [row])
    const [horse] = await db.horses.toArray()
    expect(horse).toStrictEqual({
      id: expect.any(String),
      gameId: GAME,
      fullName: '(外)ニュー',
      baseName: 'ニュー',
      nameSource: 'import',
      abilityNumber: '0x0201',
      birthYear: 1985,
      sex: 'female',
      sireName: 'ソト',
      damName: 'ハハ',
      sireSystem: 'エクリプス',
      pedigreeSource: 'import',
      femaleLine: 'テストヒンケイ',
    })
    // 待指定用途不屬於任何母馬群，指定前不進入任務
    expect(await db.mares.get(horse.id)).toStrictEqual({
      horseId: horse.id,
      gameId: GAME,
      usage: 'unassigned',
      herd: 'in-herd',
      establishedGeneration: false,
      source: { kind: 'other' },
      location: 32,
    })
  })

  it('MAY-06 同一母馬跨年出現相同繁殖牝馬馬番号 → 不重複增加歷程', async () => {
    const db = await herdGame(
      [mareHorse('C', 'シー', '0x0101', 1980)],
      [ungroupedMareRow('C', 'unassigned', { location: 32 })],
    )
    const row = (age: number) =>
      mayRow({ fullName: 'シー', age, abilityNumber: '0x0101', horseNumber: '0x1101' })
    await applyMayFile(db, [row(10)])
    const { preview } = await applyMayFile(db, [row(11)], { year: 1991 })
    expect(preview.counts).toMatchObject({ applicable: 0, skipped: 1 })
    const numbers = await db.horseNumbers.where('[gameId+horseId]').equals([GAME, 'C']).toArray()
    expect(numbers.map((row) => [row.stage, row.number, row.year])).toStrictEqual([
      ['broodmare', '0x1101', 1990],
    ])
  })

  it('MAY-09 第 1 系 4 代種牡馬所生母駒第一次出現 → 自動加入第 1 系 5 代母馬群；無姊妹在圈 → 暫定保留並使該代成立；有姊妹 → 候選', async () => {
    const { db, rows } = await successorMay()
    await applyMayFile(db, rows, { year: 1992 })
    const own = {
      usage: 'own',
      groupLine: 1,
      groupGeneration: 5,
      herd: 'in-herd',
      source: { kind: 'retired-racehorse' },
      location: 32,
    }
    expect(await db.mares.get('F88')).toMatchObject({
      ...own,
      sisterStatus: 'provisional',
      establishedGeneration: true,
    })
    expect(await db.mares.get('F90')).toMatchObject({
      ...own,
      sisterStatus: 'candidate',
      establishedGeneration: false,
    })
  })

  it('MAY-09 同父同母的姊姊這次缺席、妹妹第一次出現 → 缺席先離圈，妹妹判定時姊姊已不在圈，為暫定保留', async () => {
    const { db, rows } = await successorMay()
    expect((await transferFilly(db, GAME, 'F88', { location: 32 })).status).toBe('done')
    await applyMayFile(
      db,
      rows.filter((row) => row[57] !== '0x0F88'),
      { year: 1992 },
    )
    expect(await db.mares.get('F88')).toMatchObject({ herd: 'sold', sisterStatus: 'provisional' })
    expect(await db.mares.get('F90')).toMatchObject({
      herd: 'in-herd',
      sisterStatus: 'provisional',
      establishedGeneration: true,
    })
  })

  it('MAY-10 自由配種所生母駒出現 → 生產中、用途為自由配種所生（不可成為後繼），不入八系母馬群', async () => {
    const { db, rows } = await successorMay()
    await applyMayFile(db, rows, { year: 1992 })
    expect(await db.mares.get('FREE90')).toStrictEqual({
      horseId: 'FREE90',
      gameId: GAME,
      usage: 'free',
      herd: 'in-herd',
      establishedGeneration: false,
      source: { kind: 'retired-racehorse' },
      location: 32,
    })
  })

  it('MAY-11 預覽 → 列出今年新進與回歸的市場母馬（含五月前以手動登記者）及目前用途，套用前可改掛到另一條配對', async () => {
    const db = await lineOneGame()
    const added = await addMarketMare(db, GAME, {
      horse: { fullName: 'イー', abilityNumber: '0x0301', birthYear: 1985 },
      assignment: { kind: 'unassigned' },
    })
    if (added.status !== 'done') throw new Error(added.status)
    const early = added.value.horse.id
    await db.horses.add(mareHorse('R', 'アール', '0x0302', 1984))
    await db.mares.add(ungroupedMareRow('R', 'unassigned', { herd: 'sold' }))
    const rows = [
      mayRow({ fullName: 'イー', age: 5, abilityNumber: '0x0301', horseNumber: '0x1301' }),
      mayRow({ fullName: 'アール', age: 6, abilityNumber: '0x0302', horseNumber: '0x1302' }),
      mayRow({ fullName: 'ニュー', age: 4, abilityNumber: '0x0303', horseNumber: '0x1303' }),
    ]
    const { preview } = await previewMayFile(db, rows)
    const unassigned = { usage: 'unassigned' }
    expect(preview.usages).toStrictEqual([
      { key: early, current: unassigned },
      { key: 'R', current: unassigned },
      { key: 4, current: unassigned },
    ])
    const usages = new Map(preview.usages.map((entry) => [entry.key, { assignment: PAIRING }]))
    await applyMayFile(db, rows, { decisions: { usages } })
    const substitute = { usage: 'substitute', groupLine: 2, groupGeneration: 1, herd: 'in-herd' }
    expect(await db.mares.get(early)).toMatchObject(substitute)
    expect(await db.mares.get('R')).toMatchObject(substitute)
    const created = await db.horses.where('[gameId+baseName]').equals([GAME, 'ニュー']).first()
    expect(await db.mares.get(created?.id ?? '')).toMatchObject({
      ...substitute,
      source: { kind: 'market-founding' },
    })
  })

  it('MAY-11 改掛到替代配對而親系統撞到其他系（8.3）→ 套用時回傳 item-unconfirmed，什麼都不寫；使用者確認後重新預覽與套用，確認存在事件上', async () => {
    const db = await lineOneGame()
    const rows = [
      mayRow({
        fullName: 'ニュー',
        age: 4,
        sireSystem: 'マンノウォー系',
        abilityNumber: '0x0303',
        horseNumber: '0x1303',
      }),
    ]
    const usages = new Map([[2, { assignment: PAIRING }]])
    const { judgment, mode, preview } = await previewMayFile(db, rows, { decisions: { usages } })
    const result = await applyImport(db, buildImportPlan(judgment, { mode }, mayContent(preview)))
    expect(result).toMatchObject({
      status: 'blocked',
      blocks: [
        {
          kind: 'item-unconfirmed',
          index: 0,
          warnings: [{ kind: 'substitute-parent-system', line: 2, generation: 1 }],
        },
      ],
    })
    expect(await db.mares.count()).toBe(0)
    expect(await db.imports.count()).toBe(0)

    const confirmed = new Map([[2, { assignment: PAIRING, confirmed: true as const }]])
    await applyMayFile(db, rows, { decisions: { usages: confirmed } })
    expect(await db.events.toArray()).toStrictEqual([
      expect.objectContaining({
        kind: 'mare-added',
        confirmedWarnings: [expect.objectContaining({ kind: 'substitute-parent-system' })],
      }),
    ])
  })

  it('MAY-12 缺席的母馬已在管理器登記賣出 → 照紀錄，不重複建立事件', async () => {
    const db = await herdGame(
      [mareHorse('S', 'エス', '0x0401', 1980), mareHorse('C', 'シー', '0x0101', 1980)],
      [ungroupedMareRow('S', 'unassigned'), ungroupedMareRow('C', 'unassigned')],
    )
    expect((await sellMare(db, GAME, 'S')).status).toBe('done')
    const rows = [
      mayRow({ fullName: 'シー', age: 10, abilityNumber: '0x0101', horseNumber: '0x1101' }),
    ]
    const { preview } = await applyMayFile(db, rows)
    expect(preview.registeredSales).toStrictEqual(['S'])
    expect(preview.absences).toStrictEqual([])
    const events = await db.events.where('[gameId+horseId]').equals([GAME, 'S']).toArray()
    expect(events).toStrictEqual([
      expect.objectContaining({
        kind: 'mare-departed',
        reason: 'sold',
        source: { kind: 'manual' },
      }),
    ])
    expect(await db.mares.get('S')).toMatchObject({ herd: 'sold' })
  })

  it('MAY-13 已登記賣出的母馬仍出現在名單 → 待核對；使用者撤銷賣出紀錄（不建立回歸事件）或視為買回（建立回歸事件）', async () => {
    const db = await herdGame(
      [mareHorse('S1', 'エスワン', '0x0401', 1980), mareHorse('S2', 'エスツー', '0x0402', 1980)],
      [
        ungroupedMareRow('S1', 'unassigned', { location: 32 }),
        ungroupedMareRow('S2', 'unassigned', { location: 32 }),
      ],
    )
    for (const id of ['S1', 'S2']) expect((await sellMare(db, GAME, id)).status).toBe('done')
    const rows = [
      mayRow({ fullName: 'エスワン', age: 10, abilityNumber: '0x0401', horseNumber: '0x1401' }),
      mayRow({ fullName: 'エスツー', age: 10, abilityNumber: '0x0402', horseNumber: '0x1402' }),
    ]
    const { preview } = await previewMayFile(db, rows)
    expect(preview.rows.map((row) => row.kind)).toStrictEqual(['sold-present', 'sold-present'])
    expect(preview.counts.pending).toBe(2)

    const soldPresent = new Map<string, 'revoke' | 'buyback'>([
      ['S1', 'revoke'],
      ['S2', 'buyback'],
    ])
    await applyMayFile(db, rows, { decisions: { soldPresent } })
    for (const id of ['S1', 'S2']) expect(await db.mares.get(id)).toMatchObject({ herd: 'in-herd' })
    const kinds = async (id: string) =>
      (await db.events.where('[gameId+horseId]').equals([GAME, id]).toArray())
        .map((event) => event.kind)
        .sort()
    expect(await kinds('S1')).toStrictEqual(['mare-departed', 'mare-departure-corrected'])
    expect(await kinds('S2')).toStrictEqual(['mare-departed', 'mare-returned'])
  })

  it('MAY-14 在圈、未填能力番号的手動母馬，名單沒有一列配到她 → 未配對，須指定一列或確認缺席才能套用；指定後照配到處理，補入能力番号與出生年，那一列不另外新增', async () => {
    const db = await herdGame([], [])
    const added = await addMarketMare(db, GAME, {
      horse: { fullName: 'ミスタイプ' },
      assignment: { kind: 'unassigned' },
    })
    if (added.status !== 'done') throw new Error(added.status)
    const id = added.value.horse.id
    const rows = [
      mayRow({ fullName: 'ミスタイポ', age: 6, abilityNumber: '0x0501', horseNumber: '0x1501' }),
    ]
    const { preview } = await previewMayFile(db, rows)
    expect(preview.unmatched).toStrictEqual([{ horseId: id, candidates: [2] }])
    expect(() => mayContent(preview)).toThrow(`未配對的母馬還沒處理：${id}`)

    await applyMayFile(db, rows, { decisions: { picks: new Map([[id, 2]]) } })
    expect(await db.horses.count()).toBe(1)
    expect(await db.horses.get(id)).toMatchObject({
      fullName: 'ミスタイプ',
      abilityNumber: '0x0501',
      birthYear: 1984,
    })
    const numbers = await db.horseNumbers.toArray()
    expect(numbers.map((row) => [row.horseId, row.stage, row.number])).toStrictEqual([
      [id, 'broodmare', '0x1501'],
    ])
  })

  it('MAY-15 以資料更正重新匯入同年的五月名單，被更正的那次判定缺席的母馬又出現 → 撤銷離圈，不建立回歸事件', async () => {
    const db = await herdGame(
      [mareHorse('M', 'エム', '0x0601', 1980), mareHorse('C', 'シー', '0x0101', 1980)],
      [
        ungroupedMareRow('M', 'unassigned', { location: 32 }),
        ungroupedMareRow('C', 'unassigned', { location: 32 }),
      ],
    )
    const rowC = mayRow({
      fullName: 'シー',
      age: 10,
      abilityNumber: '0x0101',
      horseNumber: '0x1101',
    })
    const rowM = mayRow({
      fullName: 'エム',
      age: 10,
      abilityNumber: '0x0601',
      horseNumber: '0x1601',
    })
    await applyMayFile(db, [rowC])
    expect(await db.mares.get('M')).toMatchObject({ herd: 'sold' })

    const { preview } = await applyMayFile(db, [rowC, rowM], { mode: 'correction' })
    expect(preview.rows.find((row) => row.horseId === 'M')?.kind).toBe('revoked')
    expect(await db.mares.get('M')).toMatchObject({ herd: 'in-herd' })
    const kinds = (await db.events.where('[gameId+horseId]').equals([GAME, 'M']).toArray())
      .map((event) => event.kind)
      .sort()
    expect(kinds).toStrictEqual(['mare-departed', 'mare-departure-corrected'])
  })

  it('MAY-16 牧場處置已售出的自家牝駒出現在五月名單 → 依出生紀錄轉入繁殖圈，來源為其他', async () => {
    const { db, rows } = await successorMay()
    await db.horses.update('F88', { disposition: 'sold' })
    await applyMayFile(db, rows, { year: 1992 })
    expect(await db.mares.get('F88')).toMatchObject({
      usage: 'own',
      groupLine: 1,
      groupGeneration: 5,
      source: { kind: 'other' },
    })
    expect((await db.horses.get('F88'))?.disposition).toBe('sold')
  })
})
