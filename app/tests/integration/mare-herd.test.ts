import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/services/games.ts';
import { DEFAULT_MARE_FILTER, matchesMareFilter } from '../../src/services/mare-list.ts';
import { addMarketMare, loadMareHerd, type MarketMareInput } from '../../src/services/mares.ts';
import { putRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';

const STARTER: MarketMareInput = {
  position: 1,
  generation: 0,
  fullName: '(外)テストヒンバ',
  abilityNo: '',
  birthYear: 1950,
  sireName: '',
  damName: '',
  sireSubsystem: '',
  femaleLine: '',
  noNamedFemaleLine: false,
  site: 32,
  origin: 'marketFound',
  originNote: '',
};

describe('母馬群清單資料', () => {
  const openContext = useServiceContexts();

  it('組合母馬、馬名、今年年度資料、本年度受胎與提醒設定', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    const first = await addMarketMare(context, STARTER);
    const second = await addMarketMare(context, {
      ...STARTER,
      position: 2,
      generation: 1,
      fullName: 'テストカワリ',
      birthYear: undefined,
    });
    await putRecords(context.database, game.id, 'mareYearly', [
      {
        id: 'y-1967',
        horseId: first.horse.id,
        gameYear: 1967,
        vitalityJuly: { state: 'confirmed', value: 90, boosted: false },
        kodashi: 11,
      },
      {
        id: 'y-1968',
        horseId: first.horse.id,
        gameYear: 1968,
        vitalityMay: { state: 'confirmed', value: 73, boosted: false },
      },
    ]);
    await putRecords(context.database, game.id, 'breedings', [
      { id: 'b-1967', mareId: first.horse.id, gameYear: 1967, conception: '不受胎' },
      { id: 'b-1968', mareId: first.horse.id, gameYear: 1968, conception: '受胎' },
    ]);

    const herd = await loadMareHerd(context);

    expect(herd).toMatchObject({
      currentYear: 1968,
      highAgeReminderAge: 18,
      vitalityThreshold: undefined,
      openedPositions: [],
    });
    expect(herd.cards).toHaveLength(2);
    expect(herd.cards[0]).toMatchObject({
      id: first.horse.id,
      name: '(外)テストヒンバ',
      age: 18,
      highAge: true,
      vitality: { vitality: { state: 'confirmed', value: 73, boosted: false }, month: 5 },
      conception: '受胎',
      kodashi: { value: 11, gameYear: 1967 },
    });
    expect(herd.cards[1]).toMatchObject({
      id: second.horse.id,
      name: 'テストカワリ',
      group: { kind: 'substitute', position: 2, generation: 1 },
      generation: 0,
      vitality: { vitality: { state: 'pending' } },
      conception: undefined,
    });
    expect(
      herd.cards
        .filter((item) =>
          matchesMareFilter(item, { position: 2, generation: 1 }, DEFAULT_MARE_FILTER),
        )
        .map((item) => item.id),
    ).toEqual([second.horse.id]);
  });
});
