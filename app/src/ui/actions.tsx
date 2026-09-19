import { useId, useState } from 'react';
import { fieldIssuesOf, type FieldIssues } from '../services/errors.ts';
import { errorMessage } from './format.ts';
import { useServices } from './ServicesContext.tsx';

/** 表單送出：忙碌中忽略重複送出，完成後顯示訊息並讓查詢重新載入。 */
export function useAction() {
  const { notifyChanged } = useServices();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<FieldIssues>({});
  const run = async (action: () => Promise<string>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      setMessage(await action());
      setError(undefined);
      setFields({});
    } catch (caught) {
      setMessage(undefined);
      setError(errorMessage(caught));
      setFields(fieldIssuesOf(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };
  return { busy, message, error, fields, run };
}

/** 表單送出後內容可能被卸載時，由不會卸載的上層持有並把 run 傳給表單，訊息才會留在畫面上。 */
export type ActionState = ReturnType<typeof useAction>;

/**
 * 送出結果。id 提供時錯誤訊息帶上這個 id，表單以 aria-describedby 指向它，
 * 讓錯誤與表單建立關聯（需求規格 13.5、UI-05）。
 */
export function Feedback({
  message,
  error,
  id,
}: {
  readonly message: string | undefined;
  readonly error: string | undefined;
  readonly id?: string | undefined;
}) {
  return (
    <>
      {message !== undefined && <p role="status">{message}</p>}
      {error !== undefined && (
        <p role="alert" id={id}>
          {error}
        </p>
      )}
    </>
  );
}

/** 表單的 aria-describedby：有錯誤時指向錯誤訊息；沒有錯誤時不加屬性（展開到表單上）。 */
export function describedByError(
  errorId: string,
  error: string | undefined,
): { readonly 'aria-describedby'?: string } {
  return error === undefined ? {} : { 'aria-describedby': errorId };
}

/**
 * 表單錯誤與表單的關聯：回傳錯誤訊息要用的 id，以及展開到 Form 上的 aria-describedby。
 * 用法：const link = useErrorLink(error); <Form {...link.formProps}> … <Feedback id={link.id} />
 */
export function useErrorLink(error: string | undefined): {
  readonly id: string;
  readonly formProps: { readonly 'aria-describedby'?: string };
} {
  const id = useId();
  return { id, formProps: describedByError(id, error) };
}
