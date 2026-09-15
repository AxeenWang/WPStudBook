import { ServiceError } from './errors.ts';

/** 需求規格 5.2「警告並要求確認」的一項警告。 */
export interface ServiceWarning<Code extends string = string> {
  readonly code: Code;
  readonly message: string;
}

/** 有尚未確認的警告時拒絕寫入；呼叫端先以檢查函式把警告交給使用者確認。 */
export function requireAcceptedWarnings<Code extends string>(
  warnings: readonly ServiceWarning<Code>[],
  accepted: readonly Code[],
): void {
  const pending = warnings.filter((warning) => !accepted.includes(warning.code));
  if (pending.length > 0) {
    throw new ServiceError(
      'confirmationRequired',
      pending.map((warning) => warning.message).join('\n'),
    );
  }
}
