export type ServiceErrorCode =
  | 'invalidInput'
  | 'gameNotFound'
  | 'noCurrentGame'
  | 'confirmationMismatch'
  | 'backupRejected'
  | 'checkpointNotFound'
  | 'checkpointInvalid'
  | 'deliveryFailed'
  /** 有使用者尚未確認的警告（需求規格 5.2）。 */
  | 'confirmationRequired';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServiceError';
    this.code = code;
  }
}
