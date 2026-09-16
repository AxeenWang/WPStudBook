import { describe, expect, it } from 'vitest';
import type { LinePosition } from '../../src/domain/line.ts';
import { atLastBreedingAge, type MareGroup } from '../../src/domain/mare.ts';
import {
  buildLineTasks,
  isTaskEligibleMare,
  pairedPosition,
  type LineTask,
  type TaskLine,
  type TaskMare,
  type TaskSource,
  type TaskStallion,
} from '../../src/domain/task.ts';

const RETIREMENT_AGE = 25;

function line(position: LinePosition, generations: readonly number[]): TaskLine {
  return { position, opened: true, establishedGenerations: generations };
}

/** 八個系位置：沒有列出的位置為尚未開啟。 */
function slots(opened: readonly TaskLine[]): TaskLine[] {
  return ([1, 2, 3, 4, 5, 6, 7, 8] as const).map(
    (position) =>
      opened.find((item) => item.position === position) ?? {
        position,
        opened: false,
        establishedGenerations: [],
      },
  );
}

function stallion(position: LinePosition, generation: number): TaskStallion {
  return { position, generation };
}

function ownMare(position: LinePosition, generation: number): TaskMare {
  return { group: { kind: 'own', position, generation }, status: 'producing' };
}

function substituteMare(position: LinePosition, generation: number): TaskMare {
  return { group: { kind: 'substitute', position, generation }, status: 'producing' };
}

function source(
  overrides: Partial<TaskSource> & { readonly lines: readonly TaskLine[] },
): TaskSource {
  return {
    stallions: [],
    mares: [],
    retirementAge: RETIREMENT_AGE,
    ...overrides,
  };
}

/** 「第 X 系 N 代 × 第 Y 系 M 代 → 第 Z 系 G 代」的測試用摘要。 */
function summary(task: LineTask): string {
  const { sire, dam, target } = task;
  return [
    task.kind,
    `${String(sire.position)}/${String(sire.generation)}`,
    `${String(dam.position)}/${String(dam.generation)}`,
    `${String(target.position)}/${String(target.generation)}`,
  ].join(' ');
}

function summaries(tasks: readonly LineTask[]): string[] {
  return tasks.map(summary);
}

/** 某系當種牡馬側的循環任務；建系分支不在其中。 */
function cycleSummaries(tasks: readonly LineTask[], position: LinePosition): string[] {
  return summaries(
    tasks.filter((task) => task.kind === 'cycle' && task.sire.position === position),
  );
}

function cycleTask(tasks: readonly LineTask[], position: LinePosition): LineTask | undefined {
  return tasks.find((task) => task.kind === 'cycle' && task.sire.position === position);
}

describe('兩兩互換配對（需求規格 4.3、7.3）', () => {
  it('距離 1、2、4 各自對應官方試算表的三組排列', () => {
    const positions = [1, 2, 3, 4, 5, 6, 7, 8] as const;
    expect(positions.map((position) => pairedPosition(position, 1))).toEqual([
      2, 1, 4, 3, 6, 5, 8, 7,
    ]);
    expect(positions.map((position) => pairedPosition(position, 2))).toEqual([
      3, 4, 1, 2, 7, 8, 5, 6,
    ]);
    expect(positions.map((position) => pairedPosition(position, 4))).toEqual([
      5, 6, 7, 8, 1, 2, 3, 4,
    ]);
  });

  it('互換配對是對稱的', () => {
    for (const distance of [1, 2, 4] as const) {
      for (const position of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
        expect(pairedPosition(pairedPosition(position, distance), distance)).toBe(position);
      }
    }
  });
});

describe('建系分支任務（需求規格 7.3）', () => {
  it('只開啟第 1 系時列出起點配對', () => {
    const tasks = buildLineTasks(
      source({ lines: slots([line(1, [])]), stallions: [stallion(1, 0)] }),
    );
    expect(summaries(tasks)).toEqual(['advance 1/0 1/0 1/1']);
    expect(tasks[0]?.dam.starter).toBe(true);
    expect(tasks[0]?.pairDistance).toBeUndefined();
  });

  it('[LINE-09] 產出 2 代時同時列出推進原系與建立新系兩條配對', () => {
    const tasks = buildLineTasks(
      source({
        lines: slots([line(1, [1])]),
        stallions: [stallion(1, 0), stallion(1, 1)],
        mares: [ownMare(1, 1), substituteMare(2, 1)],
      }),
    );
    expect(summaries(tasks)).toEqual(['advance 1/1 2/1 1/2', 'found 2/0 1/1 2/2']);
    expect(tasks.map((task) => task.pairDistance)).toEqual([1, 1]);
    expect(tasks[0]?.dam.substitute).toBe(true);
    expect(tasks[1]?.blockers).toEqual(['lineNotOpened']);
  });

  it('[LINE-10] 產出 3 代時第 1、2 系分出第 3、4 系', () => {
    const tasks = buildLineTasks(source({ lines: slots([line(1, [1, 2]), line(2, [2])]) }));
    expect(summaries(tasks)).toEqual([
      'advance 1/2 3/2 1/3',
      'found 3/0 1/2 3/3',
      'advance 2/2 4/2 2/3',
      'found 4/0 2/2 4/3',
    ]);
    expect(tasks.every((task) => task.pairDistance === 2)).toBe(true);
  });

  it('[LINE-10] 產出 4 代時第 1～4 系分出第 5～8 系，八系全部成立', () => {
    const tasks = buildLineTasks(
      source({ lines: slots([line(1, [1, 2, 3]), line(2, [2, 3]), line(3, [3]), line(4, [3])]) }),
    );
    expect(summaries(tasks)).toEqual([
      'advance 1/3 5/3 1/4',
      'found 5/0 1/3 5/4',
      'advance 2/3 6/3 2/4',
      'found 6/0 2/3 6/4',
      'advance 3/3 7/3 3/4',
      'found 7/0 3/3 7/4',
      'advance 4/3 8/3 4/4',
      'found 8/0 4/3 8/4',
    ]);
    expect(tasks.every((task) => task.pairDistance === 4)).toBe(true);
  });

  it('[LINE-11] 分支跨年重試時系與代數不變，也不開啟下一層', () => {
    const retrying = source({
      lines: slots([line(1, [1])]),
      stallions: [stallion(1, 1)],
      mares: [ownMare(1, 1), substituteMare(2, 1)],
    });
    expect(summaries(buildLineTasks(retrying))).toEqual([
      'advance 1/1 2/1 1/2',
      'found 2/0 1/1 2/2',
    ]);
    // 隔年重試：狀態沒變，看板也不該出現產出 3 代的分支。
    expect(buildLineTasks(retrying).some((task) => task.target.generation > 2)).toBe(false);
  });

  it('[LINE-12] 同一層分支分年開啟時，晚開分支的系與代數仍正確', () => {
    const tasks = buildLineTasks(
      source({
        lines: slots([
          line(1, [1, 2, 3, 4]),
          line(2, [2, 3]),
          line(3, [3]),
          line(4, [3]),
          line(5, [4]),
        ]),
      }),
    );
    // 第 1 系已產出 4 代、第 5 系已成立；晚開的第 2～4 系分支仍然是產出 4 代。
    expect(summaries(tasks)).toEqual([
      'advance 2/3 6/3 2/4',
      'found 6/0 2/3 6/4',
      'advance 3/3 7/3 3/4',
      'found 7/0 3/3 7/4',
      'advance 4/3 8/3 4/4',
      'found 8/0 4/3 8/4',
    ]);
  });
});

describe('循環期任務（需求規格 7.4）', () => {
  /** 第 1、2 系已走完建系，其餘六系尚未就緒。 */
  const twoLinesAtFourth: readonly TaskLine[] = [line(1, [1, 2, 3, 4]), line(2, [2, 3, 4])];

  it('[LINE-13] 第 1 系 4 代種牡馬與第 2 系 4 代母馬就緒時自動出現產出 5 代的任務', () => {
    const tasks = buildLineTasks(
      source({
        lines: slots(twoLinesAtFourth),
        stallions: [stallion(1, 4)],
        mares: [ownMare(2, 4)],
      }),
    );
    const first = cycleTask(tasks, 1);
    expect(first === undefined ? undefined : summary(first)).toBe('cycle 1/4 2/4 1/5');
    expect(first?.blockers).toEqual([]);
    expect(first?.phase).toBe('cycling');
  });

  it('[LINE-14] 產出 5 代用距離 1、6 代用 2、7 代用 4', () => {
    const positions = [1, 2, 3, 4, 5, 6, 7, 8] as const;
    const generations = [1, 2, 3, 4, 5, 6];
    const tasks = buildLineTasks(
      source({
        lines: slots(positions.map((position) => line(position, generations))),
        stallions: positions.flatMap((position) =>
          generations.map((generation) => stallion(position, generation)),
        ),
        mares: positions.flatMap((position) =>
          generations.map((generation) => ownMare(position, generation)),
        ),
      }),
    );
    expect(cycleSummaries(tasks, 1)).toEqual([
      'cycle 1/4 2/4 1/5',
      'cycle 1/5 3/5 1/6',
      'cycle 1/6 5/6 1/7',
    ]);
    expect(
      tasks
        .filter((task) => task.kind === 'cycle' && task.sire.position === 1)
        .map((task) => task.pairDistance),
    ).toEqual([1, 2, 4]);
  });

  /** 第 1 系已有 6 代，配對的第 3 系停在 5 代、第 5 系已到 6 代。 */
  const handover: readonly TaskLine[] = [
    line(1, [1, 2, 3, 4, 5, 6]),
    line(3, [3, 4, 5]),
    line(5, [4, 5, 6]),
  ];

  it('[LINE-33] 世代交接時新舊兩代任務並存', () => {
    const tasks = buildLineTasks(
      source({
        lines: slots(handover),
        stallions: [stallion(1, 5), stallion(1, 6)],
        mares: [ownMare(3, 5), ownMare(5, 6)],
      }),
    );
    expect(cycleSummaries(tasks, 1)).toEqual(['cycle 1/5 3/5 1/6', 'cycle 1/6 5/6 1/7']);
  });

  it('[LINE-33] 上一代母馬全部離圈時舊任務結束，新任務保留', () => {
    const tasks = buildLineTasks(
      source({
        lines: slots(handover),
        stallions: [stallion(1, 5), stallion(1, 6)],
        mares: [
          { group: { kind: 'own', position: 3, generation: 5 }, status: 'left' },
          ownMare(5, 6),
        ],
      }),
    );
    expect(cycleSummaries(tasks, 1)).toEqual(['cycle 1/6 5/6 1/7']);
  });

  it('[LINE-33] 上一代種牡馬退出生產行列時舊任務結束', () => {
    const tasks = buildLineTasks(
      source({
        lines: slots(handover),
        stallions: [stallion(1, 6)],
        mares: [ownMare(3, 5), ownMare(5, 6)],
      }),
    );
    expect(cycleSummaries(tasks, 1)).toEqual(['cycle 1/6 5/6 1/7']);
  });

  it('最新一代缺少現任種牡馬時任務保留並標示原因（需求規格 7.7）', () => {
    const tasks = buildLineTasks(
      source({ lines: slots(twoLinesAtFourth), mares: [ownMare(2, 4)] }),
    );
    expect(cycleTask(tasks, 1)?.blockers).toEqual(['noCurrentStallion']);
  });

  it('[LINE-16] 規則的輸入改變時未執行任務整份重算，任務代號不變', () => {
    const before = buildLineTasks(
      source({
        lines: slots(twoLinesAtFourth),
        stallions: [stallion(1, 4)],
        mares: [ownMare(2, 4)],
      }),
    );
    // 第 2 系 4 代母馬全部離圈後，同一筆任務改為標示缺少母馬。
    const after = buildLineTasks(
      source({
        lines: slots(twoLinesAtFourth),
        stallions: [stallion(1, 4)],
        mares: [{ group: { kind: 'own', position: 2, generation: 4 }, status: 'left' }],
      }),
    );
    expect(cycleTask(before, 1)?.blockers).toEqual([]);
    expect(cycleTask(after, 1)?.blockers).toEqual(['noMares']);
    expect(cycleTask(after, 1)?.id).toBe(cycleTask(before, 1)?.id);
  });
});

describe('列入任務的母馬（需求規格 8.5、8.9）', () => {
  const group: MareGroup = { kind: 'own', position: 2, generation: 4 };

  it('[MARE-11] 定年 25 歲時 24 歲提示最後配種年齡、25 歲不列入任務', () => {
    expect(atLastBreedingAge(24, RETIREMENT_AGE)).toBe(true);
    expect(atLastBreedingAge(25, RETIREMENT_AGE)).toBe(false);
    expect(isTaskEligibleMare({ group, status: 'producing', age: 24 }, RETIREMENT_AGE)).toBe(true);
    expect(isTaskEligibleMare({ group, status: 'producing', age: 25 }, RETIREMENT_AGE)).toBe(false);
  });

  it('[MARE-11] 達定年的母馬讓任務標示缺少母馬', () => {
    const tasks = buildLineTasks(
      source({
        lines: slots([line(1, [1, 2, 3, 4]), line(2, [2, 3, 4])]),
        stallions: [stallion(1, 4)],
        mares: [{ group, status: 'producing', age: 25 }],
      }),
    );
    expect(cycleTask(tasks, 1)?.blockers).toEqual(['noMares']);
  });

  it('[MARE-24] 姊妹一匹暫定保留、一匹候選時兩匹都列入任務，被取代後只剩另一匹', () => {
    const sisters: TaskMare[] = [
      { group, status: 'producing', succession: 'provisional' },
      { group, status: 'producing', succession: 'sisterCandidate' },
    ];
    expect(sisters.filter((mare) => isTaskEligibleMare(mare, RETIREMENT_AGE))).toHaveLength(2);
    const afterReplace: TaskMare[] = [
      { group, status: 'producing', succession: 'replaced' },
      { group, status: 'producing', succession: 'sisterCandidate' },
    ];
    expect(afterReplace.filter((mare) => isTaskEligibleMare(mare, RETIREMENT_AGE))).toEqual([
      afterReplace[1],
    ]);
  });

  it('正式保留與沒有接替狀態的母馬都列入任務；已售出不列入', () => {
    expect(
      isTaskEligibleMare({ group, status: 'producing', succession: 'confirmed' }, RETIREMENT_AGE),
    ).toBe(true);
    expect(isTaskEligibleMare({ group, status: 'producing' }, RETIREMENT_AGE)).toBe(true);
    expect(
      isTaskEligibleMare({ group, status: 'producing', succession: 'sold' }, RETIREMENT_AGE),
    ).toBe(false);
  });

  it('推進原系只用替代母馬，不用第 q 系的自家母馬（需求規格 7.3）', () => {
    const withOwnOnly = buildLineTasks(
      source({
        lines: slots([line(1, [1])]),
        stallions: [stallion(1, 1)],
        mares: [ownMare(2, 1), ownMare(1, 1)],
      }),
    );
    expect(withOwnOnly.find((task) => task.kind === 'advance')?.blockers).toEqual(['noMares']);
    const withSubstitute = buildLineTasks(
      source({
        lines: slots([line(1, [1])]),
        stallions: [stallion(1, 1)],
        mares: [substituteMare(2, 1), ownMare(1, 1)],
      }),
    );
    expect(withSubstitute.find((task) => task.kind === 'advance')?.blockers).toEqual([]);
  });
});
