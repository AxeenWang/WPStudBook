import { useCallback, useState } from 'react';
import type { ServiceContext } from '../../services/context.ts';
import { previewSellMare, sellMare } from '../../services/mares.ts';
import { ConfirmDialog } from '../dialogs.tsx';
import { errorMessage } from '../format.ts';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { formatMareGroup } from './labels.ts';

interface SellMareDialogProps {
  readonly mareId: string;
  /** 賣出成功時傳入馬名，取消時傳入 undefined。 */
  readonly onClose: (soldName: string | undefined) => void;
}

/** 賣出前顯示影響並確認（需求規格 8.5）。 */
export function SellMareDialog({ mareId, onClose }: SellMareDialogProps) {
  const { context, notifyChanged } = useServices();
  const load = useCallback(
    (serviceContext: ServiceContext) => previewSellMare(serviceContext, mareId),
    [mareId],
  );
  const { data: preview, error } = useServiceQuery(load);
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  const sell = async () => {
    if (preview === undefined || busy) {
      return;
    }
    setBusy(true);
    try {
      await sellMare(context, mareId);
      onClose(preview.name);
    } catch (caught) {
      setFailure(errorMessage(caught));
      setBusy(false);
    } finally {
      notifyChanged();
    }
  };

  return (
    <ConfirmDialog
      title="賣出繁殖牝馬"
      confirmLabel="確認賣出"
      isDestructive
      isConfirmDisabled={preview === undefined || busy}
      onCancel={() => {
        onClose(undefined);
      }}
      onConfirm={() => {
        void sell();
      }}
    >
      {preview === undefined ? (
        error === undefined ? (
          <p role="status">載入中…</p>
        ) : (
          <p role="alert">{error}</p>
        )
      ) : (
        <>
          <p>
            賣出「{preview.name}」後，她會離開{formatMareGroup(preview.group)}所在的母馬群
            {preview.producingInGroup !== undefined &&
              `（生產中 ${String(preview.producingInGroup)} → ${String(preview.producingInGroup - 1)} 匹）`}
            。
          </p>
          <p>
            母馬本身與配種、產駒、接替紀錄和血緣都會保留，之後可在狀態篩選選「已離圈」查看。玩家不能讓母馬引退，引退只由定年判定。
          </p>
        </>
      )}
      {failure !== undefined && <p role="alert">{failure}</p>}
    </ConfirmDialog>
  );
}
