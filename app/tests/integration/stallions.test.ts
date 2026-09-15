import { describe, expect, it } from 'vitest';
import { saveBreeding } from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { nameFoal, registerFoal } from '../../src/services/foals.ts';
import { changeCurrentYear } from '../../src/services/games.ts';
import { updateReminderSettings } from '../../src/services/settings.ts';
import {
  assignCurrentStallion,
  changeDutyStatus,
  chooseCurrentFromBrothers,
  confirmPlannedBirth,
  endPlannedSuccessor,
  loadBrotherComparison,
  loadHorseStallionStatus,
  loadStallionOverview,
  registerAsStallion,
  replaceCurrentStallion,
  setPlannedSuccessor,
  updatePlannedReadiness,
} from '../../src/services/stallions.ts';
import { getHorse } from '../../src/storage/horses.ts';
import { listStallionDuties } from '../../src/storage/stallion-duties.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';
import { foalInput, raiseStud } from './stud-fixture.ts';

async function currentOfFirstLine(context: ServiceContext) {
  const overview = await loadStallionOverview(context);
  return overview.lines[0]?.current ?? [];
}

describe('自家種牡馬接任與更換現任（需求規格 7.7、9.6）', () => {
  const open = useServiceContexts();

  it('[LINE-22] 同父異母弟弟取代哥哥擔任現任 → 允許，只顯示弟弟為現任，哥哥紀錄可查', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '0x0101' });

    await replaceCurrentStallion(context, {
      position: 1,
      generation: 1,
      successorId: stud.youngerId,
      reason: 'brotherBetter',
      effectiveYear: 1970,
      stallionNo: '',
    });

    const current = await currentOfFirstLine(context);
    const firstGeneration = current.filter((item) => item.generation === 1);
    expect(firstGeneration.filter((item) => item.dutyStatus === 'onDuty')).toEqual([
      expect.objectContaining({ horseId: stud.youngerId, startYear: 1970 }),
    ]);
    expect(firstGeneration.find((item) => item.horseId === stud.elderId)).toMatchObject({
      name: 'オオトリモナーコス1969',
      dutyStatus: 'replaced',
      endYear: 1970,
      changeReason: 'brotherBetter',
      successorName: 'テストヒンバ1970',
    });
    const elder = await getHorse(context.database, stud.gameId, stud.elderId);
    expect(elder).toMatchObject({
      fate: { kind: 'stallion', gameYear: 1970 },
      stageNumbers: [{ stage: 'stallion', number: 0x0101, gameYear: 1970, source: 'manual' }],
    });
    const events = await readRecords(context.database, stud.gameId, 'events');
    expect(events.filter((event) => event.type === 'stallionDutyChanged')).toEqual([
      expect.objectContaining({
        subjectId: stud.elderId,
        before: { dutyStatus: 'onDuty' },
        after: {
          dutyStatus: 'replaced',
          endYear: 1970,
          changeReason: 'brotherBetter',
          successorId: stud.youngerId,
        },
      }),
    ]);
    expect(
      events.filter((event) => event.type === 'stallionDutyStarted').map((event) => event.after),
    ).toEqual([
      { position: 1, generation: 0, role: 'current' },
      { position: 1, generation: 1, role: 'current', startYear: 1970 },
      { position: 1, generation: 1, role: 'current', startYear: 1970, predecessorId: stud.elderId },
    ]);
  });

  it('更換原因決定前任狀態；後任必須是同系同代；生效年不可早於前任起始年', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' });
    const replace = (overrides: Partial<Parameters<typeof replaceCurrentStallion>[1]>) =>
      replaceCurrentStallion(context, {
        position: 1,
        generation: 1,
        successorId: stud.youngerId,
        reason: 'predecessorRetired',
        effectiveYear: 1970,
        stallionNo: '',
        ...overrides,
      });

    await expect(replace({ generation: 0 })).rejects.toThrow(
      '後任必須是第 1 系 0 代的種牡馬，這匹馬是第 1 系 1 代',
    );
    await expect(replace({ effectiveYear: 1969 })).rejects.toThrow(
      '生效年必須是 1970～1970 的整數',
    );
    await expect(replace({ successorId: stud.elderId })).rejects.toThrow('後任不能是目前的現任');
    await expect(replace({ reason: undefined })).rejects.toThrow('請選擇更換原因');

    await replace({});
    const elderDuty = (await currentOfFirstLine(context)).find(
      (item) => item.horseId === stud.elderId,
    );
    expect(elderDuty).toMatchObject({ dutyStatus: 'retired', changeReason: 'predecessorRetired' });
  });

  it('接任前再次核對父母、系與代數（需求規格 9.6）；母駒、自由配種、已有在崗現任時阻止', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    await expect(
      assignCurrentStallion(context, { horseId: stud.daughterId, stallionNo: '' }),
    ).rejects.toThrow('只有公馬可以成為種牡馬');
    await expect(
      assignCurrentStallion(context, { horseId: stud.founderId, stallionNo: '' }),
    ).rejects.toThrow('只有自家產駒可以由此接任或指定為預定後繼');
    await expect(
      assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: 'XYZ' }),
    ).rejects.toThrow('種牡馬馬番号必須是 0x0000～0xFFFF 的十六進位');

    const foals = await readRecords(context.database, stud.gameId, 'foals');
    const elderFoal = foals.find((foal) => foal.id === stud.elderId);
    await putRecords(context.database, stud.gameId, 'foals', [
      { ...elderFoal, lineage: { position: 1, generation: 2 } },
    ]);
    await expect(
      assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' }),
    ).rejects.toThrow('出生紀錄的系與代數（第 1 系 2 代）與父母推導的結果（第 1 系 1 代）不符');
    await putRecords(context.database, stud.gameId, 'foals', [elderFoal ?? {}]);

    await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' });
    await expect(
      assignCurrentStallion(context, { horseId: stud.youngerId, stallionNo: '' }),
    ).rejects.toThrow('第 1 系 1 代已有在崗的現任，請使用更換現任或兄弟比較');
    await expect(
      assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' }),
    ).rejects.toThrow('這匹馬已經是現任');
    expect(await listStallionDuties(context.database, stud.gameId)).toHaveLength(2);
  });

  it('標示退出生產行列或已引退，可更正回在崗；已被取代的任期不能改狀態', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    const duty = await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' });

    await expect(
      changeDutyStatus(context, { dutyId: duty.id, status: 'retired', year: 1969 }),
    ).rejects.toThrow('年份必須是 1970～1970 的整數');
    expect(
      await changeDutyStatus(context, { dutyId: duty.id, status: 'outOfService', year: 1970 }),
    ).toMatchObject({ dutyStatus: 'outOfService', endYear: 1970 });
    expect(
      await changeDutyStatus(context, { dutyId: duty.id, status: 'onDuty', year: undefined }),
    ).toEqual({ ...duty, dutyStatus: 'onDuty' });

    await replaceCurrentStallion(context, {
      position: 1,
      generation: 1,
      successorId: stud.youngerId,
      reason: 'other',
      effectiveYear: 1970,
      stallionNo: '',
    });
    await expect(
      changeDutyStatus(context, { dutyId: duty.id, status: 'onDuty', year: undefined }),
    ).rejects.toThrow('已被取代的任期不能改狀態');
  });

  it('[LINE-26] 現任達提醒年齡（預設 26 歲）→ 八系資料顯示準備後繼提醒；提醒年齡可調', async () => {
    const context = await open();
    await raiseStud(context);
    await changeCurrentYear(context, 1975);
    let overview = await loadStallionOverview(context);
    expect(overview.reminderAge).toBe(26);
    expect(overview.lines[0]?.reminders).toEqual([]);

    await changeCurrentYear(context, 1976);
    overview = await loadStallionOverview(context);
    expect(overview.lines[0]?.current[0]).toMatchObject({ age: 26, reminder: true });
    expect(overview.lines[0]?.reminders).toEqual([
      '第 1 系 0 代現任「テストシュボバ」已 26 歲，達到種牡馬提醒年齡，請準備後繼',
    ]);

    await updateReminderSettings(context, {
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 27,
      vitalityThreshold: undefined,
    });
    expect((await loadStallionOverview(context)).lines[0]?.reminders).toEqual([]);
  });

  it('成為種牡馬後馬名唯讀（需求規格 6.4）；登記去向保存種牡馬馬番号', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    await nameFoal(context, { foalId: stud.elderId, officialName: 'テストアニキ' });
    await registerAsStallion(context, { horseId: stud.elderId, stallionNo: '0x00AB' });
    await expect(
      nameFoal(context, { foalId: stud.elderId, officialName: 'カイメイ' }),
    ).rejects.toThrow('種牡馬馬名唯讀');
    await expect(
      registerAsStallion(context, { horseId: stud.elderId, stallionNo: '' }),
    ).rejects.toThrow('已經登記為種牡馬');
    expect(await loadHorseStallionStatus(context, stud.elderId)).toEqual({
      isStallion: true,
      current: undefined,
      planned: undefined,
      stallionNumbers: ['0x00AB'],
    });
    const events = await readRecords(context.database, stud.gameId, 'events');
    expect(events.find((event) => event.type === 'becameStallion')).toMatchObject({
      subjectId: stud.elderId,
      gameYear: 1970,
      after: { stallionNo: 0xab },
    });
  });
});

describe('種牡馬兄弟比較（需求規格 7.7）', () => {
  const open = useServiceContexts();

  it('[LINE-30][LINE-32] 第 1 系 1 代兩匹同父兄弟都成為種牡馬 → 並排比較，不自動標示優劣或更換；選定者為現任，另一匹已被取代', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    await registerAsStallion(context, { horseId: stud.elderId, stallionNo: '' });
    await registerAsStallion(context, { horseId: stud.youngerId, stallionNo: '' });

    const comparison = await loadBrotherComparison(context, stud.youngerId);
    expect(comparison).toMatchObject({
      position: 1,
      generation: 1,
      sireId: stud.founderId,
      sireName: 'テストシュボバ',
    });
    expect(comparison.rows).toEqual([
      {
        id: stud.elderId,
        name: 'オオトリモナーコス1969',
        birthYear: 1969,
        age: 1,
        damName: 'オオトリモナーコス',
        sp: 70,
        st: 40,
        subParams: {},
        subParamTotal: undefined,
        turf: undefined,
        dirt: undefined,
        distanceText: undefined,
        status: 'notCurrent',
      },
      expect.objectContaining({ id: stud.youngerId, sp: 75, st: 55, status: 'notCurrent' }),
    ]);
    // 比較本身不改變任何任期（LINE-32）。
    expect((await currentOfFirstLine(context)).filter((item) => item.generation === 1)).toEqual([]);

    await chooseCurrentFromBrothers(context, {
      position: 1,
      generation: 1,
      sireId: stud.founderId,
      horseId: stud.elderId,
    });
    await chooseCurrentFromBrothers(context, {
      position: 1,
      generation: 1,
      sireId: stud.founderId,
      horseId: stud.youngerId,
    });

    const rows = (await loadBrotherComparison(context, stud.elderId)).rows;
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [stud.elderId, 'replaced'],
      [stud.youngerId, 'onDuty'],
    ]);
    const current = await currentOfFirstLine(context);
    expect(current.find((item) => item.horseId === stud.youngerId)?.brotherCount).toBe(2);
  });

  it('[LINE-31] 兄弟比較中選入不同系或不同代的種牡馬 → 阻止', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    await registerAsStallion(context, { horseId: stud.elderId, stallionNo: '' });
    // 第 1 系零代 × 第 1 系 1 代母馬 → 同父的第 1 系 2 代。
    await saveBreeding(context, {
      mareId: stud.daughterId,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: stud.founderId,
      stallionName: '',
      conception: '受胎',
    });
    await changeCurrentYear(context, 1971);
    const nephew = await registerFoal(context, foalInput(stud.daughterId, 1971));
    await registerAsStallion(context, { horseId: nephew.horse.id, stallionNo: '' });

    const choose = (position: number, generation: number, horseId: string) =>
      chooseCurrentFromBrothers(context, { position, generation, sireId: stud.founderId, horseId });
    await expect(choose(1, 1, nephew.horse.id)).rejects.toThrow(
      '兄弟比較只接受第 1 系 1 代、同父的種牡馬',
    );
    await expect(choose(2, 1, stud.elderId)).rejects.toThrow(
      '兄弟比較只接受第 2 系 1 代、同父的種牡馬',
    );
    await expect(choose(1, 1, stud.youngerId)).rejects.toThrow('這匹馬尚未登記成為種牡馬');
    expect((await loadBrotherComparison(context, stud.elderId)).rows.map((row) => row.id)).toEqual([
      stud.elderId,
    ]);
    expect(await listStallionDuties(context.database, stud.gameId)).toHaveLength(1);
  });
});

describe('預定後繼（需求規格 7.7）', () => {
  const open = useServiceContexts();

  it('指定已受胎、尚未誕生的配種；出生為公駒時由使用者確認，正式接任後指定改為正式供用', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    const breeding = await saveBreeding(context, {
      mareId: stud.daughterId,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: stud.founderId,
      stallionName: '',
      conception: '受胎',
    });

    const planned = await setPlannedSuccessor(context, { position: 1, breedingId: breeding.id });
    expect(planned).toMatchObject({
      role: 'planned',
      generation: 2,
      breedingId: breeding.id,
      readiness: 'unborn',
      startYear: 1970,
    });
    let line = (await loadStallionOverview(context)).lines[0];
    expect(line?.planned).toMatchObject({
      readiness: 'unborn',
      horse: undefined,
      birth: {
        label: 'テストムスメ × テストシュボバ（1970 年受胎）',
        expectedBirthYear: 1971,
        born: undefined,
      },
    });
    await expect(confirmPlannedBirth(context, 1)).rejects.toThrow('產駒尚未出生');

    await changeCurrentYear(context, 1971);
    const colt = await registerFoal(context, foalInput(stud.daughterId, 1971));
    line = (await loadStallionOverview(context)).lines[0];
    expect(line?.planned?.readiness).toBe('unborn');
    expect(line?.reminders).toEqual(['第 1 系的預定後繼已出生（テストムスメ1971），請確認']);

    expect(await confirmPlannedBirth(context, 1)).toEqual({
      id: planned.id,
      position: 1,
      generation: 2,
      role: 'planned',
      horseId: colt.horse.id,
      readiness: 'racing',
      startYear: 1970,
    });
    await updatePlannedReadiness(context, { position: 1, readiness: 'retiredPendingAssignment' });
    expect(await loadHorseStallionStatus(context, colt.horse.id)).toMatchObject({
      planned: { position: 1, readiness: 'retiredPendingAssignment' },
    });

    await assignCurrentStallion(context, { horseId: colt.horse.id, stallionNo: '' });
    const duties = await listStallionDuties(context.database, stud.gameId);
    expect(duties.find((duty) => duty.id === planned.id)).toMatchObject({
      readiness: 'inService',
      endYear: 1971,
    });
    line = (await loadStallionOverview(context)).lines[0];
    expect(line?.planned).toBeUndefined();
    expect(line?.current.find((item) => item.horseId === colt.horse.id)).toMatchObject({
      generation: 2,
      dutyStatus: 'onDuty',
    });
    const events = await readRecords(context.database, stud.gameId, 'events');
    expect(
      events
        .filter((event) => event.type === 'plannedSuccessorChanged')
        .map((event) => event.after),
    ).toEqual([
      { generation: 2, readiness: 'unborn', breedingId: breeding.id },
      { generation: 2, readiness: 'racing', horseId: colt.horse.id },
      { generation: 2, readiness: 'retiredPendingAssignment', horseId: colt.horse.id },
      { generation: 2, readiness: 'inService', horseId: colt.horse.id, endYear: 1971 },
    ]);
  });

  it('產駒為牝時提醒預定後繼失效，不能確認；可以取消或改指定既有公駒', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    const breeding = await saveBreeding(context, {
      mareId: stud.daughterId,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: stud.founderId,
      stallionName: '',
      conception: '受胎',
    });
    await setPlannedSuccessor(context, { position: 1, breedingId: breeding.id });
    await changeCurrentYear(context, 1971);
    await registerFoal(context, foalInput(stud.daughterId, 1971, { sex: 'female' }));

    const line = (await loadStallionOverview(context)).lines[0];
    expect(line?.reminders).toEqual([
      '第 1 系的預定後繼「テストムスメ1971」出生為牝馬，預定後繼失效，請重新指定或取消',
    ]);
    await expect(confirmPlannedBirth(context, 1)).rejects.toThrow('產駒是牝馬，預定後繼失效');

    await setPlannedSuccessor(context, { position: 1, horseId: stud.elderId, readiness: 'racing' });
    await expect(
      setPlannedSuccessor(context, { position: 1, horseId: stud.elderId, readiness: 'racing' }),
    ).rejects.toThrow('預定後繼沒有變更');
    await endPlannedSuccessor(context, 1);
    expect((await loadStallionOverview(context)).lines[0]?.planned).toBeUndefined();
    const plannedDuties = (await listStallionDuties(context.database, stud.gameId)).filter(
      (duty) => duty.role === 'planned',
    );
    expect(plannedDuties.map((duty) => duty.endYear)).toEqual([1971, 1971]);
  });

  it('自由配種、未受胎、已出生或會屬於其他系的配種不能指定；母駒不能指定', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    const free = await saveBreeding(context, {
      mareId: stud.daughterId,
      gameYear: 1970,
      breedingType: 'free',
      stallionId: undefined,
      stallionName: 'ソトノタネウマ',
      conception: '受胎',
    });
    await expect(
      setPlannedSuccessor(context, { position: 1, breedingId: free.id }),
    ).rejects.toThrow('只有八系指定配種可以指定為預定後繼');
    const [elderBreeding] = (await readRecords(context.database, stud.gameId, 'breedings')).filter(
      (item) => item.foalId === stud.elderId,
    );
    await expect(
      setPlannedSuccessor(context, { position: 1, breedingId: String(elderBreeding?.id) }),
    ).rejects.toThrow('產駒已出生，請改為指定產駒本身');
    await expect(
      setPlannedSuccessor(context, {
        position: 2,
        horseId: stud.elderId,
        readiness: 'racing',
      }),
    ).rejects.toThrow('第 1 系尚未開啟');
    await expect(
      setPlannedSuccessor(context, { position: 1, horseId: stud.daughterId, readiness: 'racing' }),
    ).rejects.toThrow('只有公馬可以成為種牡馬');
    await expect(setPlannedSuccessor(context, { position: 1 })).rejects.toThrow(
      '請選擇一匹公駒或一筆已受胎的配種',
    );
  });
});
