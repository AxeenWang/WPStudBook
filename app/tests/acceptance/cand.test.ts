import { describe, expect, it } from 'vitest'
import { returnMare } from '../../src/storage/herd-writes'
import { addTestGame, testDatabase } from '../support/database'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  stallionRow,
  substituteMareRow,
} from '../support/rows'

// 需求規格第 15 章「候選 TXT（CAND）」中由儲存層寫入負責的部分；解析、預覽與勾選由 CE 匯入計畫補上

describe('候選 TXT（CAND）：儲存層寫入', () => {
  it('CAND-07 已售出的母馬出現在候選 TXT → 恢復生產中並建立回歸事件；自家母駒沿用原系與代數，市場母馬改用這次配對的用途並記原用途與新用途', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('S11', 1, 1)])
    await db.horses.bulkAdd([horseRow('M'), horseRow('A', { sireId: 'S', damId: 'D' })])
    await db.mares.bulkAdd([
      substituteMareRow('M', 5, 3, { herd: 'sold' }),
      ownMareRow('A', 1, 3, { sisterStatus: 'kept', herd: 'sold' }),
    ])
    const assignment = { kind: 'pairing' as const, line: 1 as const, generation: 2 }
    const market = await returnMare(db, GAME, 'M', { assignment })
    expect(market.status === 'done' && market.value.mare).toMatchObject({
      herd: 'in-herd',
      usage: 'substitute',
      groupLine: 2,
      groupGeneration: 1,
    })
    const own = await returnMare(db, GAME, 'A')
    expect(own.status === 'done' && own.value.mare).toMatchObject({
      herd: 'in-herd',
      groupLine: 1,
      groupGeneration: 3,
    })
    const eventsOf = (horseId: string) =>
      db.events.where('[gameId+horseId]').equals([GAME, horseId]).toArray()
    expect(await eventsOf('M')).toMatchObject([
      {
        kind: 'mare-returned',
        usage: {
          from: { usage: 'substitute', groupLine: 5, groupGeneration: 3 },
          to: { usage: 'substitute', groupLine: 2, groupGeneration: 1 },
        },
      },
    ])
    expect(await eventsOf('A')).toMatchObject([{ kind: 'mare-returned' }])
  })
})
