import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import {
  buildPedigree,
  type PedigreeNode,
  type PedigreeSource,
  type PedigreeStatus,
} from '../../src/domain/pedigree.ts';

function horse(id: string, overrides: Partial<Horse> = {}): Horse {
  return { id, sex: 'female', fullName: id, stageNumbers: [], aliases: [], ...overrides };
}

function source(
  horses: readonly Horse[],
  statuses: Readonly<Record<string, readonly PedigreeStatus[]>> = {},
): PedigreeSource {
  return {
    horses: new Map(horses.map((item) => [item.id, item])),
    statusOf: (id) => statuses[id] ?? [],
    nameOf: (item) => item.fullName ?? item.id,
  };
}

function names(node: PedigreeNode | undefined): unknown {
  if (node === undefined) {
    return undefined;
  }
  switch (node.kind) {
    case 'horse':
      return [node.name, names(node.sire), names(node.dam)];
    case 'external':
      return `外部:${node.name}`;
    case 'missing':
      return '資料不足';
  }
}

describe('血緣表（需求規格 10.4）', () => {
  const horses = [
    horse('子', { sex: 'male', sireId: '父', damId: '母' }),
    horse('父', { sex: 'male', sireId: '祖父', damName: '(外)ソトノソボ' }),
    horse('母', { sireId: '祖父', damId: '祖母' }),
    horse('祖父', { sex: 'male', sireName: 'ソトノソウソフ' }),
    horse('祖母'),
  ];

  it('依內部識別向上展開；只有名稱的父母為外部參考節點，沒有資料的為資料不足', () => {
    const root = buildPedigree('子', 3, source(horses));
    expect(names(root)).toEqual([
      '子',
      ['父', ['祖父', '外部:ソトノソウソフ', '資料不足'], '外部:(外)ソトノソボ'],
      ['母', ['祖父', '外部:ソトノソウソフ', '資料不足'], ['祖母', '資料不足', '資料不足']],
    ]);
  });

  it('標示在祖先中重複出現的馬，起點本身不算；已達顯示代數且還有上一代資料時可展開', () => {
    const root = buildPedigree('子', 2, source(horses));
    expect(root?.duplicate).toBe(false);
    const sire = root?.sire;
    const dam = root?.dam;
    if (sire?.kind !== 'horse' || dam?.kind !== 'horse') {
      throw new Error('父母應為內部馬匹');
    }
    expect([sire.duplicate, dam.duplicate]).toEqual([false, false]);
    const grandSires = [sire.sire, dam.sire];
    expect(grandSires).toEqual([
      expect.objectContaining({
        horseId: '祖父',
        duplicate: true,
        expandable: true,
        sire: undefined,
      }),
      expect.objectContaining({ horseId: '祖父', duplicate: true, expandable: true }),
    ]);
    expect(dam.dam).toMatchObject({ horseId: '祖母', duplicate: false, expandable: false });
  });

  it('[PED-09] 已售出、引退、被取代的祖先照常列出並帶狀態，父母關係不中斷；找不到起點時為 undefined', () => {
    const root = buildPedigree(
      '子',
      2,
      source(horses, { 父: ['replaced'], 母: ['sold'], 祖母: ['retired'] }),
    );
    expect(root?.sire).toMatchObject({ horseId: '父', statuses: ['replaced'] });
    expect(root?.dam).toMatchObject({
      horseId: '母',
      statuses: ['sold'],
      dam: { horseId: '祖母', statuses: ['retired'] },
    });
    expect(buildPedigree('不存在', 3, source(horses))).toBeUndefined();
  });
});
