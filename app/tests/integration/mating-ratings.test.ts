import { describe, expect, it } from 'vitest';
import { changeCurrentYear } from '../../src/services/games.ts';
import { loadMareMatingRatings, saveMatingRating } from '../../src/services/mating-ratings.ts';
import { readRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';
import { raiseStud } from './stud-fixture.ts';

describe('總合評價與爆發力（需求規格 9.2）', () => {
  const open = useServiceContexts();

  it('[BRD-17] 可隨時新增或編輯；同年直接更新，跨年舊值可查', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    const input = {
      mareId: stud.daughterId,
      stallionId: stud.founderId,
      overallGrade: 'B',
      explosivePower: 12,
    } as const;

    const first = await saveMatingRating(context, input);
    expect(first).toEqual({
      id: first.id,
      stallionId: stud.founderId,
      mareId: stud.daughterId,
      gameYear: 1970,
      overallGrade: 'B',
      explosivePower: 12,
    });
    const edited = await saveMatingRating(context, { ...input, overallGrade: 'A' });
    expect(edited.id).toBe(first.id);
    await expect(saveMatingRating(context, { ...input, overallGrade: 'A' })).rejects.toThrow(
      '配種評價沒有變更',
    );

    await changeCurrentYear(context, 1971);
    await saveMatingRating(context, { ...input, overallGrade: 'S', explosivePower: undefined });

    const ratings = await loadMareMatingRatings(context, stud.daughterId);
    expect(ratings.currentYear).toBe(1971);
    expect(ratings.stallionOptions.map((option) => option.id)).toContain(stud.founderId);
    expect(ratings.rows).toEqual([
      expect.objectContaining({
        stallionName: 'テストシュボバ',
        gameYear: 1971,
        overallGrade: 'S',
        explosivePower: undefined,
      }),
      expect.objectContaining({ gameYear: 1970, overallGrade: 'A', explosivePower: 12 }),
    ]);
    const events = await readRecords(context.database, stud.gameId, 'events');
    expect(
      events
        .filter((event) => event.type === 'matingRatingRecorded')
        .map((event) => [event.subjectId, event.before, event.after]),
    ).toEqual([
      [
        stud.daughterId,
        undefined,
        { stallionId: stud.founderId, gameYear: 1970, overallGrade: 'B', explosivePower: 12 },
      ],
      [
        stud.daughterId,
        { stallionId: stud.founderId, gameYear: 1970, overallGrade: 'B', explosivePower: 12 },
        { stallionId: stud.founderId, gameYear: 1970, overallGrade: 'A', explosivePower: 12 },
      ],
      [
        stud.daughterId,
        undefined,
        { stallionId: stud.founderId, gameYear: 1971, overallGrade: 'S' },
      ],
    ]);
  });

  it('沒有種牡馬、兩項都沒填、爆發力超出範圍或對象不存在時拒絕，不寫入', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    const base = {
      mareId: stud.daughterId,
      stallionId: stud.founderId,
      overallGrade: undefined,
      explosivePower: undefined,
    };
    await expect(saveMatingRating(context, { ...base, stallionId: '' })).rejects.toThrow(
      '請選擇種牡馬；請輸入總合評價或爆發力',
    );
    await expect(saveMatingRating(context, { ...base, explosivePower: 100 })).rejects.toThrow(
      '爆發力必須是 0～99 的整數',
    );
    await expect(
      saveMatingRating(context, { ...base, mareId: stud.elderId, overallGrade: 'C' }),
    ).rejects.toThrow('找不到這匹繁殖牝馬');
    await expect(
      saveMatingRating(context, { ...base, stallionId: stud.daughterId, overallGrade: 'C' }),
    ).rejects.toThrow('找不到這匹種牡馬');
    expect(await readRecords(context.database, stud.gameId, 'matingRatings')).toEqual([]);
  });
});
