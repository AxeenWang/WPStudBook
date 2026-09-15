import { describe, expect, it } from 'vitest';
import type { PedigreeNode } from '../../src/domain/pedigree.ts';
import { saveBreeding } from '../../src/services/breedings.ts';
import { registerFoal } from '../../src/services/foals.ts';
import { changeCurrentYear } from '../../src/services/games.ts';
import { sellMare } from '../../src/services/mares.ts';
import { loadPedigree } from '../../src/services/pedigree.ts';
import { assignCurrentStallion, replaceCurrentStallion } from '../../src/services/stallions.ts';
import { getHorse } from '../../src/storage/horses.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';
import { foalInput, raiseStud } from './stud-fixture.ts';

/** 節點摘要：馬名與狀態、重複標示；外部與資料不足節點另外標示。 */
function outline(node: PedigreeNode | undefined): unknown {
  if (node === undefined) {
    return undefined;
  }
  if (node.kind === 'external') {
    return `外部:${node.name}`;
  }
  if (node.kind === 'missing') {
    return '資料不足';
  }
  const flags = [...node.statuses, ...(node.duplicate ? ['重複'] : [])];
  const label = flags.length === 0 ? node.name : `${node.name}(${flags.join(',')})`;
  return node.sire === undefined && node.dam === undefined
    ? label
    : [label, outline(node.sire), outline(node.dam)];
}

describe('血緣表（需求規格 10.4）', () => {
  const open = useServiceContexts();

  it('[PED-09] 數代後開啟血緣表 → 已售出、定年引退、被取代的祖先仍在，父母關係不中斷', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    // 哥哥擔任第 1 系 1 代現任，配 1 代母馬「テストムスメ」產出 2 代，之後被弟弟取代。
    await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' });
    await saveBreeding(context, {
      mareId: stud.daughterId,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: stud.elderId,
      stallionName: '',
      conception: '受胎',
    });
    await changeCurrentYear(context, 1971);
    const grandchild = await registerFoal(context, foalInput(stud.daughterId, 1971));
    await replaceCurrentStallion(context, {
      position: 1,
      generation: 1,
      successorId: stud.youngerId,
      reason: 'betterBrother',
      effectiveYear: 1971,
      stallionNo: '',
    });
    const elderDamId = (await getHorse(context.database, stud.gameId, stud.elderId))?.damId;
    const daughterDamId = (await getHorse(context.database, stud.gameId, stud.daughterId))?.damId;
    await sellMare(context, String(elderDamId));
    // 定年引退由五月匯入標示（階段 4）；此處直接寫入離圈狀態模擬。
    const mares = await readRecords(context.database, stud.gameId, 'mares');
    await putRecords(context.database, stud.gameId, 'mares', [
      { ...mares.find((mare) => mare.id === daughterDamId), status: 'left', leftReason: 'retired' },
    ]);

    const pedigree = await loadPedigree(context, grandchild.horse.id, 3);

    expect(outline(pedigree.root)).toEqual([
      'テストムスメ1971',
      [
        'オオトリモナーコス1969(replaced)',
        ['テストシュボバ(重複)', '資料不足', '資料不足'],
        ['オオトリモナーコス(sold)', '資料不足', '資料不足'],
      ],
      [
        'テストムスメ',
        ['テストシュボバ(重複)', '資料不足', '資料不足'],
        ['テストハハウマ(retired)', '資料不足', '資料不足'],
      ],
    ]);
    expect(pedigree.canExpand).toBe(false);
    expect((await loadPedigree(context, grandchild.horse.id, 1)).canExpand).toBe(true);
    await expect(loadPedigree(context, grandchild.horse.id, 11)).rejects.toThrow(
      '血緣表代數必須是 1～10 的整數',
    );
  });

  it('父母只有匯入名稱時顯示外部參考節點，尚未連結內部馬匹', async () => {
    const context = await open();
    const stud = await raiseStud(context);
    const founder = await getHorse(context.database, stud.gameId, stud.founderId);
    await putRecords(context.database, stud.gameId, 'horses', [
      { ...founder, sireName: 'ソトノチチ', damName: '(外)ソトノハハ' },
    ]);
    const pedigree = await loadPedigree(context, stud.elderId, 2);
    expect(outline(pedigree.root)).toEqual([
      'オオトリモナーコス1969',
      ['テストシュボバ', '外部:ソトノチチ', '外部:(外)ソトノハハ'],
      ['オオトリモナーコス', '資料不足', '資料不足'],
    ]);
  });
});
