import { describe, expect, it } from 'vitest'
import { GAME } from '../../tests/support/rows'
import type { ImportFilly, ImportMare, ImportSnapshot, MaySnapshot } from '../core/imports'
import type { BroodmareEntry } from './formats'
import { mayContent, previewMay, type MayDecisions, type UsageDecision } from './may'

/** 能力番号與馬番号的寫法：0x 加 4 位大寫十六進位 */
const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`

/**
 * 名單的一列：1990 年的檔案、1980 年生（10 歲）、據點 32，父母是チチ與ハハ，能力番号與馬番号依行號；
 * 其他欄位依需要覆寫
 */
function entry(line: number, fields: Partial<BroodmareEntry> = {}): BroodmareEntry {
  return {
    line,
    fullName: `ウマ${line}`,
    baseName: `ウマ${line}`,
    country: '日',
    age: 10,
    birthYear: 1980,
    speed: 60,
    stamina: 50,
    subAbilities: {
      power: 'C',
      burst: 'C',
      guts: 'C',
      flexibility: 'C',
      spirit: 'C',
      wisdom: 'C',
      health: 'C',
    },
    subTotal: 49,
    turf: '○',
    dirt: '△',
    distance: '1600～2400m',
    offspringQuality: 5,
    vigor: { value: 50, boosted: false },
    breedingYears: 3,
    foalCount: 2,
    sireName: 'チチ',
    sireSystem: 'エクリプス',
    damName: 'ハハ',
    femaleLine: 'ヒンケイ',
    farm: 32,
    status: '空胎',
    matedStallion: '',
    specialMating: '',
    abilityNumber: hex(line),
    horseNumber: hex(line + 0x1000),
    ...fields,
  }
}

/** 母馬：1980 年生、待指定用途、在圈、據點 32，父母名經匯入確認的チチ與ハハ；其他欄位依需要覆寫 */
function mare(id: string, fields: Partial<ImportMare> = {}): ImportMare {
  return {
    id,
    birthYear: 1980,
    sire: { confirmed: 'チチ', known: 'チチ' },
    dam: { confirmed: 'ハハ', known: 'ハハ' },
    usage: 'unassigned',
    herd: 'in-herd',
    location: 32,
    broodmareNumbers: [],
    entered: false,
    soldByUser: false,
    departedThisYear: false,
    ...fields,
  }
}

/** 還沒進過繁殖圈的自家牝駒：1980 年生，父母名經匯入確認的チチ與ハハ；其他欄位依需要覆寫 */
function filly(id: string, fields: Partial<ImportFilly> = {}): ImportFilly {
  return {
    id,
    birthYear: 1980,
    sire: { confirmed: 'チチ', known: 'チチ' },
    dam: { confirmed: 'ハハ', known: 'ハハ' },
    free: false,
    sold: false,
    ...fields,
  }
}

/** 1990 年五月繁殖圈名單的快照：定年 25 歲；五月的其他欄位依需要覆寫 */
function snapshot(
  mares: ImportMare[],
  fillies: ImportFilly[] = [],
  fields: Partial<MaySnapshot> = {},
): ImportSnapshot {
  return {
    gameId: GAME,
    currentYear: 1990,
    updatedAt: '2026-10-01T00:00:00.000Z',
    imports: [],
    checkpoints: [],
    may: { year: 1990, retirementAge: 25, mares, fillies, ...fields },
  }
}

/** 沒有任何筆數的 MAY-02 摘要 */
const NO_HERD = {
  continuing: 0,
  newArrivals: 0,
  returned: 0,
  retired: 0,
  sold: 0,
  moved: 0,
  unmatched: 0,
  conflicts: 0,
}

describe('previewMay', () => {
  it('以能力番号＋出生年配到在圈的母馬：繼續在圈；據點相同、馬番号已記過時什麼都不用改，算略過；據點不同為轉場，原本不知道據點時補上、不算轉場；新的繁殖牝馬馬番号另記（MAY-06、MARE-19）', () => {
    const mares = [
      mare('M1', { abilityNumber: hex(1), broodmareNumbers: [hex(0x1001)] }),
      mare('M2', { abilityNumber: hex(2), broodmareNumbers: [hex(0x2002)] }),
      mare('M3', { abilityNumber: hex(3), location: undefined }),
    ]
    const entries = [entry(1), entry(2, { farm: 33 }), entry(3, { farm: 34 })]
    const preview = previewMay(entries, snapshot(mares), 'normal')
    const number = (horseId: string, value: number) =>
      ({ kind: 'horse-number', horseId, stage: 'broodmare', number: hex(value) }) as const
    expect(preview.rows).toStrictEqual([
      {
        line: 1,
        kind: 'continuing',
        horseId: 'M1',
        match: 'ability-number',
        changes: {},
        warnings: [],
        items: [],
      },
      {
        line: 2,
        kind: 'continuing',
        horseId: 'M2',
        match: 'ability-number',
        changes: { location: { from: 32, to: 33 }, horseNumber: hex(0x1002) },
        warnings: [],
        items: [{ kind: 'mare-move', horseId: 'M2', location: 33 }, number('M2', 0x1002)],
      },
      {
        line: 3,
        kind: 'continuing',
        horseId: 'M3',
        match: 'ability-number',
        changes: { location: { to: 34 }, horseNumber: hex(0x1003) },
        warnings: [],
        items: [{ kind: 'mare-move', horseId: 'M3', location: 34 }, number('M3', 0x1003)],
      },
    ])
    expect(preview.errors).toStrictEqual([])
    expect(preview.absences).toStrictEqual([])
    expect(preview.herd).toStrictEqual({
      ...NO_HERD,
      continuing: 3,
      moved: 1,
      bases: { 32: 1, 33: 1, 34: 1, 35: 0 },
    })
    expect(preview.counts).toStrictEqual({
      applicable: 2,
      skipped: 1,
      pending: 0,
      errors: 0,
      warnings: 0,
    })
  })

  it('以唯一馬名輔助配到缺能力番号的母馬：補能力番号與出生年（ID-07）；兩列配到同一匹、能力番号矛盾、經匯入確認的馬名或父母不符是錯誤，指到的母馬不判缺席；手動的馬名不比（ID-03）', () => {
    const mares = [
      mare('N1', { birthYear: undefined, baseName: 'ナナシ', nameSource: 'manual' }),
      mare('D1', { baseName: 'ダブル', nameSource: 'manual' }),
      mare('C1', { abilityNumber: hex(4), baseName: 'シーワン', nameSource: 'import' }),
      mare('C2', { abilityNumber: hex(5), sire: { confirmed: 'ベツノチチ', known: 'ベツノチチ' } }),
      mare('C3', { abilityNumber: hex(6), baseName: 'テガキ', nameSource: 'manual' }),
      mare('X1', { abilityNumber: hex(0x99), birthYear: undefined, baseName: 'バンゴウ' }),
      mare('C4', { abilityNumber: hex(8), sire: { known: 'テウチチチ' } }),
    ]
    const entries = [
      entry(1, { fullName: 'ナナシ', baseName: 'ナナシ', birthYear: 1982 }),
      entry(2, { fullName: 'ダブル', baseName: 'ダブル' }),
      entry(3, { fullName: 'ダブル', baseName: 'ダブル' }),
      entry(4, { fullName: 'シーツー', baseName: 'シーツー' }),
      entry(5),
      // 檔案的父母名去掉前綴、忽略前後空白後比較
      entry(6, { sireName: '(外)チチ', damName: ' ハハ ' }),
      entry(7, { fullName: 'バンゴウ', baseName: 'バンゴウ' }),
      // 只有手動輸入的父馬名：不比（ID-13）
      entry(8),
    ]
    const preview = previewMay(entries, snapshot(mares), 'normal')
    expect(preview.rows).toStrictEqual([
      {
        line: 1,
        kind: 'continuing',
        horseId: 'N1',
        match: 'name',
        changes: { identity: { abilityNumber: hex(1), birthYear: 1982 }, horseNumber: hex(0x1001) },
        warnings: [],
        items: [
          { kind: 'horse-identity', horseId: 'N1', abilityNumber: hex(1), birthYear: 1982 },
          { kind: 'horse-number', horseId: 'N1', stage: 'broodmare', number: hex(0x1001) },
        ],
      },
      {
        line: 6,
        kind: 'continuing',
        horseId: 'C3',
        match: 'ability-number',
        changes: { horseNumber: hex(0x1006) },
        warnings: [],
        items: [{ kind: 'horse-number', horseId: 'C3', stage: 'broodmare', number: hex(0x1006) }],
      },
      {
        line: 8,
        kind: 'continuing',
        horseId: 'C4',
        match: 'ability-number',
        changes: { horseNumber: hex(0x1008) },
        warnings: [],
        items: [{ kind: 'horse-number', horseId: 'C4', stage: 'broodmare', number: hex(0x1008) }],
      },
    ])
    expect(preview.errors).toStrictEqual([
      { line: 2, horseIds: ['D1'], reasons: ['ambiguous'] },
      { line: 3, horseIds: ['D1'], reasons: ['ambiguous'] },
      { line: 4, horseIds: ['C1'], reasons: ['name'] },
      { line: 5, horseIds: ['C2'], reasons: ['sire'] },
      { line: 7, horseIds: ['X1'], reasons: ['ability-number'] },
    ])
    expect(preview.absences).toStrictEqual([])
    expect(preview.unmatched).toStrictEqual([])
    expect(preview.herd.conflicts).toBe(5)
    expect(preview.counts).toStrictEqual({
      applicable: 3,
      skipped: 0,
      pending: 0,
      errors: 5,
      warnings: 0,
    })
  })

  it('已離圈的母馬再出現：回歸；上次五月之後手動登記賣出的待核對，不套用（ID-04、MAY-13）；資料更正時，被更正的那次判定缺席的改為撤銷離圈（MAY-15），一般套用時照回歸', () => {
    const mares = [
      mare('R1', { abilityNumber: hex(1), herd: 'sold', location: 33 }),
      mare('S1', { abilityNumber: hex(2), herd: 'sold', soldByUser: true }),
      mare('T1', { abilityNumber: hex(3), herd: 'retired', departedThisYear: true, location: 33 }),
    ]
    const entries = [entry(1), entry(2), entry(3, { farm: 34 })]
    const normal = previewMay(entries, snapshot(mares), 'normal')
    const returned = (horseId: string, location: 32 | 34, value: number) => [
      { kind: 'mare-return', horseId, location },
      { kind: 'horse-number', horseId, stage: 'broodmare', number: hex(value) },
    ]
    expect(
      normal.rows.map(({ line, kind, changes, items }) => ({ line, kind, changes, items })),
    ).toStrictEqual([
      {
        line: 1,
        kind: 'returned',
        changes: { location: { from: 33, to: 32 }, horseNumber: hex(0x1001) },
        items: returned('R1', 32, 0x1001),
      },
      {
        line: 2,
        kind: 'sold-present',
        changes: { horseNumber: hex(0x1002) },
        items: [],
      },
      {
        line: 3,
        kind: 'returned',
        changes: { location: { from: 33, to: 34 }, horseNumber: hex(0x1003) },
        items: returned('T1', 34, 0x1003),
      },
    ])
    expect(normal.counts).toStrictEqual({
      applicable: 2,
      skipped: 0,
      pending: 1,
      errors: 0,
      warnings: 0,
    })
    expect(normal.herd).toMatchObject({ continuing: 0, returned: 2, moved: 0 })

    const correction = previewMay(entries, snapshot(mares), 'correction')
    expect(correction.rows[2]).toStrictEqual({
      line: 3,
      kind: 'revoked',
      horseId: 'T1',
      match: 'ability-number',
      changes: { location: { from: 33, to: 34 }, horseNumber: hex(0x1003) },
      warnings: [],
      items: [
        { kind: 'mare-revoke', horseId: 'T1' },
        { kind: 'mare-move', horseId: 'T1', location: 34 },
        { kind: 'horse-number', horseId: 'T1', stage: 'broodmare', number: hex(0x1003) },
      ],
    })
    expect(correction.herd).toMatchObject({ continuing: 1, returned: 1, moved: 1 })
  })

  it('還沒進過繁殖圈的自家牝駒：新進，轉入並記據點與馬番号（MAY-09、MAY-10）；沒配到任何紀錄的列：新進其他，建立市場母馬（MAY-03）；第 1 欄與第 59 欄不同時警告；只有前綴或第 59 欄空白是錯誤', () => {
    const fillies = [
      filly('F1', { abilityNumber: hex(1), birthYear: 1985 }),
      filly('F2', { birthYear: 1985, baseName: 'エフツー', nameSource: 'import', free: true }),
    ]
    const entries = [
      entry(1, { birthYear: 1985, age: 5 }),
      entry(2, { fullName: 'エフツー', baseName: 'エフツー', birthYear: 1985, age: 5 }),
      entry(3, {
        fullName: '(外)ガイコク',
        baseName: 'ガイコク',
        sireName: '(外)ソト',
        sireSystem: null,
        farm: 35,
      }),
      entry(4, { fullName: '[地]チホウ', baseName: 'チホー' }),
      entry(5, { fullName: '(外)' }),
      entry(6, { baseName: ' ' }),
    ]
    const preview = previewMay(entries, snapshot([], fillies), 'normal')
    expect(preview.rows).toStrictEqual([
      {
        line: 1,
        kind: 'new-own',
        horseId: 'F1',
        match: 'ability-number',
        changes: { location: { to: 32 }, horseNumber: hex(0x1001) },
        warnings: [],
        items: [
          { kind: 'filly-transfer', horseId: 'F1', location: 32 },
          { kind: 'horse-number', horseId: 'F1', stage: 'broodmare', number: hex(0x1001) },
        ],
      },
      {
        line: 2,
        kind: 'new-own',
        horseId: 'F2',
        match: 'name',
        changes: {
          identity: { abilityNumber: hex(2) },
          location: { to: 32 },
          horseNumber: hex(0x1002),
        },
        warnings: [],
        items: [
          { kind: 'horse-identity', horseId: 'F2', abilityNumber: hex(2), birthYear: 1985 },
          { kind: 'filly-transfer', horseId: 'F2', location: 32 },
          { kind: 'horse-number', horseId: 'F2', stage: 'broodmare', number: hex(0x1002) },
        ],
      },
      {
        line: 3,
        kind: 'new-other',
        changes: { location: { to: 35 }, horseNumber: hex(0x1003) },
        warnings: [],
        items: [
          {
            kind: 'mare-create',
            fullName: '(外)ガイコク',
            baseName: 'ガイコク',
            abilityNumber: hex(3),
            birthYear: 1980,
            sireName: '(外)ソト',
            damName: 'ハハ',
            femaleLine: 'ヒンケイ',
            location: 35,
            horseNumber: hex(0x1003),
            assignment: { kind: 'unassigned' },
          },
        ],
      },
      {
        line: 4,
        kind: 'new-other',
        changes: { location: { to: 32 }, horseNumber: hex(0x1004) },
        warnings: [{ kind: 'base-name', split: 'チホウ', baseName: 'チホー' }],
        items: [
          {
            kind: 'mare-create',
            fullName: '[地]チホウ',
            baseName: 'チホー',
            abilityNumber: hex(4),
            birthYear: 1980,
            sireName: 'チチ',
            damName: 'ハハ',
            sireSystem: 'エクリプス',
            femaleLine: 'ヒンケイ',
            location: 32,
            horseNumber: hex(0x1004),
            assignment: { kind: 'unassigned' },
          },
        ],
      },
    ])
    expect(preview.errors).toStrictEqual([
      { line: 5, horseIds: [], reasons: ['horse-name'] },
      { line: 6, horseIds: [], reasons: ['horse-name'] },
    ])
    expect(preview.herd).toStrictEqual({
      ...NO_HERD,
      newArrivals: 4,
      conflicts: 2,
      bases: { 32: 5, 33: 0, 34: 0, 35: 1 },
    })
    expect(preview.counts).toStrictEqual({
      applicable: 4,
      skipped: 0,
      pending: 0,
      errors: 2,
      warnings: 1,
    })
  })

  it('缺席：有能力番号與出生年的在圈母馬，名單年份減 1 那年的馬齡達定年預設定年引退，否則售出；出生年晚於那一年時馬齡不明、預設售出；已離圈的不動，上次五月之後手動登記賣出的另外列出（MAY-12、MARE-09、MARE-10）', () => {
    const mares = [
      mare('M1', { abilityNumber: hex(1) }),
      mare('A25', { abilityNumber: hex(0x21), birthYear: 1964 }),
      mare('A24', { abilityNumber: hex(0x22), birthYear: 1965 }),
      mare('A0', { abilityNumber: hex(0x23), birthYear: 1989 }),
      mare('AU', { abilityNumber: hex(0x24), birthYear: 1990 }),
      mare('AS', { abilityNumber: hex(0x25), herd: 'sold', soldByUser: true }),
      mare('AR', { abilityNumber: hex(0x26), herd: 'retired' }),
      // 已登記賣出、仍在名單上：待核對，不算照紀錄
      mare('AP', { abilityNumber: hex(0x27), herd: 'sold', soldByUser: true }),
    ]
    const entries = [entry(1), entry(2, { abilityNumber: hex(0x27) })]
    const preview = previewMay(entries, snapshot(mares), 'normal')
    expect(preview.absences).toStrictEqual([
      { horseId: 'A25', age: 25, defaultReason: 'retired', reason: 'retired' },
      { horseId: 'A24', age: 24, defaultReason: 'sold', reason: 'sold' },
      { horseId: 'A0', age: 0, defaultReason: 'sold', reason: 'sold' },
      { horseId: 'AU', defaultReason: 'sold', reason: 'sold' },
    ])
    expect(preview.registeredSales).toStrictEqual(['AS'])
    expect(preview.herd).toMatchObject({ continuing: 1, retired: 1, sold: 3 })

    const younger = previewMay(entries, snapshot(mares, [], { retirementAge: 24 }), 'normal')
    expect(younger.absences.map(({ horseId, reason }) => [horseId, reason])).toStrictEqual([
      ['A25', 'retired'],
      ['A24', 'retired'],
      ['A0', 'sold'],
      ['AU', 'sold'],
    ])
  })

  it('未配對：在圈但缺能力番号或出生年、沒被任何列見到的母馬；可以指定的列是能力番号與出生年不矛盾的新進其他，錯誤的列不算（MAY-14）', () => {
    const mares = [
      mare('U1', { birthYear: 1982, baseName: 'ミスタイプ', nameSource: 'manual' }),
      mare('U2', { abilityNumber: hex(0x50), birthYear: undefined, baseName: 'ユーツーダ' }),
      mare('K1', { abilityNumber: hex(5), birthYear: 1982 }),
    ]
    const entries = [
      entry(1, { fullName: 'ミスタイポ', baseName: 'ミスタイポ', birthYear: 1982 }),
      entry(2, { birthYear: 1983 }),
      entry(3, {
        fullName: 'ユーツー',
        baseName: 'ユーツー',
        abilityNumber: hex(0x50),
        birthYear: 1984,
      }),
      entry(4, { fullName: '(外)', birthYear: 1982 }),
      // 繼續在圈的列不是候選
      entry(5, { birthYear: 1982 }),
    ]
    const preview = previewMay(entries, snapshot(mares), 'normal')
    expect(preview.unmatched).toStrictEqual([
      { horseId: 'U1', candidates: [1] },
      { horseId: 'U2', candidates: [3] },
    ])
    expect(preview.absences).toStrictEqual([])
    expect(preview.herd.unmatched).toBe(2)
  })

  it('用途把關：新進其他、回歸的市場母馬、上次五月之後新增或回歸而繼續在圈的市場母馬，依行號；自家母駒、自由配種所生、撤銷離圈與沒有新登記的不列（MAY-11）', () => {
    const mares = [
      mare('G1', {
        abilityNumber: hex(1),
        usage: 'substitute',
        groupLine: 2,
        groupGeneration: 3,
        entered: true,
      }),
      mare('G2', { abilityNumber: hex(2) }),
      mare('G3', {
        abilityNumber: hex(3),
        usage: 'start',
        groupLine: 1,
        groupGeneration: 0,
        herd: 'sold',
      }),
      mare('G4', {
        abilityNumber: hex(4),
        usage: 'own',
        groupLine: 1,
        groupGeneration: 2,
        entered: true,
      }),
      mare('G5', { abilityNumber: hex(5), usage: 'free', herd: 'sold' }),
      mare('G6', { abilityNumber: hex(6), herd: 'retired', departedThisYear: true, entered: true }),
    ]
    const entries = [1, 2, 3, 4, 5, 6, 7].map((line) => entry(line))
    const preview = previewMay(entries, snapshot(mares), 'correction')
    expect(preview.usages).toStrictEqual([
      { key: 'G1', current: { usage: 'substitute', groupLine: 2, groupGeneration: 3 } },
      { key: 'G3', current: { usage: 'start', groupLine: 1, groupGeneration: 0 } },
      { key: 7, current: { usage: 'unassigned' } },
    ])
  })

  it('快照沒有五月的資料時丟出錯誤；牧場不是 32～35 時丟出 RangeError（解析已擋下）', () => {
    const withoutMay: ImportSnapshot = { ...snapshot([]), may: undefined }
    expect(() => previewMay([entry(1)], withoutMay, 'normal')).toThrow(
      '快照沒有五月繁殖圈名單的資料',
    )
    expect(() => previewMay([entry(1, { farm: 31 })], snapshot([]), 'normal')).toThrow(RangeError)
  })

  it('只有前綴或第 59 欄空白的列是錯誤，以能力番号配到的在圈母馬仍算見到，不判缺席（技術設計 4.4「列的分類」）', () => {
    const mares = [mare('M1', { abilityNumber: hex(1) }), mare('M2', { abilityNumber: hex(2) })]
    const entries = [entry(1, { fullName: '(外)' }), entry(2, { baseName: ' ' })]
    const preview = previewMay(entries, snapshot(mares), 'normal')
    expect(preview.rows).toStrictEqual([])
    expect(preview.errors).toStrictEqual([
      { line: 1, horseIds: ['M1'], reasons: ['horse-name'] },
      { line: 2, horseIds: ['M2'], reasons: ['horse-name'] },
    ])
    expect(preview.absences).toStrictEqual([])
  })

  it('已套用較晚年份的五月時不能預覽：直接補匯與資料更正都丟出 RangeError，較早年份的名單只能回溯後重新匯入（需求規格 11.5「較晚的五月已套用」）', () => {
    const later = snapshot([mare('M1', { abilityNumber: hex(1) })], [], {
      laterMay: { id: 'I2', year: 1991 },
    })
    for (const mode of ['catch-up', 'correction'] as const) {
      const preview = () => previewMay([entry(1)], later, mode)
      expect(preview).toThrow(RangeError)
      expect(preview).toThrow('已套用 1991 年的五月繁殖圈名單，較早年份的名單請改用回溯')
    }
  })
})

describe('previewMay：使用者的決定', () => {
  it('缺席的原因可以逐匹更正；不是缺席或未配對的母馬丟出 RangeError（MARE-09）', () => {
    const mares = [
      mare('M1', { abilityNumber: hex(1), broodmareNumbers: [hex(0x1001)] }),
      mare('A24', { abilityNumber: hex(0x22), birthYear: 1965 }),
    ]
    const decisions: MayDecisions = { absences: new Map([['A24', 'retired']]) }
    const preview = previewMay([entry(1)], snapshot(mares), 'normal', decisions)
    expect(preview.absences).toStrictEqual([
      { horseId: 'A24', age: 24, defaultReason: 'sold', reason: 'retired' },
    ])
    expect(preview.herd).toMatchObject({ retired: 1, sold: 0 })
    expect(mayContent(preview).items).toStrictEqual([
      { kind: 'mare-depart', horseId: 'A24', reason: 'retired' },
    ])
    const wrong: MayDecisions = { absences: new Map([['M1', 'sold']]) }
    expect(() => previewMay([entry(1)], snapshot(mares), 'normal', wrong)).toThrow(
      '這匹母馬不是缺席或未配對：M1',
    )
  })

  it('未配對：指定新進其他的一列，照配到處理並補能力番号與出生年，那一列不另外新增；指定的列不再是候選；確認缺席的接在缺席之後離圈；全部處理完才能產生內容（MAY-14）', () => {
    const mares = [
      // 經匯入確認的母馬名前後有空白：忽略後與名單相同，不是錯誤
      mare('U1', {
        baseName: 'ミスタイプ',
        nameSource: 'manual',
        birthYear: 1982,
        location: 33,
        dam: { confirmed: ' ハハ ', known: ' ハハ ' },
      }),
      mare('U2', { baseName: 'ユーニ', nameSource: 'manual', birthYear: 1982 }),
      mare('U3', { baseName: 'ユーサン', nameSource: 'manual', birthYear: undefined }),
      mare('A1', { abilityNumber: hex(0x60), birthYear: 1970 }),
    ]
    const entries = [
      entry(1, { fullName: 'ミスタイポ', baseName: 'ミスタイポ', birthYear: 1982 }),
      entry(2, { fullName: 'ユーニイ', baseName: 'ユーニイ', birthYear: 1982 }),
      entry(3, { birthYear: 1984 }),
    ]
    const decisions: MayDecisions = {
      picks: new Map([['U1', 1]]),
      absences: new Map([['U2', 'sold']]),
    }
    const preview = previewMay(entries, snapshot(mares), 'normal', decisions)
    expect(preview.rows[0]).toStrictEqual({
      line: 1,
      kind: 'continuing',
      horseId: 'U1',
      match: 'picked',
      changes: {
        identity: { abilityNumber: hex(1) },
        location: { from: 33, to: 32 },
        horseNumber: hex(0x1001),
      },
      warnings: [],
      items: [
        { kind: 'horse-identity', horseId: 'U1', abilityNumber: hex(1), birthYear: 1982 },
        { kind: 'mare-move', horseId: 'U1', location: 32 },
        { kind: 'horse-number', horseId: 'U1', stage: 'broodmare', number: hex(0x1001) },
      ],
    })
    expect(preview.rows.map((row) => [row.line, row.kind])).toStrictEqual([
      [1, 'continuing'],
      [2, 'new-other'],
      [3, 'new-other'],
    ])
    expect(preview.unmatched).toStrictEqual([
      { horseId: 'U1', candidates: [2], resolution: { line: 1 } },
      { horseId: 'U2', candidates: [2], resolution: { reason: 'sold' } },
      { horseId: 'U3', candidates: [2, 3] },
    ])
    expect(preview.herd).toMatchObject({
      continuing: 1,
      newArrivals: 2,
      sold: 2,
      moved: 1,
      unmatched: 1,
    })
    expect(() => mayContent(preview)).toThrow('未配對的母馬還沒處理：U3')

    const done = previewMay(entries, snapshot(mares), 'normal', {
      ...decisions,
      absences: new Map([
        ['U2', 'sold'],
        ['U3', 'retired'],
      ]),
    })
    expect(done.herd).toMatchObject({ retired: 1, sold: 2, unmatched: 0 })
    expect(mayContent(done).items.slice(0, 3)).toStrictEqual([
      { kind: 'mare-depart', horseId: 'A1', reason: 'sold' },
      { kind: 'mare-depart', horseId: 'U2', reason: 'sold' },
      { kind: 'mare-depart', horseId: 'U3', reason: 'retired' },
    ])
  })

  it('指定不合法時丟出 RangeError：不是未配對的母馬、那一列不是新進其他（配到別匹、錯誤、已被指定、檔案沒有）、能力番号或出生年矛盾、同一匹又確認缺席；指定的列與經匯入確認的父母名不符時是錯誤', () => {
    const mares = [
      mare('U1', {
        baseName: 'ユーイチ',
        nameSource: 'manual',
        birthYear: 1982,
        sire: { confirmed: 'ベツノチチ', known: 'ベツノチチ' },
        dam: { confirmed: 'ベツノハハ', known: 'ベツノハハ' },
      }),
      mare('U2', { baseName: 'ユーニ', nameSource: 'manual', birthYear: 1982 }),
      mare('M1', { abilityNumber: hex(5) }),
    ]
    const entries = [
      entry(1, { birthYear: 1982 }),
      entry(2, { birthYear: 1983 }),
      entry(3, { fullName: '(外)', birthYear: 1982 }),
      entry(5),
    ]
    const preview = (decisions: MayDecisions) =>
      previewMay(entries, snapshot(mares), 'normal', decisions)
    const picks = (...pairs: [string, number][]): MayDecisions => ({ picks: new Map(pairs) })
    expect(() => preview(picks(['M1', 1]))).toThrow('這匹母馬不是未配對：M1')
    expect(() => preview(picks(['U2', 5]))).toThrow('第 5 行不是新進（其他），或已指定給別的母馬')
    expect(() => preview(picks(['U2', 3]))).toThrow('第 3 行不是新進（其他）')
    expect(() => preview(picks(['U2', 9]))).toThrow('第 9 行不是新進（其他）')
    expect(() => preview(picks(['U1', 1], ['U2', 1]))).toThrow('第 1 行不是新進（其他）')
    expect(() => preview(picks(['U2', 2]))).toThrow('第 2 行的能力番号或出生年與母馬不同：U2')
    expect(() =>
      preview({ picks: new Map([['U2', 1]]), absences: new Map([['U2', 'sold']]) }),
    ).toThrow('未配對的母馬不能同時指定列與確認缺席：U2')

    const conflict = preview(picks(['U1', 1]))
    expect(conflict.errors).toContainEqual({
      line: 1,
      horseIds: ['U1'],
      reasons: ['sire', 'dam'],
    })
    expect(conflict.rows.map((row) => row.line)).not.toContain(1)
    expect(conflict.unmatched[0]).toStrictEqual({
      horseId: 'U1',
      candidates: [],
      resolution: { line: 1 },
    })
  })

  it('已登記賣出卻仍在名單：選撤銷照撤銷離圈，選視為買回照回歸（市場母馬列入用途把關）；不處理時待核對；不是已登記賣出的母馬丟出 RangeError（MAY-13）', () => {
    const mares = [
      mare('S1', { abilityNumber: hex(1), herd: 'sold', soldByUser: true, location: 33 }),
      mare('S2', {
        abilityNumber: hex(2),
        herd: 'sold',
        soldByUser: true,
        usage: 'substitute',
        groupLine: 2,
        groupGeneration: 3,
      }),
      mare('S3', { abilityNumber: hex(3), herd: 'sold', soldByUser: true }),
      mare('M4', { abilityNumber: hex(4) }),
    ]
    const entries = [1, 2, 3, 4].map((line) => entry(line))
    const decisions: MayDecisions = {
      soldPresent: new Map([
        ['S1', 'revoke'],
        ['S2', 'buyback'],
      ]),
    }
    const preview = previewMay(entries, snapshot(mares), 'normal', decisions)
    const number = (horseId: string, value: number) =>
      ({ kind: 'horse-number', horseId, stage: 'broodmare', number: hex(value) }) as const
    expect(
      preview.rows.map(({ line, kind, resolution, items }) => ({ line, kind, resolution, items })),
    ).toStrictEqual([
      {
        line: 1,
        kind: 'sold-present',
        resolution: 'revoke',
        items: [
          { kind: 'mare-revoke', horseId: 'S1' },
          { kind: 'mare-move', horseId: 'S1', location: 32 },
          number('S1', 0x1001),
        ],
      },
      {
        line: 2,
        kind: 'sold-present',
        resolution: 'buyback',
        items: [{ kind: 'mare-return', horseId: 'S2', location: 32 }, number('S2', 0x1002)],
      },
      { line: 3, kind: 'sold-present', resolution: undefined, items: [] },
      { line: 4, kind: 'continuing', resolution: undefined, items: [number('M4', 0x1004)] },
    ])
    expect(preview.rows[2]).not.toHaveProperty('resolution')
    expect(preview.usages).toStrictEqual([
      { key: 'S2', current: { usage: 'substitute', groupLine: 2, groupGeneration: 3 } },
    ])
    expect(preview.herd).toMatchObject({ continuing: 2, returned: 1, moved: 1 })
    expect(preview.counts).toStrictEqual({
      applicable: 3,
      skipped: 0,
      pending: 1,
      errors: 0,
      warnings: 0,
    })
    const wrong: MayDecisions = { soldPresent: new Map([['M4', 'revoke']]) }
    expect(() => previewMay(entries, snapshot(mares), 'normal', wrong)).toThrow(
      '這匹母馬不是已登記賣出卻仍在名單：M4',
    )
  })

  it('用途把關：選的用途記在清單上；新進其他照選的用途建立，回歸的帶給回歸，繼續在圈的另加修改用途，例外補入原因與確認照帶；不在清單上的對象丟出 RangeError（MAY-11）', () => {
    const mares = [
      mare('G1', { abilityNumber: hex(1), entered: true }),
      mare('G2', { abilityNumber: hex(2) }),
      mare('G3', { abilityNumber: hex(3), herd: 'sold' }),
    ]
    const entries = [1, 2, 3, 4].map((line) => entry(line))
    const pairing = { kind: 'pairing', line: 1, generation: 2 } as const
    const decisions: MayDecisions = {
      usages: new Map<string | number, UsageDecision>([
        ['G1', { assignment: pairing }],
        ['G3', { assignment: pairing, exceptionReason: '自家母駒不足', confirmed: true }],
        [4, { assignment: pairing, confirmed: true }],
      ]),
    }
    const preview = previewMay(entries, snapshot(mares), 'normal', decisions)
    expect(preview.usages).toStrictEqual([
      { key: 'G1', current: { usage: 'unassigned' }, decision: { assignment: pairing } },
      {
        key: 'G3',
        current: { usage: 'unassigned' },
        decision: { assignment: pairing, exceptionReason: '自家母駒不足', confirmed: true },
      },
      {
        key: 4,
        current: { usage: 'unassigned' },
        decision: { assignment: pairing, confirmed: true },
      },
    ])
    expect(mayContent(preview).items).toStrictEqual([
      {
        kind: 'mare-return',
        horseId: 'G3',
        location: 32,
        assignment: pairing,
        exceptionReason: '自家母駒不足',
        confirmed: true,
      },
      {
        kind: 'mare-create',
        fullName: 'ウマ4',
        baseName: 'ウマ4',
        abilityNumber: hex(4),
        birthYear: 1980,
        sireName: 'チチ',
        damName: 'ハハ',
        sireSystem: 'エクリプス',
        femaleLine: 'ヒンケイ',
        location: 32,
        horseNumber: hex(0x1004),
        assignment: pairing,
        confirmed: true,
      },
      { kind: 'horse-number', horseId: 'G1', stage: 'broodmare', number: hex(0x1001) },
      { kind: 'horse-number', horseId: 'G2', stage: 'broodmare', number: hex(0x1002) },
      { kind: 'horse-number', horseId: 'G3', stage: 'broodmare', number: hex(0x1003) },
      { kind: 'mare-usage', horseId: 'G1', assignment: pairing },
    ])
    for (const key of ['G2', 9]) {
      const wrong: MayDecisions = { usages: new Map([[key, { assignment: pairing }]]) }
      expect(() => previewMay(entries, snapshot(mares), 'normal', wrong)).toThrow(
        `不在用途把關清單上：${key}`,
      )
    }
  })
})

describe('mayContent', () => {
  it('項目依離圈、撤銷、補齊身分、回歸／轉入／新建（依行號）、轉場、馬番号的順序；摘要帶 MAY-02 的筆數與據點分布', () => {
    const mares = [
      mare('R', { abilityNumber: hex(1), herd: 'sold', location: 33 }),
      mare('N', { birthYear: undefined, baseName: 'ナナシ', nameSource: 'manual' }),
      mare('T', { abilityNumber: hex(5), herd: 'retired', departedThisYear: true }),
      mare('A', { abilityNumber: hex(0x60), birthYear: 1970 }),
    ]
    const entries = [
      entry(1),
      entry(2, { fullName: 'ナナシ', baseName: 'ナナシ' }),
      entry(3),
      entry(4),
      entry(5, { farm: 34 }),
    ]
    const preview = previewMay(
      entries,
      snapshot(mares, [filly('F', { abilityNumber: hex(3) })]),
      'correction',
    )
    const number = (horseId: string, value: number) =>
      ({ kind: 'horse-number', horseId, stage: 'broodmare', number: hex(value) }) as const
    expect(mayContent(preview)).toStrictEqual({
      summary: {
        total: 5,
        applied: 5,
        skipped: 0,
        pending: 0,
        warnings: 0,
        errors: 0,
        herd: {
          continuing: 2,
          newArrivals: 2,
          returned: 1,
          retired: 0,
          sold: 1,
          moved: 1,
          unmatched: 0,
          conflicts: 0,
          bases: { 32: 4, 33: 0, 34: 1, 35: 0 },
        },
      },
      items: [
        { kind: 'mare-depart', horseId: 'A', reason: 'sold' },
        { kind: 'mare-revoke', horseId: 'T' },
        { kind: 'horse-identity', horseId: 'N', abilityNumber: hex(2), birthYear: 1980 },
        { kind: 'mare-return', horseId: 'R', location: 32 },
        { kind: 'filly-transfer', horseId: 'F', location: 32 },
        {
          kind: 'mare-create',
          fullName: 'ウマ4',
          baseName: 'ウマ4',
          abilityNumber: hex(4),
          birthYear: 1980,
          sireName: 'チチ',
          damName: 'ハハ',
          sireSystem: 'エクリプス',
          femaleLine: 'ヒンケイ',
          location: 32,
          horseNumber: hex(0x1004),
          assignment: { kind: 'unassigned' },
        },
        { kind: 'mare-move', horseId: 'T', location: 34 },
        number('R', 0x1001),
        number('N', 0x1002),
        number('F', 0x1003),
        number('T', 0x1005),
      ],
    })
  })

  it('還有未配對的母馬沒處理時丟出 RangeError（需求規格 11.5「未配對」）', () => {
    const mares = [mare('U1', { baseName: 'ミスタイプ', nameSource: 'manual' })]
    const preview = previewMay([entry(1)], snapshot(mares), 'normal')
    expect(() => mayContent(preview)).toThrow('未配對的母馬還沒處理：U1')
  })
})
