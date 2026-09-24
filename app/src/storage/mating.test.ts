import { describe, expect, it } from 'vitest'
import {
  horseRow,
  lineRow,
  ownMareRow,
  restorationRow,
  stallionRow,
  startMareRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../../tests/support/rows'
import { ancestorSlots, type PedigreeNode } from '../core/pedigree'
import { buildMating, type PedigreeRows } from './mating'

/** 組血統樹的資料列；沒寫到的資料表為空 */
function rowsOf(rows: Partial<PedigreeRows>): PedigreeRows {
  return { horses: [], stallions: [], mares: [], restorations: [], lines: [], ...rows }
}

/** 沿著父親往上走，列出每一代的馬 */
function sireChain(node: PedigreeNode | null): string[] {
  return node ? [node.horse.id, ...sireChain(node.sire)] : []
}

describe('buildMating', () => {
  it('從配種雙方往上展開到第 4 代，第 5 代不展開；沒有內部紀錄的父母為 null', () => {
    const rows = rowsOf({
      horses: [
        horseRow('A', { sireId: 'B', damName: '外部の母' }),
        horseRow('B', { sireId: 'C' }),
        horseRow('C', { sireId: 'D' }),
        horseRow('D', { sireId: 'E' }),
        horseRow('E'),
        horseRow('M'),
      ],
    })
    const mating = buildMating('A', 'M', rows)
    expect(sireChain(mating.sire)).toEqual(['A', 'B', 'C', 'D'])
    expect(mating.sire!.dam).toBeNull()
    expect(mating.dam).toEqual({
      horse: { id: 'M', buildPhaseMarket: false },
      sire: null,
      dam: null,
    })
    expect(buildMating(undefined, undefined, rows)).toEqual({ sire: null, dam: null })
  })

  it('馬名用基本馬名，父系照資料列', () => {
    const rows = rowsOf({
      horses: [
        horseRow('A', { fullName: '(外)テスト', baseName: 'テスト', sireSystem: 'マンノウォー' }),
      ],
    })
    expect(buildMating('A', undefined, rows).sire!.horse).toEqual({
      id: 'A',
      name: 'テスト',
      sireSystem: 'マンノウォー',
      buildPhaseMarket: false,
    })
  })

  it('零代市場種牡馬（含補公系補入的）父系留空時，改填所在系目前的子系統；有填時照填', () => {
    const rows = rowsOf({
      horses: [
        horseRow('Z3'),
        horseRow('Z5'),
        horseRow('K', { sireSystem: 'ノーザンダンサー' }),
        horseRow('G'),
      ],
      stallions: [
        stallionRow('Z3', 3, 0),
        stallionRow('Z5', 5, 0, { restorationId: 'R1' }),
        stallionRow('K', 3, 0, { status: 'retired' }),
        stallionRow('G', 3, 5),
      ],
      restorations: [restorationRow('R1', 5, 12, 'sire')],
      lines: [lineRow(3, '系3子'), lineRow(5, '系5子')],
    })
    const sireSystemOf = (id: string) => buildMating(id, undefined, rows).sire!.horse.sireSystem
    expect(sireSystemOf('Z3')).toBe('系3子')
    expect(sireSystemOf('Z5')).toBe('系5子')
    expect(sireSystemOf('K')).toBe('ノーザンダンサー')
    expect(sireSystemOf('G')).toBeUndefined()
  })

  it('建系期標記：建系的零代市場種牡馬（含替換上來的）是；補公系補入的只在產出 4 代以內是', () => {
    const rows = rowsOf({
      horses: ['Z1', 'Z1b', 'R3', 'R4', 'Z6', 'G'].map((id) => horseRow(id)),
      stallions: [
        stallionRow('Z1', 1, 0, { status: 'retired' }),
        stallionRow('Z1b', 1, 0),
        stallionRow('R3', 2, 0, { restorationId: 'RS3' }),
        stallionRow('R4', 2, 0, { restorationId: 'RS4' }),
        stallionRow('Z6', 6, 0),
        { ...stallionRow('Z6', 6, 0, { restorationId: 'RS12' }), id: 'Z6-R' },
        stallionRow('G', 1, 5),
      ],
      restorations: [
        restorationRow('RS3', 2, 3, 'sire'),
        restorationRow('RS4', 2, 4, 'sire'),
        restorationRow('RS12', 6, 12, 'sire'),
      ],
      lines: [lineRow(1, '系1子'), lineRow(2, '系2子'), lineRow(6, '系6子')],
    })
    const flagOf = (id: string) => buildMating(id, undefined, rows).sire!.horse.buildPhaseMarket
    expect(flagOf('Z1')).toBe(true)
    expect(flagOf('Z1b')).toBe(true)
    expect(flagOf('R3')).toBe(true)
    expect(flagOf('R4')).toBe(false)
    expect(flagOf('Z6')).toBe(true)
    expect(flagOf('G')).toBe(false)
  })

  it('建系期標記：母馬依目前的用途，第 1 系起點用或替代 3 代以內是', () => {
    const mares = [
      startMareRow('P'),
      substituteMareRow('S3', 2, 3),
      substituteMareRow('S4', 2, 4),
      ownMareRow('O', 1, 2),
      ungroupedMareRow('U', 'unassigned'),
    ]
    const rows = rowsOf({
      horses: [...mares.map((mare) => horseRow(mare.horseId)), horseRow('X')],
      mares,
    })
    const flagOf = (id: string) => buildMating(undefined, id, rows).dam!.horse.buildPhaseMarket
    expect(['P', 'S3', 'S4', 'O', 'U', 'X'].map(flagOf)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ])
  })

  it('交給核心推定 3 代前：零代市場種牡馬的父親用改填的子系統推定，並標示來自建系期市場馬（需求規格 10.2）', () => {
    const rows = rowsOf({
      horses: [horseRow('S', { sireId: 'Z', sireSystem: '系1子' }), horseRow('Z')],
      stallions: [stallionRow('Z', 1, 0)],
      lines: [lineRow(1, '系1子')],
    })
    expect(ancestorSlots(buildMating('S', undefined, rows), [])[0]).toEqual({
      index: 0,
      horse: null,
      subsystem: '系1子',
      inferred: true,
      fromBuildPhaseMarket: true,
    })
  })

  it('樹上的馬找不到、零代市場種牡馬所在的系沒有開啟、補公系任用找不到宣告時丟出錯誤', () => {
    expect(() =>
      buildMating('A', undefined, rowsOf({ horses: [horseRow('A', { sireId: 'B' })] })),
    ).toThrow('找不到馬匹：B')
    expect(() =>
      buildMating(
        'Z',
        undefined,
        rowsOf({ horses: [horseRow('Z')], stallions: [stallionRow('Z', 4, 0)] }),
      ),
    ).toThrow('零代市場種牡馬所在的第 4 系沒有開啟')
    expect(() =>
      buildMating(
        'Z',
        undefined,
        rowsOf({
          horses: [horseRow('Z', { sireSystem: 'ハイペリオン' })],
          stallions: [stallionRow('Z', 4, 0, { restorationId: 'R9' })],
          lines: [lineRow(4, '系4子')],
        }),
      ),
    ).toThrow('找不到補系宣告：R9')
  })
})
