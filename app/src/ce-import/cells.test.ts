import { describe, expect, it } from 'vitest'
import { headerCells, rowCells, type ImportProblem } from './cells'

function cellsOf(...fields: string[]) {
  const problems: ImportProblem[] = []
  return { cells: rowCells(fields, 5, problems), problems }
}

describe('headerCells', () => {
  it('要讀的位置的欄名相符時沒有問題', () => {
    const problems: ImportProblem[] = []
    const cells = headerCells(['馬名', '国', '年', ''], problems)
    cells.text(1, '馬名')
    cells.integer(3, '年')
    expect(problems).toStrictEqual([])
  })

  it('欄名不符時記下第幾欄、應有的欄名與檔案裡的欄名', () => {
    const problems: ImportProblem[] = []
    const cells = headerCells(['馬名', '国', 'SP', ''], problems)
    cells.text(1, '馬名')
    cells.sex(3, '性')
    expect(problems).toStrictEqual([
      { reason: 'header', line: 1, column: 3, header: '性', value: 'SP' },
    ])
  })
})

describe('rowCells', () => {
  it('文字原樣保留，不修剪', () => {
    const { cells, problems } = cellsOf(' (外)アオバ ', '')
    expect(cells.text(1, '馬名')).toBe(' (外)アオバ ')
    expect(cells.text(2, '父馬')).toBe('')
    expect(problems).toStrictEqual([])
  })

  it('整數帶括號附加值時取括號前的主值', () => {
    const { cells, problems } = cellsOf('72', '72(72)', '42( +0)', '0')
    expect([1, 2, 3, 4].map((column) => cells.integer(column, 'SP'))).toStrictEqual([72, 72, 42, 0])
    expect(problems).toStrictEqual([])
  })

  it('整數欄不是 0 以上的整數時記下第幾行、第幾欄、欄名與值', () => {
    const { cells, problems } = cellsOf('', '-1', '7.5', ' 72', '(72)', '72x', '72(72')
    for (const column of [1, 2, 3, 4, 5, 6, 7]) cells.integer(column, 'SP')
    expect(problems[0]).toStrictEqual({
      reason: 'value',
      line: 5,
      column: 1,
      header: 'SP',
      value: '',
    })
    expect(problems.map((problem) => problem.value)).toStrictEqual([
      '',
      '-1',
      '7.5',
      ' 72',
      '(72)',
      '72x',
      '72(72',
    ])
  })

  it('番号欄空白時是 null，有值時要是 0 以上的整數', () => {
    const { cells, problems } = cellsOf('', '32', '0', 'x')
    expect([1, 2, 3].map((column) => cells.code(column, '牧場'))).toStrictEqual([null, 32, 0])
    expect(cells.code(4, '牧場')).toBeNull()
    expect(problems).toStrictEqual([
      { reason: 'value', line: 5, column: 4, header: '牧場', value: 'x' },
    ])
  })

  it('副能力等級帶括號附加值時取括號前的主值，不是等級時記下問題', () => {
    const { cells, problems } = cellsOf('B', 'B+(0)', 'S+', 'G', 'Z', '')
    expect([1, 2, 3, 4].map((column) => cells.grade(column, '力'))).toStrictEqual([
      'B',
      'B+',
      'S+',
      'G',
    ])
    cells.grade(5, '力')
    cells.grade(6, '力')
    expect(problems.map((problem) => problem.value)).toStrictEqual(['Z', ''])
  })

  it('芝、ダ適性只接受 ◎○△×', () => {
    const { cells, problems } = cellsOf('◎', '○', '△', '×', '〇', '')
    expect([1, 2, 3, 4].map((column) => cells.aptitude(column, '芝'))).toStrictEqual([
      '◎',
      '○',
      '△',
      '×',
    ])
    cells.aptitude(5, '芝')
    cells.aptitude(6, '芝')
    expect(problems.map((problem) => problem.value)).toStrictEqual(['〇', ''])
  })

  it('性別：牡為 male，牝為 female，其他記下問題', () => {
    const { cells, problems } = cellsOf('牡', '牝', 'せん')
    expect(cells.sex(1, '性')).toBe('male')
    expect(cells.sex(2, '性')).toBe('female')
    cells.sex(3, '性')
    expect(problems.map((problem) => problem.value)).toStrictEqual(['せん'])
  })

  it('活力是 0～100 的整數，前置 * 表示増強', () => {
    const { cells, problems } = cellsOf('80', '*80', '100', '*100', '0')
    expect([1, 2, 3, 4, 5].map((column) => cells.vigor(column, '活力'))).toStrictEqual([
      { value: 80, boosted: false },
      { value: 80, boosted: true },
      { value: 100, boosted: false },
      { value: 100, boosted: true },
      { value: 0, boosted: false },
    ])
    expect(problems).toStrictEqual([])
  })

  it('活力超過 100、星號不只一個或不是整數時記下問題', () => {
    const { cells, problems } = cellsOf('101', '**5', '5*', '')
    for (const column of [1, 2, 3, 4]) cells.vigor(column, '活力')
    expect(problems.map((problem) => problem.value)).toStrictEqual(['101', '**5', '5*', ''])
  })

  it('能力番号與馬番号統一寫法，格式不符時記下問題', () => {
    const { cells, problems } = cellsOf('0x30f', '0x0000', 'abc', '')
    expect(cells.number(1, '能力番号')).toBe('0x030F')
    expect(cells.number(2, '能力番号')).toBe('0x0000')
    cells.number(3, '能力番号')
    cells.number(4, '馬番号')
    expect(problems.map((problem) => problem.value)).toStrictEqual(['abc', ''])
  })

  it('父系去掉結尾「系」，空白時是 null', () => {
    const { cells, problems } = cellsOf('エクリプス系', '')
    expect(cells.sireSystem(1, '父系')).toBe('エクリプス')
    expect(cells.sireSystem(2, '父系')).toBeNull()
    expect(problems).toStrictEqual([])
  })
})
