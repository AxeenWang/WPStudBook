import { describe, expect, it } from 'vitest'
import { importRecord } from '../../tests/support/imports'
import { GAME } from '../../tests/support/rows'
import type { ImportCheckpoint, ImportSnapshot, ImportType } from '../core/imports'
import {
  buildImportPlan,
  hashImportFile,
  judgeImport,
  type ImportFile,
  type ImportJudgment,
  type ReadyImport,
} from './flow'

/** 快照：目前遊戲年 1970，沒有匯入紀錄與檢查點；其他欄位依需要覆寫 */
function snapshot(fields: Partial<ImportSnapshot> = {}): ImportSnapshot {
  return {
    gameId: GAME,
    currentYear: 1970,
    updatedAt: '2026-10-01T00:00:00.000Z',
    imports: [],
    checkpoints: [],
    ...fields,
  }
}

/** 要判斷的檔案：雜湊預設為 new */
function file(type: ImportType, year: number, fields: Partial<ImportFile> = {}): ImportFile {
  return { fileName: `${year}_${type}.txt`, sha256: 'new', type, year, ...fields }
}

/** 判斷結果要是 ready；不是時讓測試失敗 */
function ready(judgment: ImportJudgment): ReadyImport {
  if (judgment.kind !== 'ready') throw new Error(judgment.kind)
  return judgment
}

/** 1970 年一月與五月已匯入，目前進度是 1970 年 5 月 1 週 */
const PROGRESS_MAY_1970 = [
  importRecord('J70', 'january-two-year-olds', 1970),
  importRecord('M70', 'may-herd', 1970),
]

describe('hashImportFile', () => {
  it('檔案原始位元組的 SHA-256，小寫十六進位', async () => {
    expect(await hashImportFile(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('judgeImport：年度匯入', () => {
  it('還沒匯入過、晚於目前進度時一般套用；時點依類型固定', () => {
    const records = [importRecord('J70', 'january-two-year-olds', 1970)]
    const target = file('may-herd', 1970)
    expect(judgeImport(target, snapshot({ imports: records }))).toStrictEqual({
      kind: 'ready',
      gameId: GAME,
      expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
      file: target,
      timing: { month: 5, week: 1 },
      options: ['normal'],
      warnings: [],
      hints: [],
    })
    expect(ready(judgeImport(file('april-foals', 1968), snapshot())).options).toEqual(['normal'])
  })

  it('IMP-07 同類型、同年、同時點已匯入過，雜湊相同時是重複', () => {
    const records = [
      ...PROGRESS_MAY_1970,
      importRecord('M69', 'may-herd', 1969, { sha256: 'same' }),
    ]
    expect(
      judgeImport(file('may-herd', 1969, { sha256: 'same' }), snapshot({ imports: records })),
    ).toStrictEqual({ kind: 'duplicate', record: records[2] })
    // 同類型、雜湊相同但不同年：不是同一組
    const other = ready(
      judgeImport(file('may-herd', 1968, { sha256: 'same' }), snapshot({ imports: records })),
    )
    expect(other.options).toEqual(['rollback', 'catch-up'])
  })

  it('IMP-08 同一組已匯入過、雜湊不同時資料更正，指向同一組最新的一筆', () => {
    const judgment = ready(
      judgeImport(file('may-herd', 1970), snapshot({ imports: PROGRESS_MAY_1970 })),
    )
    expect(judgment).toMatchObject({ options: ['correction'], corrects: 'M70' })
    expect(judgment).not.toHaveProperty('recommendedCheckpoint')
  })

  it('重複只和同一組最新的一筆比：先匯入 A、更正成 B，再匯入 A 是更正回 A', () => {
    const records = [
      importRecord('B', 'may-herd', 1970, {
        sha256: 'b',
        mode: 'correction',
        corrects: 'A',
        appliedAt: '2026-10-01T00:00:02.000Z',
      }),
      importRecord('A', 'may-herd', 1970, { sha256: 'a', appliedAt: '2026-10-01T00:00:01.000Z' }),
    ]
    const again = ready(
      judgeImport(file('may-herd', 1970, { sha256: 'a' }), snapshot({ imports: records })),
    )
    expect(again).toMatchObject({ options: ['correction'], corrects: 'B' })
    expect(
      judgeImport(file('may-herd', 1970, { sha256: 'b' }), snapshot({ imports: records })),
    ).toStrictEqual({ kind: 'duplicate', record: records[0] })
  })

  it('IMP-09、IMP-20 還沒匯入過、早於目前進度時提供回溯與直接補匯', () => {
    const judgment = ready(
      judgeImport(file('april-foals', 1970), snapshot({ imports: PROGRESS_MAY_1970 })),
    )
    expect(judgment.options).toEqual(['rollback', 'catch-up'])
    expect(judgment).not.toHaveProperty('corrects')
  })

  it('IMP-21 早於目前進度、而且同一組已匯入過時只提供回溯與資料更正', () => {
    const judgment = ready(
      judgeImport(file('january-two-year-olds', 1970), snapshot({ imports: PROGRESS_MAY_1970 })),
    )
    expect(judgment).toMatchObject({ options: ['rollback', 'correction'], corrects: 'J70' })
  })

  it('IMP-16 同一時點的不同類型各自判斷，不算重複', () => {
    const records = [importRecord('M70', 'may-herd', 1970, { sha256: 'same' })]
    const judgment = ready(
      judgeImport(
        file('stallion-list', 1970, { sha256: 'same', fileTiming: { month: 5, week: 1 } }),
        snapshot({ imports: records }),
      ),
    )
    expect(judgment.options).toEqual(['normal'])
  })

  it('檔名的時點和類型固定的時點不同時只提示，紀錄的時點仍依類型', () => {
    const judgment = ready(
      judgeImport(file('may-herd', 1970, { fileTiming: { month: 5, week: 2 } }), snapshot()),
    )
    expect(judgment).toMatchObject({
      timing: { month: 5, week: 1 },
      options: ['normal'],
      hints: [
        {
          kind: 'timing-mismatch',
          fileTiming: { month: 5, week: 2 },
          timing: { month: 5, week: 1 },
        },
      ],
    })
    const same = ready(
      judgeImport(file('may-herd', 1970, { fileTiming: { month: 5, week: 1 } }), snapshot()),
    )
    expect(same.hints).toEqual([])
  })

  it('年份不是整數時丟出 RangeError', () => {
    expect(() => judgeImport(file('may-herd', 1970.5), snapshot())).toThrow('年份不是整數：1970.5')
  })
})

describe('judgeImport：回溯推薦的檢查點', () => {
  /** 檢查點的摘要 */
  const checkpoint = (
    id: string,
    year: number,
    timing: ImportCheckpoint['timing'],
    createdAt: string,
  ): ImportCheckpoint => ({ id, year, ...(timing ? { timing } : {}), createdAt })

  it('年與時點早於這份檔案的檢查點中最晚的一個，一樣時取建立時間最新的；沒有時點的不推薦', () => {
    const checkpoints = [
      // 系統時鐘往回調過：建立時間最新，但年與時點較早
      checkpoint('C69', 1969, { month: 7, week: 1 }, '2026-10-01T09:00:00.000Z'),
      checkpoint('C70a', 1970, { month: 1, week: 1 }, '2026-10-01T00:00:01.000Z'),
      checkpoint('C70b', 1970, { month: 1, week: 1 }, '2026-10-01T00:00:02.000Z'),
      checkpoint('C70c', 1970, { month: 1, week: 1 }, '2026-10-01T00:00:00.500Z'),
      // 不早於這份檔案（1970 年 4 月 1 週）
      checkpoint('C70May', 1970, { month: 5, week: 1 }, '2026-10-01T00:00:03.000Z'),
      checkpoint('C70Apr', 1970, { month: 4, week: 1 }, '2026-10-01T00:00:04.000Z'),
      // 手動建立、沒有時點
      checkpoint('Manual', 1970, undefined, '2026-10-01T00:00:05.000Z'),
    ]
    const judgment = ready(
      judgeImport(file('april-foals', 1970), snapshot({ imports: PROGRESS_MAY_1970, checkpoints })),
    )
    expect(judgment.recommendedCheckpoint).toBe('C70b')
  })

  it('找不到可推薦的檢查點時仍提供回溯，只是沒有推薦', () => {
    const checkpoints = [checkpoint('Manual', 1970, undefined, '2026-10-01T00:00:05.000Z')]
    const judgment = ready(
      judgeImport(file('april-foals', 1970), snapshot({ imports: PROGRESS_MAY_1970, checkpoints })),
    )
    expect(judgment.options).toContain('rollback')
    expect(judgment).not.toHaveProperty('recommendedCheckpoint')
  })

  it('不提供回溯時不推薦', () => {
    const checkpoints = [checkpoint('C', 1970, { month: 1, week: 1 }, '2026-10-01T00:00:01.000Z')]
    const judgment = ready(
      judgeImport(
        file('july-conception', 1970),
        snapshot({ imports: PROGRESS_MAY_1970, checkpoints }),
      ),
    )
    expect(judgment.options).toEqual(['normal'])
    expect(judgment).not.toHaveProperty('recommendedCheckpoint')
  })
})

describe('judgeImport：選用與累加匯入', () => {
  it('選用匯入：同一組（同年、同檔名時點）比雜湊，不看目前進度、不提示回溯', () => {
    const records = [
      ...PROGRESS_MAY_1970,
      importRecord('O69', 'october-mares', 1969, { timing: { month: 10, week: 1 }, sha256: 'o' }),
      importRecord('S69', 'stallion-list', 1969, { sha256: 's' }),
    ]
    const october = (sha256: string, fileTiming = { month: 10, week: 1 }) =>
      judgeImport(
        file('october-mares', 1969, { sha256, fileTiming }),
        snapshot({ imports: records }),
      )
    expect(october('o')).toStrictEqual({ kind: 'duplicate', record: records[2] })
    expect(ready(october('x'))).toMatchObject({
      timing: { month: 10, week: 1 },
      options: ['correction'],
      corrects: 'O69',
    })
    expect(ready(october('o', { month: 10, week: 2 })).options).toEqual(['normal'])
    // 一邊有時點、一邊沒有：不是同一組
    const untimed = judgeImport(
      file('october-mares', 1969, { sha256: 'o' }),
      snapshot({ imports: records }),
    )
    expect(ready(untimed).options).toEqual(['normal'])
    // 檔名解析不了、沒有時點的也是一組
    expect(
      judgeImport(file('stallion-list', 1969, { sha256: 's' }), snapshot({ imports: records })),
    ).toStrictEqual({ kind: 'duplicate', record: records[3] })
    const listed = ready(judgeImport(file('stallion-list', 1969), snapshot({ imports: records })))
    expect(listed.options).toEqual(['correction'])
    expect(listed).not.toHaveProperty('timing')
  })

  it('IMP-19 累加匯入：這一局同類型的任何一筆雜湊相同時重複，其他一律一般套用，不提示回溯', () => {
    const records = [
      ...PROGRESS_MAY_1970,
      importRecord('C68', 'candidates', 1968, { sha256: 'c' }),
      importRecord('T70', 'target-stallion', 1970, { sha256: 't' }),
    ]
    const candidates = (sha256: string, year: number) =>
      judgeImport(file('candidates', year, { sha256 }), snapshot({ imports: records }))
    expect(candidates('c', 1969)).toStrictEqual({ kind: 'duplicate', record: records[2] })
    expect(ready(candidates('t', 1968)).options).toEqual(['normal'])
    expect(ready(candidates('x', 1968)).options).toEqual(['normal'])
  })
})

describe('judgeImport：推進年份', () => {
  it('IMP-14 檔案年份晚於目前遊戲年時要推進；IMP-15 晚兩年以上另附警告', () => {
    expect(ready(judgeImport(file('january-two-year-olds', 1971), snapshot()))).toMatchObject({
      advanceYear: 1971,
      warnings: [],
    })
    expect(ready(judgeImport(file('candidates', 1972), snapshot()))).toMatchObject({
      advanceYear: 1972,
      warnings: [{ kind: 'year-far-ahead', from: 1970, to: 1972 }],
    })
    const current = ready(judgeImport(file('may-herd', 1970), snapshot()))
    expect(current).not.toHaveProperty('advanceYear')
    expect(current.warnings).toEqual([])
  })
})

describe('buildImportPlan', () => {
  const content = { summary: { total: 3, applied: 0, skipped: 3 }, items: [] }

  it('一般套用：計畫帶判斷的檔案、時點與快照的更新時間', () => {
    const judgment = ready(judgeImport(file('may-herd', 1970), snapshot()))
    expect(buildImportPlan(judgment, { mode: 'normal' }, content)).toStrictEqual({
      gameId: GAME,
      expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
      type: 'may-herd',
      year: 1970,
      timing: { month: 5, week: 1 },
      fileName: '1970_may-herd.txt',
      sha256: 'new',
      mode: 'normal',
      summary: content.summary,
      items: [],
    })
  })

  it('資料更正帶被更正的那一筆；直接補匯不帶', () => {
    const records = PROGRESS_MAY_1970
    const correction = ready(
      judgeImport(file('january-two-year-olds', 1970), snapshot({ imports: records })),
    )
    expect(buildImportPlan(correction, { mode: 'correction' }, content)).toMatchObject({
      mode: 'correction',
      corrects: 'J70',
    })
    const catchUp = ready(judgeImport(file('april-foals', 1970), snapshot({ imports: records })))
    const plan = buildImportPlan(catchUp, { mode: 'catch-up' }, content)
    expect(plan.mode).toBe('catch-up')
    expect(plan).not.toHaveProperty('corrects')
  })

  it('確認推進時帶推進到的年份與確認過的警告；沒有檔名時點的選用匯入不帶時點', () => {
    const judgment = ready(judgeImport(file('stallion-list', 1972), snapshot()))
    const plan = buildImportPlan(judgment, { mode: 'normal', advanceConfirmed: true }, content)
    expect(plan).toMatchObject({
      advanceYear: 1972,
      confirmedWarnings: [{ kind: 'year-far-ahead', from: 1970, to: 1972 }],
    })
    expect(plan).not.toHaveProperty('timing')
    const near = ready(judgeImport(file('may-herd', 1971), snapshot()))
    expect(
      buildImportPlan(near, { mode: 'normal', advanceConfirmed: true }, content),
    ).not.toHaveProperty('confirmedWarnings')
  })

  it('選了判斷沒有提供的做法，或需要推進而沒有確認時丟出 RangeError', () => {
    const earlier = ready(
      judgeImport(file('april-foals', 1970), snapshot({ imports: PROGRESS_MAY_1970 })),
    )
    expect(() => buildImportPlan(earlier, { mode: 'normal' }, content)).toThrow(
      '這份檔案不能選這種套用方式：normal',
    )
    const ahead = ready(judgeImport(file('may-herd', 1971), snapshot()))
    expect(() => buildImportPlan(ahead, { mode: 'normal' }, content)).toThrow(
      '要先確認推進到 1971 年',
    )
    expect(() =>
      buildImportPlan(ahead, { mode: 'normal', advanceConfirmed: false }, content),
    ).toThrow(RangeError)
  })
})
