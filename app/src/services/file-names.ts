const INVALID_FILE_CHARACTERS = /[\\/:*?"<>|\p{Cc}]/gu;
const TRAILING_DOTS_AND_SPACES = /[. ]+$/u;

export interface BackupFileNameInput {
  readonly gameName: string;
  readonly currentYear: number;
  readonly exportedAt: string;
  readonly compressed: boolean;
}

export type RawExportFileNameInput = Omit<BackupFileNameInput, 'compressed'>;

function fileNameStem(input: RawExportFileNameInput): string {
  const cleaned = input.gameName
    .replace(INVALID_FILE_CHARACTERS, '_')
    .replace(TRAILING_DOTS_AND_SPACES, '');
  const safeName = cleaned === '' ? 'game' : cleaned;
  const stamp = input.exportedAt
    .slice(0, 19)
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('T', '-');
  return `WPStudBook_${safeName}_${String(input.currentYear)}年_${stamp}`;
}

export function backupFileName(input: BackupFileNameInput): string {
  return `${fileNameStem(input)}.${input.compressed ? 'json.gz' : 'json'}`;
}

/** 原始資料匯出（設計決策 5.4 節）：檔名標示不能還原。 */
export function rawExportFileName(input: RawExportFileNameInput): string {
  return `${fileNameStem(input)}_原始資料_不能還原.json`;
}
