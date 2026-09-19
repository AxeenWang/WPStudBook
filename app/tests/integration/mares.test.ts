import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import { exportBackup, restoreBackupAsNewGame } from '../../src/services/backup.ts';
import { createGame, getCurrentGame } from '../../src/services/games.ts';
import { openLine, type OpenLineInput } from '../../src/services/lines.ts';
import {
  addMarketMare,
  checkAddMarketMare,
  defaultOriginFor,
  type MarketMareInput,
} from '../../src/services/mares.ts';
import { saveSystemMapEntry } from '../../src/services/system-map.ts';
import { countGameRecords } from '../../src/storage/games.ts';
import { insertMare } from '../../src/storage/mares.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { stripNameKeys } from '../fixtures/synthetic-game.ts';
import { useServiceContexts } from './helpers.ts';

const LINE_INPUT: OpenLineInput = {
  position: 1,
  subsystem: 'ネアルコ',
  parentSystem: 'ネアルコ',
  color: '#c62828',
  founder: { fullName: 'テストシュボバ', abilityNo: '', sireName: '', damName: '' },
};

const MARE_INPUT: MarketMareInput = {
  position: 1,
  generation: 0,
  fullName: ' (外)テストヒンバ ',
  abilityNo: '0x030F',
  birthYear: 1960,
  sireName: 'ソトノチチ',
  damName: ' ソトノハハ ',
  sireSubsystem: 'マンノウォー系',
  femaleLine: ' テストケイ ',
  noNamedFemaleLine: false,
  site: 32,
  origin: 'marketFound',
  originNote: ' セール購入 ',
};

/** 只填必要欄位的替代母馬。 */
function substituteInput(
  position: number,
  generation: number,
  fullName: string,
  overrides: Partial<MarketMareInput> = {},
): MarketMareInput {
  return {
    ...MARE_INPUT,
    position,
    generation,
    fullName,
    abilityNo: '',
    birthYear: undefined,
    sireName: '',
    damName: '',
    sireSubsystem: '',
    femaleLine: '',
    originNote: '',
    ...overrides,
  };
}

const TOUCH = { updatedAt: '2026-09-15T01:00:00.000Z', appVersion: '9.9.9' };

describe('新增市場母馬', () => {
  const openContext = useServiceContexts();

  it('[MARE-01][LINE-07] 只有第 1 系時可新增起點母馬與不同代數的替代母馬，市場母馬記為起點用或替代', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    // createGame 用掉 id-0001；openLine 用掉 id-0002～id-0009，時間 00:00:02。
    await openLine(context, LINE_INPUT);

    const starter = await addMarketMare(context, MARE_INPUT);

    expect(starter.notices).toEqual([]);
    const horses = stripNameKeys(await readRecords(context.database, game.id, 'horses'));
    expect(horses.find((horse) => horse.id === 'id-0010')).toEqual({
      id: 'id-0010',
      sex: 'female',
      abilityNo: 0x30f,
      birthYear: 1960,
      fullName: '(外)テストヒンバ',
      baseName: 'テストヒンバ',
      sireName: 'ソトノチチ',
      damName: 'ソトノハハ',
      sireSubsystem: 'マンノウォー',
      femaleLine: 'テストケイ',
      stageNumbers: [],
      aliases: [],
    });
    expect(await readRecords(context.database, game.id, 'mares')).toEqual([
      {
        id: 'id-0010',
        group: { kind: 'starter', position: 1, generation: 0 },
        origin: 'marketFound',
        originNote: 'セール購入',
        status: 'producing',
        site: 32,
      },
    ]);
    const events = await readRecords(context.database, game.id, 'events');
    expect(events.filter((event) => event.subjectId === 'id-0010')).toEqual([
      {
        id: 'id-0011',
        subjectId: 'id-0010',
        type: 'horseCreated',
        gameYear: 1968,
        after: { fullName: '(外)テストヒンバ', sex: 'female' },
        source: 'user',
        occurredAt: '2026-09-15T00:00:04.000Z',
      },
      {
        id: 'id-0012',
        subjectId: 'id-0010',
        type: 'mareAdded',
        gameYear: 1968,
        after: {
          group: { kind: 'starter', position: 1, generation: 0 },
          origin: 'marketFound',
          site: 32,
        },
        source: 'user',
        occurredAt: '2026-09-15T00:00:04.000Z',
      },
    ]);

    const second = await addMarketMare(
      context,
      substituteInput(2, 1, 'テストカワリ', { noNamedFemaleLine: true, site: 34 }),
    );
    const third = await addMarketMare(context, substituteInput(3, 2, 'テストサンダイ'));

    expect(second.notices).toEqual(['自身父系未填，無法判斷是否屬於第 2 系']);
    expect(second.horse.femaleLine).toBe('');
    expect('femaleLine' in third.horse).toBe(false);
    expect(
      (await readRecords(context.database, game.id, 'mares')).map((mare) => mare.group),
    ).toEqual([
      { kind: 'starter', position: 1, generation: 0 },
      { kind: 'substitute', position: 2, generation: 1 },
      { kind: 'substitute', position: 3, generation: 2 },
    ]);
  });

  it('新增表單的預設來源：起點用與替代尚未開啟的系為市場創系，替代已開啟的系為市場補血', () => {
    expect(defaultOriginFor(1, 0, [1])).toBe('marketFound');
    expect(defaultOriginFor(2, 1, [1])).toBe('marketFound');
    expect(defaultOriginFor(1, 2, [1])).toBe('marketReplenish');
    expect(defaultOriginFor(2, 0, [1])).toBeUndefined();
  });

  it('[LINE-29] 替代母馬自身父系的親系統與該系不同時要確認；確認後保存並在事件記錄確認', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    await openLine(context, LINE_INPUT);
    await saveSystemMapEntry(context, { subsystem: 'マンノウォー', parentSystem: 'マッチェム' });
    await saveSystemMapEntry(context, {
      subsystem: 'ロイヤルチャージャー',
      parentSystem: 'ネアルコ',
    });
    const input = substituteInput(1, 2, 'テストカワリ', { sireSubsystem: 'マンノウォー' });

    expect(await checkAddMarketMare(context, input)).toEqual({
      issues: [],
      fields: {},
      warnings: [
        {
          code: 'sireParentSystemDiffers',
          message:
            '自身父系「マンノウォー」的親系統是「マッチェム」，與第 1 系目前的親系統「ネアルコ」不同；確認後仍登記為替代第 1 系 2 代',
        },
      ],
      notices: [],
    });
    await expect(addMarketMare(context, input)).rejects.toMatchObject({
      code: 'confirmationRequired',
    });
    expect(await readRecords(context.database, game.id, 'mares')).toEqual([]);

    const added = await addMarketMare(context, {
      ...input,
      acceptedWarnings: ['sireParentSystemDiffers'],
    });
    expect(added.mare).toEqual({
      id: added.horse.id,
      group: { kind: 'substitute', position: 1, generation: 2 },
      origin: 'marketFound',
      status: 'producing',
      site: 32,
    });
    const events = await readRecords(context.database, game.id, 'events');
    expect(events.find((event) => event.type === 'mareAdded')?.after).toEqual({
      group: { kind: 'substitute', position: 1, generation: 2 },
      origin: 'marketFound',
      site: 32,
      confirmations: ['sireParentSystemDiffers'],
    });

    const same = substituteInput(1, 2, 'テストドウケイ', {
      sireSubsystem: 'ロイヤルチャージャー系',
    });
    expect(await checkAddMarketMare(context, same)).toEqual({
      issues: [],
      fields: {},
      warnings: [],
      notices: [],
    });
  });

  it('[LINE-29] 自身父系留空、該系尚未成立或對照表查不到時只提示，不要求確認；起點母馬不判斷', async () => {
    const context = await openContext();
    await createGame(context, { name: '母馬局', startYear: 1968 });
    await openLine(context, LINE_INPUT);

    const cases: readonly (readonly [MarketMareInput, string])[] = [
      [substituteInput(1, 2, 'テストイチ'), '自身父系未填，無法判斷是否屬於第 1 系'],
      [
        substituteInput(2, 1, 'テストニ', { sireSubsystem: 'マンノウォー' }),
        '第 2 系尚未成立，無法判斷自身父系是否屬於第 2 系',
      ],
      [
        substituteInput(1, 2, 'テストサン', { sireSubsystem: 'テストケイトウ' }),
        '系統對照表沒有「テストケイトウ」，無法判斷自身父系是否屬於第 1 系',
      ],
    ];
    for (const [input, notice] of cases) {
      expect(await checkAddMarketMare(context, input)).toEqual({
        issues: [],
        fields: {},
        warnings: [],
        notices: [notice],
      });
      expect((await addMarketMare(context, input)).notices).toEqual([notice]);
    }
    expect((await checkAddMarketMare(context, { ...MARE_INPUT, abilityNo: '' })).notices).toEqual(
      [],
    );
  });

  it('[UI-05] 輸入錯誤一次列出並記在對應欄位，不寫入任何資料', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    const input: MarketMareInput = {
      ...MARE_INPUT,
      position: 2,
      generation: 0,
      fullName: '(外) [地]',
      abilityNo: '0xZZ',
      birthYear: 1969,
      site: 31,
      noNamedFemaleLine: true,
    };

    // 每個問題都記在對應的欄位，介面據此把錯誤與欄位建立關聯（UI-05）。
    expect((await checkAddMarketMare(context, input)).fields).toEqual({
      generation: '代數 0（起點母馬群）只能用於第 1 系',
      fullName: '馬名不能只有 (外)、[地] 前綴',
      abilityNo: '能力番号必須是 0x0000～0xFFFF 的十六進位',
      birthYear: '出生年必須是 1000～1968 的整數',
      site: '請選擇據點',
      femaleLine: '牝系名稱與「不屬於具名牝系」只能擇一',
    });
    expect((await checkAddMarketMare(context, input)).issues).toEqual([
      '代數 0（起點母馬群）只能用於第 1 系',
      '馬名不能只有 (外)、[地] 前綴',
      '能力番号必須是 0x0000～0xFFFF 的十六進位',
      '出生年必須是 1000～1968 的整數',
      '請選擇據點',
      '牝系名稱與「不屬於具名牝系」只能擇一',
    ]);
    expect(
      (await checkAddMarketMare(context, { ...MARE_INPUT, fullName: ' ', generation: Number.NaN }))
        .issues,
    ).toEqual(['代數必須是 0～9999 的整數', '請輸入馬名']);
    await expect(addMarketMare(context, input)).rejects.toMatchObject({
      code: 'invalidInput',
      fields: { fullName: '馬名不能只有 (外)、[地] 前綴', site: '請選擇據點' },
    });
    const counts = await countGameRecords(context.database, game.id);
    expect([counts.horses, counts.mares, counts.events]).toEqual([0, 0, 0]);
  });

  it('能力番号與出生年已屬於其他馬匹時拒絕', async () => {
    const context = await openContext();
    await createGame(context, { name: '母馬局', startYear: 1968 });
    await addMarketMare(context, MARE_INPUT);

    expect(
      (await checkAddMarketMare(context, { ...MARE_INPUT, fullName: 'テストベツ' })).issues,
    ).toEqual(['能力番号 0x030F 與出生年 1960 已屬於「(外)テストヒンバ」']);
  });

  it('寫入時在交易內讀出遊戲局：build 收到交易內的遊戲局，更新時間合併且不覆蓋最近備份', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    const lastBackup = {
      fileName: 'WPStudBook_母馬局_1968年_20260915-000500.json.gz',
      exportedAt: '2026-09-15T00:05:00.000Z',
      sizeBytes: 100,
      recordCount: 0,
    };
    // 服務在操作開始時讀到 1968 年；之後其他寫入把目前遊戲年改為 1970 年並加上最近備份。
    await context.database.put('games', { ...game, currentYear: 1970, lastBackup });
    const horse: Horse = { id: 'horse-1', sex: 'female', stageNumbers: [], aliases: [] };
    const mare: Mare = {
      id: 'horse-1',
      group: { kind: 'starter', position: 1, generation: 0 },
      origin: 'marketFound',
      status: 'producing',
      site: 32,
    };

    const seen: number[] = [];
    await insertMare(context.database, {
      gameId: game.id,
      touch: TOUCH,
      build: (stored) => {
        seen.push(stored.currentYear);
        return { horse, mare, events: [] };
      },
    });

    expect(seen).toEqual([1970]);
    expect(await getCurrentGame(context)).toEqual({
      ...game,
      currentYear: 1970,
      lastBackup,
      ...TOUCH,
    });
    const counts = await countGameRecords(context.database, game.id);
    expect([counts.horses, counts.mares]).toEqual([1, 1]);
  });

  it('寫入交易失敗時整筆退回，遊戲局更新時間不變', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    // addMarketMare 先產生馬匹 id-0002，交易內再依序產生事件 id-0003、id-0004。
    const blocker = {
      id: 'id-0003',
      subjectId: 'game',
      type: 'gameYearChanged',
      gameYear: 1968,
      source: 'user',
      occurredAt: '2026-09-14T00:00:00.000Z',
    };
    await putRecords(context.database, game.id, 'events', [blocker]);

    await expect(addMarketMare(context, MARE_INPUT)).rejects.toMatchObject({
      name: 'ConstraintError',
    });

    const counts = await countGameRecords(context.database, game.id);
    expect([counts.horses, counts.mares]).toEqual([0, 0]);
    expect(await readRecords(context.database, game.id, 'events')).toEqual([blocker]);
    expect((await getCurrentGame(context))?.updatedAt).toBe(game.updatedAt);
  });

  it('備份還原為新遊戲局後，母馬、馬匹與事件一致（寫入的紀錄符合欄位規則）', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    await openLine(context, LINE_INPUT);
    await addMarketMare(context, MARE_INPUT);
    await addMarketMare(
      context,
      substituteInput(2, 1, 'テストカワリ', { noNamedFemaleLine: true }),
    );

    const file = await exportBackup(context);
    const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes });

    for (const collection of ['horses', 'mares', 'events'] as const) {
      expect(
        stripNameKeys(await readRecords(context.database, restored.id, collection)),
        collection,
      ).toEqual(stripNameKeys(await readRecords(context.database, game.id, collection)));
    }
  });
});
