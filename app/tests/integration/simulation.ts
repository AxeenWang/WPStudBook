import type { PedigreeCheck } from '../../src/domain/pedigree-check.ts';
import { saveBreeding } from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { nameFoal, registerFoal } from '../../src/services/foals.ts';
import { changeCurrentYear, createGame } from '../../src/services/games.ts';
import { openLine } from '../../src/services/lines.ts';
import { addMarketMare } from '../../src/services/mares.ts';
import { checkBreedingPedigree } from '../../src/services/pedigree-check.ts';
import { assignCurrentStallion } from '../../src/services/stallions.ts';
import { convertFoalToMare } from '../../src/services/succession.ts';
import { saveSystemMapEntry } from '../../src/services/system-map.ts';
import { loadTaskBoard, type TaskView } from '../../src/services/tasks.ts';

const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** 每一代每個系留兩匹自家母馬，下一代的任務才有母馬可配。 */
const MARES_PER_TASK = 2;

/** 八系的子系統與親系統互不相同，這是 4.3 推導 8 種活血的前提。 */
export const subsystemOf = (position: number) => `系${String(position)}`;
export const parentSystemOf = (position: number) => `親${String(position)}`;

const COLORS = [
  '#c62828',
  '#ef6c00',
  '#9e7c00',
  '#2e7d32',
  '#00838f',
  '#1565c0',
  '#6a1b9a',
  '#6d4c41',
];

/** 一代一個系的產出：兩匹母駒讓該代成立，一匹公駒接任該代現任。 */
export interface ProducedGeneration {
  readonly position: number;
  readonly generation: number;
  /** 登記這次指定配種時的血統檢查結果。 */
  readonly pedigreeCheck: PedigreeCheck;
}

export interface SimulationResult {
  readonly gameId: string;
  readonly produced: readonly ProducedGeneration[];
  readonly finalYear: number;
}

let counter = 0;
function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}${String(counter).padStart(4, '0')}`;
}

function foalInput(damId: string, birthYear: number, sex: 'male' | 'female') {
  return {
    damId,
    birthYear,
    sex,
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
  } as const;
}

/** 模擬不因血統警告停下：循環期一律確認（需求規格 10.2）。 */
const ACCEPT_ALL = ['activationBelowFull', 'duplicateAncestors', 'insufficientPedigree'] as const;

async function addMarketDam(
  context: ServiceContext,
  position: number,
  generation: number,
): Promise<void> {
  await addMarketMare(context, {
    position,
    generation,
    fullName: uniqueName('ダイヨウ'),
    abilityNo: '',
    birthYear: 1950,
    sireName: '',
    damName: '',
    // 替代第 q 系的市場母馬帶該系的自身父系，才站得住「替代」的位置（需求規格 8.3）。
    sireSubsystem: subsystemOf(position),
    femaleLine: '',
    noNamedFemaleLine: true,
    site: 32,
    origin: 'marketFound',
    originNote: '',
  });
}

/**
 * 依任務登記指定配種。第一匹母駒轉入後該代就成立，任務隨之從看板消失（需求規格 8.2、LINE-17），
 * 但同一組配對在真實遊戲裡每年都會再配；第二年的配種因此不帶任務代號，比照使用者從母馬頁登記。
 */
async function breed(
  context: ServiceContext,
  task: TaskView,
  mareIds: readonly string[],
  year: number,
  withTask: boolean,
): Promise<void> {
  for (const mareId of mareIds) {
    await saveBreeding(context, {
      mareId,
      gameYear: year,
      breedingType: 'designated',
      stallionId: task.sireId,
      stallionName: '',
      conception: '受胎',
      ...(withTask ? { taskId: task.id, acceptedWarnings: ACCEPT_ALL } : {}),
    });
  }
}

/**
 * 把這一代所有任務的缺項補到可以執行：尚未開啟的系就開，建系期用的替代母馬與起點母馬就補。
 * 自家母馬群只能由上一代產出，缺了就是模擬本身出錯，直接拋出。
 */
async function prepareGeneration(context: ServiceContext, generation: number): Promise<TaskView[]> {
  for (;;) {
    const board = await loadTaskBoard(context);
    const tasks = board.tasks.filter((task) => task.target.generation === generation);
    const needsLine = tasks.find((task) => task.blockers.includes('lineNotOpened'));
    if (needsLine !== undefined) {
      const { position } = needsLine.sire;
      await openLine(context, {
        position,
        subsystem: subsystemOf(position),
        parentSystem: parentSystemOf(position),
        color: COLORS[position - 1] ?? '#c62828',
        founder: {
          fullName: uniqueName('シュボバ'),
          abilityNo: '',
          birthYear: 1950,
          sireName: '',
          damName: '',
        },
      });
      continue;
    }
    const needsMarket = tasks.find(
      (task) => task.mares.length < MARES_PER_TASK && (task.dam.substitute || task.dam.starter),
    );
    if (needsMarket !== undefined) {
      await addMarketDam(context, needsMarket.dam.position, needsMarket.dam.generation);
      continue;
    }
    const short = tasks.find((task) => task.mares.length < MARES_PER_TASK);
    if (short !== undefined) {
      throw new Error(
        `任務 ${short.id} 只有 ${String(short.mares.length)} 匹自家母馬，上一代產出不足`,
      );
    }
    const noSire = tasks.find((task) => task.sireId === undefined);
    if (noSire !== undefined) {
      throw new Error(`任務 ${noSire.id} 缺少種牡馬（缺項 ${noSire.blockers.join(',')}）`);
    }
    return tasks;
  }
}

/**
 * 從第 1 系起點模擬到指定的產出代數（開發計畫階段 3 第 7 項、關卡 D）：
 * 依 7.3 建系（分層開啟四層分支），之後依 7.4 兩兩互換循環。每一代都重新載入任務看板取得配對，
 * 一代走兩個遊戲年：第一年配出兩匹母駒讓該代成立，第二年配出一匹公駒接任該代現任。
 */
export async function simulateEightLines(
  context: ServiceContext,
  lastGeneration: number,
): Promise<SimulationResult> {
  counter = 0;
  const game = await createGame(context, { name: '關卡 D 模擬局', startYear: 1968 });
  for (const position of POSITIONS) {
    await saveSystemMapEntry(context, {
      subsystem: subsystemOf(position),
      parentSystem: parentSystemOf(position),
    });
  }
  await openLine(context, {
    position: 1,
    subsystem: subsystemOf(1),
    parentSystem: parentSystemOf(1),
    color: COLORS[0] ?? '#c62828',
    founder: {
      fullName: uniqueName('シュボバ'),
      abilityNo: '',
      birthYear: 1950,
      sireName: '',
      damName: '',
    },
  });

  const produced: ProducedGeneration[] = [];
  let year = 1968;
  for (let generation = 1; generation <= lastGeneration; generation += 1) {
    const tasks = await prepareGeneration(context, generation);
    const dams = new Map<string, string[]>(
      tasks.map((task) => [task.id, task.mares.slice(0, MARES_PER_TASK).map((mare) => mare.id)]),
    );

    // 第一年：每個任務配兩匹母馬，隔年產出兩匹母駒並轉入，該代成立。
    for (const task of tasks) {
      produced.push({
        position: task.target.position,
        generation: task.target.generation,
        pedigreeCheck: await checkBreedingPedigree(context, {
          phase: task.phase,
          sireId: task.sireId ?? '',
          damId: dams.get(task.id)?.[0] ?? '',
        }),
      });
      await breed(context, task, dams.get(task.id) ?? [], year, true);
    }
    await changeCurrentYear(context, year + 1);
    for (const task of tasks) {
      for (const mareId of dams.get(task.id) ?? []) {
        const filly = await registerFoal(context, foalInput(mareId, year + 1, 'female'));
        await nameFoal(context, { foalId: filly.horse.id, officialName: uniqueName('ムスメ') });
        await convertFoalToMare(context, { foalId: filly.horse.id, site: 32 });
      }
    }

    // 第二年：同一批母馬再配一次，隔年產出的公駒接任該代現任。
    for (const task of tasks) {
      await breed(context, task, (dams.get(task.id) ?? []).slice(0, 1), year + 1, false);
    }
    await changeCurrentYear(context, year + 2);
    for (const task of tasks) {
      const mareId = dams.get(task.id)?.[0] ?? '';
      const colt = await registerFoal(context, foalInput(mareId, year + 2, 'male'));
      await nameFoal(context, { foalId: colt.horse.id, officialName: uniqueName('ムスコ') });
      await assignCurrentStallion(context, { horseId: colt.horse.id, stallionNo: '' });
    }
    year += 2;
  }
  return { gameId: game.id, produced, finalYear: year };
}
