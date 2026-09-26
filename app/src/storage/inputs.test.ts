import { describe, expect, it } from 'vitest'
import {
  GAME,
  horseRow,
  ownMareRow,
  stallionRow,
  startMareRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../../tests/support/rows'
import { matchHorse } from '../core/identity'
import { verifySuccessor } from '../core/successor'
import {
  buildKnownHorses,
  buildOwnMares,
  buildStallionRecords,
  buildSubstituteMares,
  buildSuccessorCandidate,
  mareAgeSettings,
} from './inputs'
import type { BreedingRow } from './records'

describe('mareAgeSettings', () => {
  it('取這一局的定年與高齡提醒年齡', () => {
    expect(
      mareAgeSettings({ gameId: GAME, retirementAge: 24, seniorAge: 20, stallionReminderAge: 26 }),
    ).toEqual({ retirementAge: 24, seniorAge: 20 })
  })
})

describe('buildOwnMares', () => {
  it('只取自家母駒，帶上馬匹記載的父母、是否在圈與接替狀態', () => {
    const mares = [
      ownMareRow('A', 1, 2),
      ownMareRow('B', 1, 2, { herd: 'sold', sisterStatus: 'sold' }),
      substituteMareRow('C', 1, 2),
    ]
    const horses = mares.map((mare) => horseRow(mare.horseId, { sireId: 'S', damId: 'D' }))
    expect(buildOwnMares(mares, horses)).toEqual([
      { id: 'A', sireId: 'S', damId: 'D', inHerd: true, status: 'provisional' },
      { id: 'B', sireId: 'S', damId: 'D', inHerd: false, status: 'sold' },
    ])
  })

  it('找不到馬匹資料或缺少接替狀態時丟出錯誤', () => {
    expect(() => buildOwnMares([ownMareRow('A', 1, 2)], [])).toThrow('找不到馬匹：A')
    expect(() =>
      buildOwnMares([ownMareRow('A', 1, 2, { sisterStatus: undefined })], [horseRow('A')]),
    ).toThrow('自家母駒缺少接替狀態：A')
  })
})

describe('buildStallionRecords', () => {
  it('有馬匹的任用轉成種牡馬紀錄並帶上父馬；尚未誕生的預定後繼不列入', () => {
    const stallions = [
      stallionRow('A', 1, 3, { status: 'replaced' }),
      stallionRow('B', 1, 3),
      stallionRow('C', 1, 3, { status: undefined, readiness: 'retired-awaiting' }),
      stallionRow('U', 1, 3, { horseId: undefined, breedingId: 'BR', status: undefined }),
    ]
    const horses = ['A', 'B', 'C'].map((id) => horseRow(id, { sireId: 'S' }))
    const placement = { line: 1, generation: 3 }
    expect(buildStallionRecords(stallions, horses)).toEqual([
      { id: 'A', placement, sireId: 'S', status: 'replaced' },
      { id: 'B', placement, sireId: 'S', status: 'active' },
      { id: 'C', placement, sireId: 'S' },
    ])
  })

  it('找不到馬匹資料時丟出錯誤', () => {
    expect(() => buildStallionRecords([stallionRow('A', 1, 3)], [])).toThrow('找不到馬匹：A')
  })
})

describe('buildSuccessorCandidate', () => {
  /** 第 5 系 12 代補公系：第 5 系零代 × 第 1 系 12 代自家母馬 → 第 5 系 13 代 */
  const breeding = (fields: Partial<BreedingRow> = {}): BreedingRow => ({
    id: 'BR',
    gameId: GAME,
    mareId: 'M',
    year: 2000,
    kind: 'designated',
    sireId: 'Z5',
    conception: '受胎',
    rule: {
      distance: 4,
      sire: { line: 5, generation: 0 },
      dam: { kind: 'own', line: 1, generation: 12 },
      output: { line: 5, generation: 13 },
      restoration: true,
    },
    ...fields,
  })
  const foal = horseRow('F', {
    sireId: 'Z5',
    damId: 'M',
    birth: { breedingId: 'BR', placement: { line: 5, generation: 13 } },
  })

  it('八系指定配種所生：帶上規則快照與出生紀錄的系與代數，補公系配對記 restoration（LINE-41）', () => {
    const candidate = buildSuccessorCandidate(foal, breeding())
    expect(candidate).toEqual({
      sireId: 'Z5',
      damId: 'M',
      origin: {
        kind: 'designated',
        breedingSireId: 'Z5',
        breedingDamId: 'M',
        sire: { line: 5, generation: 0 },
        dam: { kind: 'own', line: 1, generation: 12 },
        recorded: { line: 5, generation: 13 },
        restoration: true,
      },
    })
    expect(verifySuccessor(candidate, { line: 5, generation: 13 })).toEqual([])
  })

  it('自由配種、沒有配種紀錄、沒有規則快照，或出生紀錄沒有系與代數時比照自由配種', () => {
    const free = { sireId: 'Z5', damId: 'M', origin: { kind: 'free' } }
    expect(buildSuccessorCandidate(foal, breeding({ kind: 'free' }))).toEqual(free)
    expect(buildSuccessorCandidate(horseRow('F', { sireId: 'Z5', damId: 'M' }), undefined)).toEqual(
      free,
    )
    expect(buildSuccessorCandidate(foal, breeding({ rule: undefined }))).toEqual(free)
    const unplaced = horseRow('F', { sireId: 'Z5', damId: 'M', birth: { breedingId: 'BR' } })
    expect(buildSuccessorCandidate(unplaced, breeding())).toEqual(free)
  })

  it('配種紀錄不是產駒出生紀錄連結的那一筆時丟出錯誤', () => {
    expect(() => buildSuccessorCandidate(foal, breeding({ id: 'OTHER' }))).toThrow(RangeError)
  })
})

describe('buildSubstituteMares', () => {
  it('替代同一代的市場母馬，包含已離圈的；不含其他代、其他用途與正在檢查的母馬', () => {
    const mares = [
      substituteMareRow('A', 5, 3),
      substituteMareRow('B', 7, 3, { herd: 'sold' }),
      substituteMareRow('C', 5, 4),
      ownMareRow('D', 3, 3),
      startMareRow('E'),
      ungroupedMareRow('U', 'unassigned'),
      substituteMareRow('X', 6, 3),
    ]
    const horses = mares.map((mare) =>
      horseRow(mare.horseId, { sireSystem: `父系${mare.horseId}` }),
    )
    expect(buildSubstituteMares(mares, horses, 3, 'X')).toEqual([
      { forLine: 5, forGeneration: 3, ownSireSystem: '父系A' },
      { forLine: 7, forGeneration: 3, ownSireSystem: '父系B' },
    ])
  })

  it('找不到馬匹資料時丟出錯誤', () => {
    expect(() => buildSubstituteMares([substituteMareRow('A', 5, 3)], [], 3)).toThrow(
      '找不到馬匹：A',
    )
  })
})

describe('buildKnownHorses', () => {
  it('帶上能力番号、出生年與正式馬名的基本馬名；手動輸入的馬名標 manualName；父母名優先用匯入名稱，沒有才用連結父母經匯入確認的馬名', () => {
    const horses = [
      horseRow('A', {
        abilityNumber: '0x0000',
        birthYear: 1985,
        fullName: '(外)アルファ',
        baseName: 'アルファ',
        nameSource: 'import',
        sireName: '父の名',
        damName: '母の名',
      }),
      horseRow('B', { baseName: 'ベータ', nameSource: 'manual' }),
      horseRow('F', { birthYear: 1990, sireId: 'A', damId: 'B' }),
      horseRow('G', { sireId: 'A', sireName: '匯入の父' }),
    ]
    expect(buildKnownHorses(horses)).toEqual([
      {
        id: 'A',
        abilityNumber: '0x0000',
        birthYear: 1985,
        name: 'アルファ',
        manualName: false,
        sireName: '父の名',
        damName: '母の名',
      },
      { id: 'B', name: 'ベータ', manualName: true },
      { id: 'F', birthYear: 1990, manualName: false, sireName: 'アルファ' },
      { id: 'G', manualName: false, sireName: '匯入の父' },
    ])
  })

  it('連結父母的馬名還是手動輸入時不傳，父母的手動名打錯時子女不會被誤判為衝突', () => {
    const horses = [
      horseRow('S', { baseName: '手動の父', nameSource: 'manual' }),
      horseRow('D', { baseName: '確認の母', nameSource: 'import' }),
      horseRow('F', { abilityNumber: '0x1234', birthYear: 1990, sireId: 'S', damId: 'D' }),
    ]
    const known = buildKnownHorses(horses)
    expect(known[2]).toEqual({
      id: 'F',
      abilityNumber: '0x1234',
      birthYear: 1990,
      manualName: false,
      damName: '確認の母',
    })
    expect(
      matchHorse(
        { abilityNumber: '0x1234', birthYear: 1990, sireName: '匯入の父', damName: '確認の母' },
        known,
      ),
    ).toEqual({ kind: 'same', id: 'F' })
  })

  it('連結的父母不在同一批馬匹中時丟出錯誤', () => {
    expect(() => buildKnownHorses([horseRow('F', { sireId: 'Q' })])).toThrow('找不到馬匹：Q')
  })
})

describe('buildKnownHorses 的手動父母名（需求規格 6.4）', () => {
  it('手動輸入的父母名不當作匯入名稱；有連結馬匹時改用它經匯入確認的馬名', () => {
    const horses = [
      horseRow('S', { baseName: '父の名', nameSource: 'import' }),
      horseRow('M1', { sireName: '手動の父', damName: '手動の母', pedigreeSource: 'manual' }),
      horseRow('M2', { sireId: 'S', sireName: '手動の父', pedigreeSource: 'manual' }),
      horseRow('M3', { sireName: '匯入の父', damName: '匯入の母', pedigreeSource: 'import' }),
    ]
    expect(
      buildKnownHorses(horses).map(({ id, sireName, damName }) => ({ id, sireName, damName })),
    ).toEqual([
      { id: 'S', sireName: undefined, damName: undefined },
      { id: 'M1', sireName: undefined, damName: undefined },
      { id: 'M2', sireName: '父の名', damName: undefined },
      { id: 'M3', sireName: '匯入の父', damName: '匯入の母' },
    ])
  })
})
