import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { PreviewRow } from '../../src/domain/import-batch.ts';
import { aprFoalsImportHandler } from '../../src/services/apr-foals-import.ts';
import { exportBackup, restoreBackupAsNewGame } from '../../src/services/backup.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  readFileNameHint,
  type ImportHandler,
} from '../../src/services/imports.ts';
import { jan2yoImportHandler } from '../../src/services/jan2yo-import.ts';
import { julMaresImportHandler } from '../../src/services/jul-mares-import.ts';
import { mayMaresImportHandler } from '../../src/services/may-mares-import.ts';
import { mayStallionsImportHandler } from '../../src/services/may-stallions-import.ts';
import { octWorldMaresImportHandler } from '../../src/services/oct-world-mares-import.ts';
import { useServiceContexts } from '../integration/helpers.ts';
import {
  REFERENCE_SAMPLES,
  readSampleBytes,
  sampleExists,
  type ReferenceSample,
} from './samples.ts';

function sample(fileName: string): ReferenceSample {
  const found = REFERENCE_SAMPLES.find((item) => item.fileName === fileName);
  if (found === undefined) {
    throw new Error(`沒有登記實檔 ${fileName}`);
  }
  return found;
}

async function applyReference<TRow extends PreviewRow>(
  context: ServiceContext,
  reference: ReferenceSample,
  handler: ImportHandler<TRow>,
) {
  const hint = readFileNameHint(reference.fileName);
  if (hint?.importType !== handler.type) {
    throw new Error(`${reference.fileName} 的檔名沒有預選成 ${handler.type}`);
  }
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: reference.fileName, bytes: readSampleBytes(reference) },
    { type: hint.importType, gameYear: hint.gameYear, timing: hint.timing },
  );
  const result = await applyImport(context, handler, prepared, { confirmWarnings: true });
  return { type: handler.type, preview: prepared.summary, applied: result.batch.summary };
}

type Step = (context: ServiceContext) => ReturnType<typeof applyReference>;

/** 一年裡的匯入順序（需求規格 4.1）：一月、四月、五月（繁殖牝馬、種牡馬）、七月、十月。 */
const SEQUENCE: readonly [ReferenceSample, Step][] = [
  [
    sample('1968年 1月1週._二歲新馬.txt'),
    (context) =>
      applyReference(context, sample('1968年 1月1週._二歲新馬.txt'), jan2yoImportHandler()),
  ],
  [
    sample('1968年 4月1週_幼駒誕生.txt'),
    (context) =>
      applyReference(context, sample('1968年 4月1週_幼駒誕生.txt'), aprFoalsImportHandler()),
  ],
  [
    sample('1968年 5月1週_繁殖牝馬.txt'),
    (context) =>
      applyReference(context, sample('1968年 5月1週_繁殖牝馬.txt'), mayMaresImportHandler()),
  ],
  [
    sample('1968年5月1週_種牡馬.txt'),
    (context) =>
      applyReference(context, sample('1968年5月1週_種牡馬.txt'), mayStallionsImportHandler()),
  ],
  [
    sample('1968年 7月1週_繁殖牝馬.txt'),
    (context) =>
      applyReference(context, sample('1968年 7月1週_繁殖牝馬.txt'), julMaresImportHandler()),
  ],
  [
    sample('1968年10月1週_繁殖牝馬.txt'),
    (context) =>
      applyReference(context, sample('1968年10月1週_繁殖牝馬.txt'), octWorldMaresImportHandler()),
  ],
];

/** 只比對筆數，不輸出原始資料（設計決策 7.4）。 */
describe.skipIf(!SEQUENCE.every(([reference]) => sampleExists(reference)))(
  '關卡 E：本機實檔依時序解析並套用（檔案不存在時略過）',
  () => {
    const open = useServiceContexts();

    it('1968 年的六份實檔依序套用，沒有錯誤列；結果備份後可以還原', async () => {
      const context = await open();
      await createGame(context, { name: '實檔套用局', startYear: 1968 });
      const summaries: Record<string, unknown> = {};
      for (const [reference, step] of SEQUENCE) {
        const { type, preview, applied } = await step(context);
        expect(preview.error, reference.fileName).toBe(0);
        summaries[type] = applied;
      }
      const outcome = (apply: number, skip: number, review: number, warn: number) => ({
        apply,
        skip,
        review,
        warn,
        error: 0,
      });
      expect(summaries).toEqual({
        // 空白的局：總表的二歲馬全部不是這一局的產駒。
        jan2yo: outcome(0, 1160, 0, 0),
        // 四月時還沒有繁殖牝馬圈：母馬不在管理資料，全部待核對，不寫入。
        aprFoals: outcome(0, 0, 10, 0),
        // 五月建立繁殖牝馬圈（新進，待指定用途）。
        mayMares: outcome(10, 0, 0, 0),
        mayStallions: outcome(443, 0, 0, 0),
        // 七月全部受胎，自動建立配種紀錄要確認。
        julMares: outcome(0, 0, 0, 10),
        // 十月：自家牧場與其他牧場的母馬全部略過（當年沒有在其他牧場的自家產駒）。
        octWorldMares: outcome(0, 2971, 0, 0),
      });

      // 套用後的整局資料通過備份的欄位、關聯與唯一性驗證。
      const file = await exportBackup(context);
      const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes, name: '還原' });
      expect(restored.name).toBe('還原');
    });
  },
);
