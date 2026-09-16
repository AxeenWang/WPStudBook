import { describe, expect, it } from 'vitest';
import { pedigreeWarningCodes } from '../../src/domain/pedigree-check.ts';
import { loadTaskBoard } from '../../src/services/tasks.ts';
import { useServiceContexts } from './helpers.ts';
import { simulateEightLines } from './simulation.ts';

describe('關卡 D：八系規則長期模擬（開發計畫階段 3 第 7 項）', () => {
  const openContext = useServiceContexts();

  it(
    '[PED-02] 依 7.3 建系並兩兩互換循環到產出 10 代：6 代起每系預估 8 種活血且 4 代內無重複',
    { timeout: 120_000 },
    async () => {
      const context = await openContext();
      const result = await simulateEightLines(context, 10);

      // 產出 4 代時八系全部成立（需求規格 7.3）。
      const foundedByFourth = new Set(
        result.produced.filter((item) => item.generation <= 4).map((item) => item.position),
      );
      expect([...foundedByFourth].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      // 產出 5 代起為循環期，每一代八系都各產出一次。
      for (const generation of [5, 6, 7, 8, 9, 10]) {
        const positions = result.produced
          .filter((item) => item.generation === generation)
          .map((item) => item.position)
          .sort((a, b) => a - b);
        expect(positions, `產出 ${String(generation)} 代`).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      }

      // 4.3 的結論：6 代起每系 8 種活血且 4 代內無重複，所以不警告。
      // 4 代內仍會看到建系期市場馬造成的缺漏，但那只提示、不要求確認（需求規格 10.2、PED-11）。
      for (const item of result.produced.filter((entry) => entry.generation >= 6)) {
        const where = `第 ${String(item.position)} 系 ${String(item.generation)} 代`;
        expect(item.pedigreeCheck.activationCount, `${where} 活血`).toBe(8);
        expect(item.pedigreeCheck.duplicateAncestors, `${where} 重複祖先`).toEqual([]);
        expect(pedigreeWarningCodes(item.pedigreeCheck), `${where} 需確認的警告`).toEqual([]);
        if (item.pedigreeCheck.insufficientPedigree) {
          expect(item.pedigreeCheck.gapsOnlyFromBuildingPhase, `${where} 缺漏來源`).toBe(true);
        }
      }

      // 產出 4、5 代因祖先含建系期市場馬而資料不足（需求規格 4.3）。
      for (const item of result.produced.filter((entry) => entry.generation === 5)) {
        expect(item.pedigreeCheck.insufficientPedigree).toBe(true);
        expect(item.pedigreeCheck.gapsOnlyFromBuildingPhase).toBe(true);
      }

      // 建系期不計算活血（需求規格 10.1、PED-01）。
      for (const item of result.produced.filter((entry) => entry.generation <= 4)) {
        expect(item.pedigreeCheck.evaluated).toBe(false);
      }

      // 模擬結束時看板仍能推導出下一代的任務，沒有卡住。
      const board = await loadTaskBoard(context);
      expect(board.tasks.some((task) => task.target.generation === 11)).toBe(true);
    },
  );
});
