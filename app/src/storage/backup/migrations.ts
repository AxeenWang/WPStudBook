import { describeError } from '../describe-error.ts';

export interface BackupPayload {
  readonly game: unknown;
  readonly collections: Readonly<Record<string, unknown>>;
}

export interface BackupMigration {
  /** 把第 from 版的內容轉成第 from + 1 版。 */
  readonly from: number;
  readonly migrate: (payload: BackupPayload) => BackupPayload;
}

/** 正式的遷移清單。結構改版時新增一筆，並補上以舊版本備份驗證的測試（設計決策 5.6 節）。 */
export const BACKUP_MIGRATIONS: readonly BackupMigration[] = [];

export type MigrationResult =
  | { readonly ok: true; readonly payload: BackupPayload }
  | {
      readonly ok: false;
      readonly code: 'unsupportedVersion' | 'migrationFailed';
      readonly message: string;
    };

export function migrateBackupPayload(
  payload: BackupPayload,
  fromVersion: number,
  toVersion: number,
  migrations: readonly BackupMigration[],
): MigrationResult {
  let current = payload;
  for (let version = fromVersion; version < toVersion; version += 1) {
    const migration = migrations.find((item) => item.from === version);
    if (migration === undefined) {
      return {
        ok: false,
        code: 'unsupportedVersion',
        message: `沒有第 ${String(version)} 版到第 ${String(version + 1)} 版的遷移，無法讀取此備份`,
      };
    }
    try {
      current = migration.migrate(current);
    } catch (error) {
      return {
        ok: false,
        code: 'migrationFailed',
        message: `第 ${String(version)} 版遷移失敗：${describeError(error)}`,
      };
    }
  }
  return { ok: true, payload: current };
}
