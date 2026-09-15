export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const day = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatCount(count: number): string {
  return `${count.toLocaleString('en-US')} 筆`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const CHINESE_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

function chineseNumber(value: number): string {
  const tens = Math.floor(value / 10);
  const ones = CHINESE_DIGITS[value % 10] ?? '';
  if (tens === 0) {
    return ones;
  }
  return `${tens === 1 ? '' : (CHINESE_DIGITS[tens] ?? '')}十${ones}`;
}

/** 代數的介面文字（需求規格 3 章「代數」）：0 零代、1 初代，之後二代、三代…；100 以上用數字。 */
export function formatGeneration(generation: number): string {
  if (generation === 0) {
    return '零代';
  }
  if (generation === 1) {
    return '初代';
  }
  return generation < 100 ? `${chineseNumber(generation)}代` : `${String(generation)} 代`;
}
