import { useState } from 'react';
import { errorMessage } from './format.ts';
import { useServices } from './ServicesContext.tsx';

/** 表單送出：忙碌中忽略重複送出，完成後顯示訊息並讓查詢重新載入。 */
export function useAction() {
  const { notifyChanged } = useServices();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (action: () => Promise<string>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      setMessage(await action());
      setError(undefined);
    } catch (caught) {
      setMessage(undefined);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      notifyChanged();
    }
  };
  return { busy, message, error, run };
}

/** 表單送出後內容可能被卸載時，由不會卸載的上層持有並把 run 傳給表單，訊息才會留在畫面上。 */
export type ActionState = ReturnType<typeof useAction>;

export function Feedback({
  message,
  error,
}: {
  readonly message: string | undefined;
  readonly error: string | undefined;
}) {
  return (
    <>
      {message !== undefined && <p role="status">{message}</p>}
      {error !== undefined && <p role="alert">{error}</p>}
    </>
  );
}
