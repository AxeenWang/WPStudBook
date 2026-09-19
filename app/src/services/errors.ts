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

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServiceError';
    this.code = code;
  }
}
