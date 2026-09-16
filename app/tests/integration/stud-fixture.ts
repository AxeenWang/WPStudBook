import { saveBreeding } from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { nameFoal, registerFoal, type FoalInput } from '../../src/services/foals.ts';
import { changeCurrentYear, createGame } from '../../src/services/games.ts';
import { openLine } from '../../src/services/lines.ts';
import { addMarketMare } from '../../src/services/mares.ts';
import { convertFoalToMare } from '../../src/services/succession.ts';
import { listStallionDuties } from '../../src/storage/stallion-duties.ts';

export function foalInput(damId: string, birthYear: number, overrides: Partial<FoalInput> = {}) {
  return {
    damId,
    birthYear,
    sex: 'male',
    sireName: '',
    disposition: undefined,
    sp: undefined,
    st: undefined,
    subParams: {},
    turf: undefined,
    dirt: undefined,
    distanceText: '',
    kodashi: undefined,
    note: '',
    ...overrides,
  } satisfies FoalInput;
}

export async function addStarter(context: ServiceContext, fullName: string): Promise<string> {
  const added = await addMarketMare(context, {
    position: 1,
    generation: 0,
    fullName,
    abilityNo: '',
    birthYear: 1960,
    sireName: '',
    damName: '',
    sireSubsystem: 'マンノウォー',
    femaleLine: '',
    noNamedFemaleLine: false,
    site: 32,
    origin: 'marketFound',
    originNote: '',
  });
  return added.horse.id;
}

export interface Stud {
  readonly gameId: string;
  readonly founderId: string;
  /** 1969 年生，母 オオトリモナーコス。 */
  readonly elderId: string;
  /** 1970 年生，母 テストヒンバ（同父異母）。 */
  readonly youngerId: string;
  /** 1969 年生的母駒「テストムスメ」，已轉入第 1 系 1 代母馬群。 */
  readonly daughterId: string;
}

/**
 * 1968 年開局，第 1 系零代種牡馬（1950 年生）× 三匹起點母馬：1969 年生哥哥與母駒（母駒轉入 1 代母馬群），
 * 1970 年生同父異母的弟弟。目前遊戲年 1970。
 */
export async function raiseStud(context: ServiceContext): Promise<Stud> {
  const game = await createGame(context, { name: '種牡馬局', startYear: 1968 });
  await openLine(context, {
    position: 1,
    subsystem: 'ネアルコ',
    parentSystem: 'ネアルコ',
    color: '#c62828',
    founder: {
      fullName: 'テストシュボバ',
      abilityNo: '',
      birthYear: 1950,
      sireName: '',
      damName: '',
    },
  });
  const [founderDuty] = await listStallionDuties(context.database, game.id);
  const founderId = founderDuty?.horseId ?? '';
  const damA = await addStarter(context, 'オオトリモナーコス');
  const damB = await addStarter(context, 'テストヒンバ');
  const damC = await addStarter(context, 'テストハハウマ');
  const breed = (mareId: string, gameYear: number) =>
    saveBreeding(context, {
      mareId,
      gameYear,
      breedingType: 'designated',
      stallionId: founderId,
      stallionName: '',
      conception: '受胎',
    });
  await breed(damA, 1968);
  await breed(damC, 1968);
  await changeCurrentYear(context, 1969);
  const elder = await registerFoal(context, foalInput(damA, 1969, { sp: 70, st: 40 }));
  const daughter = await registerFoal(context, foalInput(damC, 1969, { sex: 'female' }));
  await nameFoal(context, { foalId: daughter.horse.id, officialName: 'テストムスメ' });
  await convertFoalToMare(context, { foalId: daughter.horse.id, site: 32 });
  await breed(damB, 1969);
  await changeCurrentYear(context, 1970);
  const younger = await registerFoal(context, foalInput(damB, 1970, { sp: 75, st: 55 }));
  return {
    gameId: game.id,
    founderId,
    elderId: elder.horse.id,
    youngerId: younger.horse.id,
    daughterId: daughter.horse.id,
  };
}
