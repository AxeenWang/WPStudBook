/**
 * 封存索引（需求規格 12.3、設計決策 5.2 節 `archives`）：移除一局的本機明細後保留的輕量紀錄。
 * 明細只在封存檔裡；還原時以 sha256 核對選到的是同一份封存檔。
 */
export interface ArchiveEntry {
  readonly id: string;
  readonly gameName: string;
  /** 年份範圍：起始年～封存時的目前遊戲年。 */
  readonly startYear: number;
  readonly endYear: number;
  /** 封存檔的程式版本與結構版本。 */
  readonly appVersion: string;
  readonly schemaVersion: number;
  /** 封存檔產生的時間（封存檔內的 exportedAt）。 */
  readonly exportedAt: string;
  /** 移除本機明細的時間。 */
  readonly archivedAt: string;
  /** 使用者選回核對的封存檔檔名。 */
  readonly fileName: string;
  readonly sizeBytes: number;
  /** 各資料表筆數，鍵為備份 collections 的資料表名稱。 */
  readonly counts: Readonly<Record<string, number>>;
  readonly recordCount: number;
  /** 驗證摘要：封存檔內容的 SHA-256（設計決策 5.4 節）。 */
  readonly sha256: string;
}

/** 新到舊；同一時間依 id 排序，順序固定。 */
export function sortArchivesNewestFirst(entries: readonly ArchiveEntry[]): ArchiveEntry[] {
  return [...entries].sort((a, b) => {
    if (a.archivedAt !== b.archivedAt) {
      return a.archivedAt < b.archivedAt ? 1 : -1;
    }
    if (a.id === b.id) {
      return 0;
    }
    return a.id < b.id ? -1 : 1;
  });
}
