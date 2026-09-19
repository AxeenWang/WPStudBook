import { useId } from 'react';
import { Feedback, type ActionState } from '../actions.tsx';

/**
 * 「產生預覽」按鈕與結果訊息。匯入檔停止套用時的錯誤屬於整份檔案，不屬於單一欄位，
 * 以 aria-describedby 與觸發它的按鈕建立關聯（需求規格 13.5、UI-05）。
 */
export function PreviewControls({
  action,
  onPreview,
}: {
  readonly action: ActionState;
  readonly onPreview: () => void;
}) {
  const errorId = useId();
  return (
    <>
      <button
        type="button"
        onClick={onPreview}
        disabled={action.busy}
        aria-describedby={action.error === undefined ? undefined : errorId}
      >
        產生預覽
      </button>
      <Feedback message={action.message} error={action.error} id={errorId} />
    </>
  );
}
