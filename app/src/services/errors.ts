export type ServiceErrorCode =
  | 'invalidInput'
  | 'gameNotFound'
  | 'noCurrentGame'
  | 'confirmationMismatch'
  | 'backupRejected'
  | 'checkpointNotFound'
  | 'checkpointInvalid'
  | 'deliveryFailed'
  /** 封存檔無法產生、驗證失敗，或與遊戲局目前的資料不一致（需求規格 12.3、DATA-09）。 */
  | 'archiveRejected'
  | 'archiveNotFound'
  /** 有使用者尚未確認的警告（需求規格 5.2）。 */
  | 'confirmationRequired'
  /** 匯入檔停止套用：解碼、分隔、欄數或必要欄位無法辨識，或有阻擋錯誤（需求規格 11.1、IMP-06）。 */
  | 'importHalted'
  /** 同局、同年、同時點、同類型、同內容雜湊的匯入，不重複建立歷程（IMP-07）。 */
  | 'importDuplicate';

/** 欄位名稱 → 該欄位的第一個問題；鍵是服務輸入的屬性名稱，由介面對應到欄位。 */
export type FieldIssues = Readonly<Record<string, string>>;

export interface ServiceErrorOptions extends ErrorOptions {
  /** 輸入問題屬於哪些欄位（需求規格 13.5、UI-05：欄位錯誤與訊息建立關聯）。 */
  readonly fields?: FieldIssues | undefined;
}

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly fields: FieldIssues;

  constructor(code: ServiceErrorCode, message: string, options?: ServiceErrorOptions) {
    super(message, options);
    this.name = 'ServiceError';
    this.code = code;
    this.fields = options?.fields ?? {};
  }
}

/** 錯誤帶有的欄位問題；不是 ServiceError 時沒有。 */
export function fieldIssuesOf(error: unknown): FieldIssues {
  return error instanceof ServiceError ? error.fields : {};
}

/**
 * 輸入檢查的問題清單：訊息依發現順序排列，並記下屬於哪個欄位（每個欄位只記第一個問題）。
 * 不屬於單一欄位的問題（例如與既有資料衝突）field 傳 undefined，只出現在訊息清單。
 */
export class InputIssues {
  readonly #messages: string[] = [];
  readonly #fields: Record<string, string> = {};

  add(field: string | undefined, message: string): void {
    this.#messages.push(message);
    if (field !== undefined && !(field in this.#fields)) {
      this.#fields[field] = message;
    }
  }

  get messages(): readonly string[] {
    return this.#messages;
  }

  get fields(): FieldIssues {
    return { ...this.#fields };
  }

  get isEmpty(): boolean {
    return this.#messages.length === 0;
  }

  /** 有問題時丟出 invalidInput：訊息以「；」連接，並帶上欄位對照。 */
  throwIfAny(): void {
    if (!this.isEmpty) {
      throw new ServiceError('invalidInput', this.#messages.join('；'), { fields: this.fields });
    }
  }
}
