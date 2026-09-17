import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import { GAME_SUBJECT_ID } from '../domain/history-event.ts';
import {
  checkRepeat,
  decideYear,
  hasBlockingError,
  isYearlyTotal,
  summarise,
  type ImportBatch,
  type ImportSummary,
  type PreviewRow,
  type RepeatCheck,
  type YearDecision,
} from '../domain/import-batch.ts';
import type { ImportType } from '../domain/import-type.ts';
import type { Timing } from '../domain/timing.ts';
import { parseImportFileName, type FileNameHint } from '../import/file-name.ts';
import { FORMAT_OF_IMPORT_TYPE } from '../import/formats.ts';
import { parseImportFile, type ParsedFile } from '../import/parse.ts';
import { sha256Hex } from '../storage/backup/digest.ts';
import {
  applyImportBatch,
  listImports,
  listImportsInSlot,
  type CollectionRecord,
} from '../storage/imports.ts';
import type { RecordCollection } from '../storage/schema.ts';
import { createCheckpoint } from './checkpoints.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

export interface ImportSource {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** 使用者確認後的類型與時點（需求規格 11.1、IMP-02、IMP-03）。 */
export interface ImportChoice {
  readonly type: ImportType;
  readonly gameYear: number;
  readonly timing: Timing;
}

/** 選檔或拖放後先看檔名，給使用者確認的預選；解析不出來時由使用者選類型並輸入年份。 */
export function readFileNameHint(fileName: string): FileNameHint | undefined {
  return parseImportFileName(fileName);
}

export interface ImportBuildInput<TRow extends PreviewRow> {
  readonly game: Game;
  /** 已排除錯誤列與未勾選列的待套用列。 */
  readonly rows: readonly TRow[];
  readonly choice: ImportChoice;
  readonly newId: () => string;
  readonly occurredAt: string;
}

export interface ImportBuildOutput {
  readonly records: readonly CollectionRecord[];
  readonly events: readonly HistoryEvent[];
}

/** 各匯入類型自己實作的部分；通用流程只認得預覽分類與要寫的紀錄。 */
export interface ImportHandler<TRow extends PreviewRow> {
  readonly type: ImportType;
  readonly collections: readonly RecordCollection[];
  /** 預覽：讀出需要的既有資料並逐列分類。所有讀取都在這裡完成。 */
  readonly preview: (
    context: ServiceContext,
    game: Game,
    file: ParsedFile,
    choice: ImportChoice,
  ) => Promise<readonly TRow[]>;
  /** 套用：在寫入交易內呼叫，只能做同步運算。 */
  readonly build: (input: ImportBuildInput<TRow>) => ImportBuildOutput;
  /** 同一個年與時點本來就會有多份不同的檔案時為 true（目標種牡馬 TXT，STL-05）。 */
  readonly manyPerSlot?: boolean;
}

export interface PreparedImport<TRow extends PreviewRow> {
  /** 產生這份預覽時的遊戲局；套用前確認沒有換局。 */
  readonly gameId: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly choice: ImportChoice;
  readonly rows: readonly TRow[];
  readonly summary: ImportSummary;
  readonly repeat: RepeatCheck;
  readonly year: YearDecision;
  /** 年度總表套用後自動建立檢查點（需求規格 11.1、IMP-12）。 */
  readonly createsCheckpoint: boolean;
}

function halted(problems: readonly string[]): ServiceError {
  return new ServiceError('importHalted', `匯入停止，資料不變：${problems.join('；')}`);
}

/**
 * 解析 → 驗證 → 身分配對 → 差異預覽（需求規格 11.1）。這一步只讀不寫；
 * 解碼、分隔、欄數或必要欄位無法辨識時就停止，不回傳部分結果（IMP-04、IMP-06）。
 */
export async function prepareImport<TRow extends PreviewRow>(
  context: ServiceContext,
  handler: ImportHandler<TRow>,
  source: ImportSource,
  choice: ImportChoice,
): Promise<PreparedImport<TRow>> {
  if (handler.type !== choice.type) {
    throw new ServiceError('invalidInput', '匯入類型與處理器不一致');
  }
  const game = await requireCurrentGame(context);
  const parsed = parseImportFile(source.bytes, FORMAT_OF_IMPORT_TYPE[handler.type]);
  if (!parsed.ok) {
    throw halted(parsed.problems);
  }
  // 雜湊算在解碼後的文字上，而不是原始位元組：同一份內容轉存成 UTF-8 應該算重複匯入，
  // 而不是內容不同的「資料更正」（需求規格 11.1）。
  const sha256 = await sha256Hex(parsed.file.text);
  const rows = await handler.preview(context, game, parsed.file, choice);
  const [sameSlot, allImports] = await Promise.all([
    listImportsInSlot(context.database, game.id, handler.type, choice.gameYear, choice.timing),
    listImports(context.database, game.id),
  ]);
  return {
    gameId: game.id,
    fileName: source.fileName,
    sha256,
    choice,
    rows,
    summary: summarise(rows),
    repeat: checkRepeat(sameSlot, sha256, handler.manyPerSlot === true),
    year: decideYear(
      choice.gameYear,
      choice.timing,
      game.currentYear,
      allImports.filter((batch) => isYearlyTotal(batch.type)),
    ),
    createsCheckpoint: isYearlyTotal(handler.type),
  };
}

export interface ApplyImportOptions {
  /** 已確認資料更正（IMP-08）。 */
  readonly confirmCorrection?: boolean;
  /** 已確認推進遊戲年（IMP-14）；不確認則不套用。 */
  readonly confirmAdvanceYear?: boolean;
  /** 已確認檔案早於目前進度仍要套用（IMP-09）。 */
  readonly confirmBehindProgress?: boolean;
  /** 已確認預覽裡的警告列（需求規格 5.2「警告並要求確認」）。 */
  readonly confirmWarnings?: boolean;
  /** 只套用這些列（`PreviewRow.key`）；省略時套用全部可套用的列（候選 TXT 的勾選，CAND-02）。 */
  readonly selectedKeys?: readonly string[];
}

export interface ImportResult {
  readonly batch: ImportBatch;
  readonly appliedRows: number;
  /** 自動建立的檢查點；建立失敗不影響匯入（IMP-12）。 */
  readonly checkpointId?: string;
  readonly checkpointProblem?: string;
  readonly advancedToYear?: number;
}

function requireConfirmations<TRow extends PreviewRow>(
  prepared: PreparedImport<TRow>,
  options: ApplyImportOptions,
): void {
  // 依實際要套用的列判斷，不看預覽當下的摘要：呼叫端可能更正過處置（MARE-09、STL-10），
  // 那會改變錯誤與警告的列數。
  const summary = summarise(prepared.rows);
  if (hasBlockingError(prepared.rows)) {
    throw halted([`有 ${String(summary.error)} 列錯誤`]);
  }
  if (prepared.repeat.kind === 'duplicate') {
    throw new ServiceError(
      'importDuplicate',
      '這份檔案已經在同一年、同一時點匯入過，不重複建立歷程',
    );
  }
  if (prepared.repeat.kind === 'correction' && options.confirmCorrection !== true) {
    throw new ServiceError(
      'confirmationRequired',
      '同年同時點已有不同內容的匯入，請先確認資料更正',
    );
  }
  if (prepared.year.kind === 'advance' && options.confirmAdvanceYear !== true) {
    throw new ServiceError(
      'confirmationRequired',
      `檔案是 ${String(prepared.year.to)} 年的資料，請先確認要推進遊戲年`,
    );
  }
  if (prepared.year.kind === 'behind' && options.confirmBehindProgress !== true) {
    throw new ServiceError(
      'confirmationRequired',
      '檔案早於目前進度，建議先回溯到對應的檢查點；確認後才會套用',
    );
  }
  if (summary.warn > 0 && options.confirmWarnings !== true) {
    throw new ServiceError(
      'confirmationRequired',
      `有 ${String(summary.warn)} 列警告，請先確認後再套用`,
    );
  }
}

/**
 * 結果摘要（IMP-11）記的是實際發生的事：沒有勾選的可套用列在這次匯入裡就是略過，
 * 不能沿用預覽的分類，否則歷程會說套用了 30 筆而實際只寫了 2 筆。
 */
function appliedSummary<TRow extends PreviewRow>(
  prepared: PreparedImport<TRow>,
  applied: readonly TRow[],
): ImportSummary {
  const keys = new Set(applied.map((row) => row.key));
  return summarise(
    prepared.rows.map((row) =>
      (row.outcome === 'apply' || row.outcome === 'warn') && !keys.has(row.key)
        ? { ...row, outcome: 'skip' as const }
        : row,
    ),
  );
}

function selectRows<TRow extends PreviewRow>(
  prepared: PreparedImport<TRow>,
  options: ApplyImportOptions,
): readonly TRow[] {
  const selected = options.selectedKeys;
  // 預覽分類就是處置：可套用與（確認過的）警告會寫入，略過、待核對不寫，錯誤讓整份停止。
  return prepared.rows.filter(
    (row) =>
      (row.outcome === 'apply' || row.outcome === 'warn') &&
      (selected === undefined || selected.includes(row.key)),
  );
}

/**
 * 確認 → 單一交易套用 → 結果摘要（需求規格 11.1）。年度總表套用成功後自動建立檢查點，
 * 檢查點失敗不讓匯入跟著失敗（IMP-12）。
 */
export async function applyImport<TRow extends PreviewRow>(
  context: ServiceContext,
  handler: ImportHandler<TRow>,
  prepared: PreparedImport<TRow>,
  options: ApplyImportOptions = {},
): Promise<ImportResult> {
  const game = await requireCurrentGame(context);
  if (game.id !== prepared.gameId) {
    throw new ServiceError('invalidInput', '預覽是在另一個遊戲局產生的，請重新產生預覽');
  }
  requireConfirmations(prepared, options);
  const rows = selectRows(prepared, options);
  const occurredAt = context.now().toISOString();
  const { choice } = prepared;
  const advancedToYear = prepared.year.kind === 'advance' ? prepared.year.to : undefined;
  const batchId = context.newId();
  const previous = prepared.repeat.kind === 'correction' ? prepared.repeat.previous : undefined;

  const writes = await trackWrite(context, () =>
    applyImportBatch(context.database, {
      gameId: game.id,
      touch: gameTouch(context, occurredAt),
      collections: handler.collections,
      build: (stored) => {
        // 先推進年份再套用（需求規格 11.1）：同一個交易內兩件事都會發生。
        // 只往前推進：期間若已經推到更晚的年份，這次匯入不把它拉回來。
        const advancing = advancedToYear !== undefined && advancedToYear > stored.currentYear;
        const withYear: Game = advancing ? { ...stored, currentYear: advancedToYear } : stored;
        const built = handler.build({
          game: withYear,
          rows,
          choice,
          newId: context.newId,
          occurredAt,
        });
        const yearEvent: HistoryEvent[] = advancing
          ? [
              {
                id: context.newId(),
                subjectId: GAME_SUBJECT_ID,
                type: 'gameYearChanged',
                gameYear: advancedToYear,
                before: stored.currentYear,
                after: advancedToYear,
                source: 'user',
                occurredAt,
              },
            ]
          : [];
        const batch: ImportBatch = {
          id: batchId,
          type: handler.type,
          gameYear: choice.gameYear,
          timing: choice.timing,
          fileName: prepared.fileName,
          sha256: prepared.sha256,
          summary: appliedSummary(prepared, rows),
          appliedAt: occurredAt,
          ...(previous === undefined ? {} : { correctionOf: previous.id }),
        };
        return {
          batch,
          records: built.records,
          events: [...yearEvent, ...built.events],
          ...(advancing ? { currentYear: advancedToYear } : {}),
        };
      },
    }),
  );

  const checkpoint = prepared.createsCheckpoint
    ? await createCheckpointAfterImport(context, writes.batch)
    : {};
  return {
    batch: writes.batch,
    appliedRows: rows.length,
    ...checkpoint,
    ...(advancedToYear === undefined ? {} : { advancedToYear }),
  };
}

interface CheckpointOutcome {
  readonly checkpointId?: string;
  readonly checkpointProblem?: string;
}

/** 年度總表套用後自動建立檢查點；失敗只回報，不讓匯入跟著失敗（IMP-12）。 */
async function createCheckpointAfterImport(
  context: ServiceContext,
  batch: ImportBatch,
): Promise<CheckpointOutcome> {
  try {
    const { checkpoint } = await createCheckpoint(context, {
      note: `匯入 ${batch.fileName}`,
      timing: batch.timing,
    });
    return { checkpointId: checkpoint.id };
  } catch (error) {
    return { checkpointProblem: error instanceof Error ? error.message : String(error) };
  }
}

/** 目前遊戲局的匯入歷程（需求規格 11.1、IMP-11）。 */
export async function listImportHistory(context: ServiceContext): Promise<ImportBatch[]> {
  const game = await requireCurrentGame(context);
  const batches = await listImports(context.database, game.id);
  return batches.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
}
