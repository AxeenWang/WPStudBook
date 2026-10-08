import { describe, expect, it } from 'vitest'
import { GAME } from '../../tests/support/rows'
import type { ImportFilly, ImportMare, ImportSnapshot, MaySnapshot } from '../core/imports'
import type { BroodmareEntry } from './formats'
import { mayContent, previewMay } from './may'

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
