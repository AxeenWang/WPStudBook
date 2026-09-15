const INVALID_FILE_CHARACTERS = /[\\/:*?"<>|\p{Cc}]/gu;
const TRAILING_DOTS_AND_SPACES = /[. ]+$/u;

export interface BackupFileNameInput {
  readonly gameName: string;
  readonly currentYear: number;
  readonly exportedAt: string;
  readonly compressed: boolean;
}

export function backupFileName(input: BackupFileNameInput): string {
  const cleaned = input.gameName
    .replace(INVALID_FILE_CHARACTERS, '_')
    .replace(TRAILING_DOTS_AND_SPACES, '');
  const safeName = cleaned === '' ? 'game' : cleaned;
  const stamp = input.exportedAt
    .slice(0, 19)
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('T', '-');
  const extension = input.compressed ? 'json.gz' : 'json';
  return `WPStudBook_${safeName}_${String(input.currentYear)}年_${stamp}.${extension}`;
}
