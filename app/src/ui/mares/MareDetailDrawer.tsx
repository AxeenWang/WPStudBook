import { useCallback } from 'react';
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  type Key,
} from 'react-aria-components';
import type { ServiceContext } from '../../services/context.ts';
import { loadMareDetail, type MareDetail } from '../../services/mares.ts';
import { PedigreeView } from '../pedigree/PedigreeView.tsx';
import { useServiceQuery } from '../ServicesContext.tsx';
import { MareBreeding } from './MareBreeding.tsx';
import { MareFoals } from './MareFoals.tsx';
import { MareHistory } from './MareHistory.tsx';
import { MareSummary } from './MareSummary.tsx';

export const MARE_DETAIL_TABS = [
  ['summary', '概要'],
  ['breeding', '配種'],
  ['foals', '產駒'],
  ['pedigree', '血緣'],
  ['history', '歷程'],
] as const;

export type MareDetailTab = (typeof MARE_DETAIL_TABS)[number][0];

function isDetailTab(key: Key): key is MareDetailTab {
  return MARE_DETAIL_TABS.some(([id]) => id === key);
}

function PedigreeBrief({ detail }: { readonly detail: MareDetail }) {
  return (
    <>
      <dl className="detail-list">
        <div>
          <dt>父馬</dt>
          <dd>{detail.sireName ?? '未取得'}</dd>
        </div>
        <div>
          <dt>母馬</dt>
          <dd>{detail.damName ?? '未取得'}</dd>
        </div>
        <div>
          <dt>自身父系</dt>
          <dd>{detail.card.sireSubsystem ?? '未填'}</dd>
        </div>
      </dl>
      <PedigreeView horseId={detail.card.id} />
    </>
  );
}

interface MareDetailDrawerProps {
  readonly mareId: string;
  readonly tab: MareDetailTab;
  readonly onTabChange: (tab: MareDetailTab) => void;
  readonly onClose: () => void;
}

/**
 * 右側藍色詳情欄（需求規格 13.4、UI-02）：五個頁籤，預設概要並保留本次最後查看的頁籤（由母馬群頁保存）。
 * 點欄外、X 或 Esc 關閉；react-aria 的 Modal 在開啟時把焦點移入，關閉後還原到開啟前的焦點。
 */
export function MareDetailDrawer({ mareId, tab, onTabChange, onClose }: MareDetailDrawerProps) {
  const load = useCallback(
    (serviceContext: ServiceContext) => loadMareDetail(serviceContext, mareId),
    [mareId],
  );
  const { data: detail, error } = useServiceQuery(load);
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      className="drawer-overlay"
    >
      <Modal className="drawer">
        <Dialog className="dialog">
          <div className="drawer-header">
            <Heading slot="title">
              {detail === undefined ? '繁殖牝馬詳情' : `「${detail.card.name}」詳情`}
            </Heading>
            <Button slot="close" aria-label="關閉">
              X
            </Button>
          </div>
          {detail === undefined ? (
            error === undefined ? (
              <p role="status">載入中…</p>
            ) : (
              <p role="alert">{error}</p>
            )
          ) : (
            <Tabs
              selectedKey={tab}
              onSelectionChange={(key) => {
                if (isDetailTab(key)) {
                  onTabChange(key);
                }
              }}
            >
              <TabList aria-label="詳情頁籤">
                {MARE_DETAIL_TABS.map(([id, label]) => (
                  <Tab key={id} id={id}>
                    {label}
                  </Tab>
                ))}
              </TabList>
              <TabPanel id="summary">
                <MareSummary detail={detail} />
              </TabPanel>
              <TabPanel id="breeding">
                <MareBreeding mareId={mareId} />
              </TabPanel>
              <TabPanel id="foals">
                <MareFoals mareId={mareId} />
              </TabPanel>
              <TabPanel id="pedigree">
                <PedigreeBrief detail={detail} />
              </TabPanel>
              <TabPanel id="history">
                <MareHistory items={detail.history} />
              </TabPanel>
            </Tabs>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
