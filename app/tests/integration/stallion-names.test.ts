import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import type { StallionDuty } from '../../src/domain/stallion-duty.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import { matchStallionNames } from '../../src/services/stallion-names.ts';
import { horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'male', stageNumbers: [], aliases: [], ...overrides };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'stallionDuties',
  records: readonly object[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    collection,
    records.map((record) =>
      collection === 'horses'
        ? { ...record, nameKeys: horseNameKeys(gameId, record) }
        : { ...record },
    ),
  );
}

const DUTY: StallionDuty = {
  id: 'd-1',
  position: 1,
  generation: 0,
  horseId: 'duty-1',
  role: 'current',
  dutyStatus: 'onDuty',
  startYear: 1968,
};

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '名稱對照局', startYear: 1968 });
  return game.id;
}

describe('父馬名稱對照（需求規格 11.8）', () => {
  const openContext = useServiceContexts();

  it('唯一對應到一筆種牡馬紀錄時連結內部識別', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      // 出現在五月種牡馬總表的市場種牡馬。
      horse({ id: 'mkt-1', fullName: 'テストウマ001', stallionListing: { lastSeenYear: 1968 } }),
      // 自家產駒已登記成為種牡馬。
      horse({
        id: 'own-1',
        fullName: 'テストジカ001',
        fate: { kind: 'becameStallion', gameYear: 1967 },
      }),
      // 只有八系任期、沒有在表紀錄也沒有去向的零代市場種牡馬。
      horse({ id: 'duty-1', fullName: 'テストシュボバ' }),
    ]);
    await seed(context, gameId, 'stallionDuties', [DUTY]);

    const matched = await matchStallionNames(context.database, gameId, [
      'テストウマ001',
      'テストジカ001',
      'テストシュボバ',
    ]);
    expect(Object.fromEntries(matched)).toEqual({
      テストウマ001: 'mkt-1',
      テストジカ001: 'own-1',
      テストシュボバ: 'duty-1',
    });
  });

  it('對應不到或同名多筆時不連結，由呼叫端保留外部名稱', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({ id: 's-1', fullName: 'カブリナマエ', stallionListing: { lastSeenYear: 1968 } }),
      horse({ id: 's-2', fullName: 'カブリナマエ', stallionListing: { lastSeenYear: 1968 } }),
    ]);

    const matched = await matchStallionNames(context.database, gameId, [
      'カブリナマエ',
      'イナイウマ',
    ]);
    expect(matched.size).toBe(0);
  });

  it('同名的繁殖牝馬或競走馬不算種牡馬紀錄', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({ id: 'mare-1', sex: 'female', fullName: 'テストメス001' }),
      horse({ id: 'colt-1', fullName: 'テストコマ001' }),
    ]);

    const matched = await matchStallionNames(context.database, gameId, [
      'テストメス001',
      'テストコマ001',
    ]);
    expect(matched.size).toBe(0);
  });

  it('比對忽略前後空白，也認得基本馬名與正式馬名', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'mkt-1',
        fullName: '(外)テストウマ002',
        baseName: 'テストウマ002',
        officialName: 'セイシキメイ',
        stallionListing: { lastSeenYear: 1968 },
      }),
    ]);

    const matched = await matchStallionNames(context.database, gameId, [
      ' (外)テストウマ002 ',
      'テストウマ002',
      'セイシキメイ',
      '',
    ]);
    expect(matched.get('(外)テストウマ002')).toBe('mkt-1');
    expect(matched.get('テストウマ002')).toBe('mkt-1');
    expect(matched.get('セイシキメイ')).toBe('mkt-1');
    expect(matched.size).toBe(3);
  });
});
