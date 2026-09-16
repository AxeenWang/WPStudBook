import { describe, expect, it } from 'vitest';
import { withStageNumber, type Horse } from '../../src/domain/horse.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame, switchGame } from '../../src/services/games.ts';
import {
  duplicateAbilityNosIn,
  importedStageNumber,
  namesOf,
  resolveIdentities,
  stageOfImport,
  type IdentityRow,
} from '../../src/services/import-identity.ts';
import { horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return {
    sex: 'female',
    stageNumbers: [],
    aliases: [],
    ...overrides,
  };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  horses: readonly Horse[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    'horses',
    horses.map((item) => ({ ...item, nameKeys: horseNameKeys(gameId, item) })),
  );
}

function row(overrides: Partial<IdentityRow> = {}): IdentityRow {
  return { lineNumber: 2, ...overrides };
}

describe('匯入的身分配對（需求規格 6.2、6.4）', () => {
  const openContext = useServiceContexts();

  it('[ID-12] 能力番号為 0x0000 的馬正常配對，不視為空白或未知', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '身分測試局', startYear: 1968 });
    await seed(context, game.id, [
      horse({ id: 'h-1', abilityNo: 0, birthYear: 1960, fullName: 'テストウマ001' }),
    ]);

    const [resolved] = await resolveIdentities(context.database, game.id, [
      row({ abilityNo: 0, birthYear: 1960, fullName: 'テストウマ001' }),
    ]);
    expect(resolved).toMatchObject({ kind: 'same', horse: { id: 'h-1', abilityNo: 0 } });
  });

  it('[ID-02] 能力番号相同、出生年不同時建立新馬，既有馬不變', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '身分測試局', startYear: 1968 });
    await seed(context, game.id, [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1960, fullName: 'テストメス001' }),
    ]);

    const [resolved] = await resolveIdentities(context.database, game.id, [
      row({ abilityNo: 0x1001, birthYear: 1966, fullName: 'テストメス002' }),
    ]);
    expect(resolved).toEqual({ kind: 'new' });
  });

  it('[ID-03] 能力番号與出生年相同但馬名或父母不符時為衝突', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '身分測試局', startYear: 1968 });
    await seed(context, game.id, [
      horse({
        id: 'h-1',
        abilityNo: 0x1001,
        birthYear: 1962,
        fullName: 'テストメス001',
        sireName: 'テストウマ001',
      }),
    ]);

    const [byName, byParent] = await resolveIdentities(context.database, game.id, [
      row({ abilityNo: 0x1001, birthYear: 1962, fullName: '別のウマ' }),
      row({
        lineNumber: 3,
        abilityNo: 0x1001,
        birthYear: 1962,
        fullName: 'テストメス001',
        sireName: '別のウマ',
      }),
    ]);
    expect(byName).toMatchObject({ kind: 'conflict', reason: 'nameMismatch' });
    expect(byParent).toMatchObject({ kind: 'conflict', reason: 'parentMismatch' });
  });

  it('[ID-05] 只有馬番号相同、能力番号不同時不合併', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '身分測試局', startYear: 1968 });
    await seed(context, game.id, [
      horse({
        id: 'h-1',
        abilityNo: 0x1001,
        birthYear: 1962,
        fullName: 'テストメス001',
        stageNumbers: [{ stage: 'broodmare', number: 0x2001, gameYear: 1968, source: 'mayMares' }],
      }),
    ]);

    // 同一個馬番号、不同能力番号、不同馬名：馬番号不作為判斷依據（需求規格 6.1）。
    const [resolved] = await resolveIdentities(context.database, game.id, [
      row({ abilityNo: 0x9999, birthYear: 1962, fullName: 'ベツノメス' }),
    ]);
    expect(resolved).toEqual({ kind: 'new' });
  });

  it('[ID-06] 同一檔案內能力番号重複時回報，交由呼叫端整份停止', () => {
    expect(
      duplicateAbilityNosIn([
        row({ lineNumber: 2, abilityNo: 0x1001 }),
        row({ lineNumber: 3, abilityNo: 0x1002 }),
        row({ lineNumber: 4, abilityNo: 0x1001 }),
      ]),
    ).toEqual([0x1001]);
    expect(duplicateAbilityNosIn([row({ abilityNo: 0 }), row({ lineNumber: 3 })])).toEqual([]);
  });

  it('[ID-07] 手動新增、沒有能力番号的母馬以唯一馬名補入；既有能力番号不同則衝突', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '身分測試局', startYear: 1968 });
    await seed(context, game.id, [
      horse({ id: 'h-1', fullName: 'テストメス001', birthYear: 1962 }),
      horse({ id: 'h-2', fullName: 'テストメス002', birthYear: 1962, abilityNo: 0x2002 }),
    ]);

    const [filled, conflict] = await resolveIdentities(context.database, game.id, [
      row({ abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      row({ lineNumber: 3, abilityNo: 0x1002, birthYear: 1962, fullName: 'テストメス002' }),
    ]);
    expect(filled).toMatchObject({ kind: 'fillAbilityNo', horse: { id: 'h-1' } });
    expect(conflict).toMatchObject({ kind: 'conflict', reason: 'abilityNoMismatch' });
  });

  it('[ID-09] 帶 (外) 前綴的馬以完整馬名或基本馬名都配對得到', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '身分測試局', startYear: 1968 });
    await seed(context, game.id, [
      horse({
        id: 'h-1',
        birthYear: 1964,
        fullName: '(外)テストメス003',
        baseName: 'テストメス003',
      }),
    ]);

    expect(namesOf(row({ fullName: '(外)テストメス003' }))).toEqual([
      '(外)テストメス003',
      'テストメス003',
    ]);
    const [byFull, byBase] = await resolveIdentities(context.database, game.id, [
      row({ abilityNo: 0x1003, birthYear: 1964, fullName: '(外)テストメス003' }),
      row({ lineNumber: 3, abilityNo: 0x1003, birthYear: 1964, fullName: 'テストメス003' }),
    ]);
    expect(byFull).toMatchObject({ kind: 'fillAbilityNo', horse: { id: 'h-1' } });
    expect(byBase).toMatchObject({ kind: 'fillAbilityNo', horse: { id: 'h-1' } });
  });

  it('[ID-10][DATA-08] 兩個遊戲局有相同能力番号、出生年與馬名時互不配對', async () => {
    const context = await openContext();
    const first = await createGame(context, { name: '第一局', startYear: 1968 });
    const second = await createGame(context, { name: '第二局', startYear: 1968 });
    await seed(context, first.id, [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await switchGame(context, second.id);

    const [resolved] = await resolveIdentities(context.database, second.id, [
      row({ abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    expect(resolved).toEqual({ kind: 'new' });
  });

  it('各匯入類型的馬番号記在對應的生命階段歷程（ID-01 的一部分，需求規格 6.4）', () => {
    expect(stageOfImport('aprFoals')).toBe('foal');
    expect(stageOfImport('jan2yo')).toBe('racehorse');
    expect(stageOfImport('candidateFile')).toBe('broodmare');
    expect(stageOfImport('targetStallion')).toBe('stallion');

    const born = withStageNumber(
      horse({ id: 'h-1', sex: 'female' }),
      importedStageNumber('aprFoals', 0x4001, 1968),
    );
    const raced = withStageNumber(born, importedStageNumber('jan2yo', 0x7001, 1970));
    const bred = withStageNumber(raced, importedStageNumber('mayMares', 0x2001, 1973));
    // 同一階段重複出現相同馬番号時不重複記錄（需求規格 6.4）。
    const again = withStageNumber(bred, importedStageNumber('julMares', 0x2001, 1973));

    expect(again.stageNumbers).toEqual([
      { stage: 'foal', number: 0x4001, gameYear: 1968, source: 'aprFoals' },
      { stage: 'racehorse', number: 0x7001, gameYear: 1970, source: 'jan2yo' },
      { stage: 'broodmare', number: 0x2001, gameYear: 1973, source: 'mayMares' },
    ]);
  });
});
