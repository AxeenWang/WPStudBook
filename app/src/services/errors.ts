export type ServiceErrorCode =
  | 'invalidInput'
  | 'gameNotFound'
  | 'noCurrentGame'
  | 'confirmationMismatch'
  | 'backupRejected'
  | 'checkpointNotFound'
  | 'checkpointInvalid'
  | 'deliveryFailed';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServiceError';
    this.code = code;
  }
}
