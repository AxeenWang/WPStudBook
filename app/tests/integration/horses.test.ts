import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/services/games.ts';
import {
  findHorseByIdentity,
  findHorsesByName,
  getHorse,
  horseNameKeys,
  withHorseNameKeys,
} from '../../src/storage/horses.ts';
import { useServiceContexts } from './helpers.ts';

const HORSE = {
  id: 'h1',
  sex: 'female',
  abilityNo: 0,
  birthYear: 1962,
  fullName: '(外)テストウマ',
  baseName: 'テストウマ',
  officialName: 'テストウマ',
  stageNumbers: [],
  aliases: [
    { kind: 'manual', name: 'キュウメイ', gameYear: 1968 },
    { kind: 'imported', name: '', gameYear: 1969 },
  ],
};

describe('馬匹名稱索引', () => {
  const openContext = useServiceContexts();

  it('nameKeys 收錄完整馬名、基本馬名、正式馬名與別名，去除重複與空字串', () => {
    expect(horseNameKeys('g1', HORSE)).toEqual([
      'g1\u001f(外)テストウマ',
      'g1\u001fテストウマ',
      'g1\u001fキュウメイ',
    ]);
    expect(withHorseNameKeys('g1', { ...HORSE, nameKeys: ['old'] })).toMatchObject({
      gameId: 'g1',
      nameKeys: ['g1\u001f(外)テストウマ', 'g1\u001fテストウマ', 'g1\u001fキュウメイ'],
    });
  });

  it('nameKeys 的名稱去除前後空白，只有空白的名稱不收錄；紀錄本身的名稱保留原文', () => {
    const horse = {
      ...HORSE,
      officialName: '  ',
      aliases: [
        { kind: 'manual', name: ' キュウメイ ', gameYear: 1968 },
        { kind: 'imported', name: 'キュウメイ', gameYear: 1969 },
        { kind: 'imported', name: ' ', gameYear: 1970 },
      ],
    };

    expect(horseNameKeys('g1', horse)).toEqual([
      'g1\u001f(外)テストウマ',
      'g1\u001fテストウマ',
      'g1\u001fキュウメイ',
    ]);
    expect(withHorseNameKeys('g1', horse)).toMatchObject({
      officialName: '  ',
      aliases: horse.aliases,
    });
  });

  it('精確名稱查詢忽略前後空白：以前後有空白的文字或別名都能找到', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    const horse = {
      ...HORSE,
      aliases: [{ kind: 'manual', name: ' ベツメイ ', gameYear: 1968 }],
    };
    await context.database.put('horses', withHorseNameKeys(game.id, horse));

    const idsOf = async (name: string) =>
      (await findHorsesByName(context.database, game.id, name)).map((h) => h.id);
    expect(await idsOf('ベツメイ')).toEqual(['h1']);
    expect(await idsOf(' テストウマ ')).toEqual(['h1']);
    expect(await idsOf('  ')).toEqual([]);
    expect(await getHorse(context.database, game.id, 'h1')).toEqual(horse);
  });

  it('名稱與能力番号查詢只找同一局的馬，讀出的紀錄不含 gameId 與 nameKeys', async () => {
    const context = await openContext();
    const first = await createGame(context, { name: '第一局', startYear: 1968 });
    const second = await createGame(context, { name: '第二局', startYear: 1968 });
    await context.database.put('horses', withHorseNameKeys(first.id, HORSE));
    await context.database.put('horses', withHorseNameKeys(second.id, { ...HORSE, id: 'h2' }));

    expect(
      (await findHorsesByName(context.database, first.id, 'キュウメイ')).map((h) => h.id),
    ).toEqual(['h1']);
    expect(await findHorsesByName(context.database, first.id, 'テスト')).toEqual([]);
    expect((await findHorseByIdentity(context.database, second.id, 0, 1962))?.id).toBe('h2');
    expect(await findHorseByIdentity(context.database, second.id, 0, 1963)).toBeUndefined();
    expect(await getHorse(context.database, second.id, 'h2')).toEqual({ ...HORSE, id: 'h2' });
    expect(await getHorse(context.database, second.id, 'h1')).toBeUndefined();
  });
});
