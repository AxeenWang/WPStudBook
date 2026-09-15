import { describe, expect, it } from 'vitest';
import {
  extractScenarioIds,
  extractTaggedIds,
  findUncoveredScenarios,
} from '../../scripts/lib/scenario-coverage.ts';

const SPEC = [
  '## 14. 成品與技術限制',
  '- **BLD-99**：第 15 章以外的代號不算',
  '## 15. 驗收情境',
  '### 馬匹身分（ID）',
  '- **ID-01**：條件 → 結果',
  '- **ID-02**：條件 → 結果',
  '### 八系管理（LINE）',
  '- **LINE-14**：條件 → 結果',
  '## 16. 待確認事項',
  '- **ID-99**：第 15 章以外的代號不算',
].join('\n');

describe('情境覆蓋', () => {
  it('只取第 15 章的情境代號', () => {
    expect(extractScenarioIds(SPEC)).toEqual(['ID-01', 'ID-02', 'LINE-14']);
  });

  it('從測試原始碼取出方括號標籤', () => {
    const source =
      "it('[TEST-01] 同一匹馬', () => {});\ntest('[TEST-02] 配對距離', async () => {});\n";
    expect([...extractTaggedIds(source)]).toEqual(['TEST-01', 'TEST-02']);
  });

  it('只計算字串開頭的標籤，不計算註解與字串中間的標籤', () => {
    const source = [
      "it('[TEST-01] 標題', () => {});",
      'test(`[TEST-02] 標題`, () => {});',
      '// 參考 [TEST-03]',
      "const note = '見 [TEST-04]';",
    ].join('\n');
    expect([...extractTaggedIds(source)]).toEqual(['TEST-01', 'TEST-02']);
  });

  it('同一個標題連寫多個標籤時全部計入', () => {
    const source = "it('[TEST-01][TEST-02] 備份往返', () => {});\n";
    expect([...extractTaggedIds(source)]).toEqual(['TEST-01', 'TEST-02']);
  });

  it('標籤後面接文字時，文字中的標籤不計入', () => {
    const source = "it('[TEST-01] 說明 [TEST-02]', () => {});\n";
    expect([...extractTaggedIds(source)]).toEqual(['TEST-01']);
  });

  it('代號超過兩位數時仍能辨識', () => {
    const spec = '## 15. 驗收情境\n- **TEST-100**：條件 → 結果\n## 16. 待確認事項\n';
    expect(extractScenarioIds(spec)).toEqual(['TEST-100']);
    expect([...extractTaggedIds("it('[TEST-100] 標題', () => {});")]).toEqual(['TEST-100']);
  });

  it('列出沒有任何測試標籤的情境', () => {
    expect(findUncoveredScenarios(['ID-01', 'ID-02', 'LINE-14'], new Set(['ID-01']))).toEqual([
      'ID-02',
      'LINE-14',
    ]);
  });
});
