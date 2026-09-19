import { useRef } from 'react';
import { Button } from 'react-aria-components';
import type { MareCard } from '../../services/mare-list.ts';
import { isCeExtended } from '../../services/mares.ts';
import { formatGeneration } from '../format.ts';
import type { MareDetailTab } from './MareDetailDrawer.tsx';
import {
  ORIGIN_LABELS,
  SITE_LABELS,
  SUCCESSION_LABELS,
  YEAR_PLAN_LABELS,
  formatMareGroup,
  formatStatus,
  formatVitality,
} from './labels.ts';

interface MareCardItemProps {
  readonly card: MareCard;
  readonly vitalityThreshold: number | undefined;
  /** 開啟詳情欄；帶頁籤時直接切到那一頁（卡片上的「配種」）。 */
  readonly onOpen: (tab?: MareDetailTab) => void;
  readonly onSell: () => void;
}

function femaleLineText(femaleLine: string | undefined): string {
  if (femaleLine === undefined) {
    return '未取得';
  }
  return femaleLine === '' ? '不屬於具名牝系' : femaleLine;
}

/** 卡片上的注意事項；文字與測試代號沿用原本的提示（需求規格 8.5、8.8、13.3）。 */
function MareNotices({
  card,
  vitalityThreshold,
}: {
  readonly card: MareCard;
  readonly vitalityThreshold: number | undefined;
}) {
  const notices = [
    card.atRetirementAge && {
      key: 'retire',
      testId: 'mare-retirement-age',
      text: '已達定年，不列入任務',
    },
    card.lastBreedingAge && {
      key: 'last',
      testId: 'mare-last-breeding-age',
      text: '最後值得配種的年齡',
    },
    card.highAge && { key: 'high', testId: undefined, text: '產駒素質可能下降，可考慮出售' },
    card.suggestSellMother && {
      key: 'mother',
      testId: 'mare-sell-mother',
      text: '女兒已轉入且今年已生產，可考慮出售',
    },
    card.hasUnnamedFoal && { key: 'unnamed', testId: undefined, text: '有未命名產駒' },
    card.belowThreshold &&
      vitalityThreshold !== undefined && {
        key: 'threshold',
        testId: undefined,
        text: `活力低於建議門檻 ${String(vitalityThreshold)}`,
      },
  ].filter((notice) => notice !== false);
  if (notices.length === 0) {
    return null;
  }
  return (
    <ul className="mare-notices" aria-label="注意事項">
      {notices.map((notice) => (
        <li key={notice.key} data-testid={notice.testId}>
          {notice.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * 母馬卡片（需求規格 13.3、UI-01）：標頭是馬名與用途、代數、據點，下面是狀態標籤、活力條、
 * 其他欄位與注意事項。操作只有「配種」（開詳情欄的配種頁）與「賣出」，沒有退役（8.5）。
 */
export function MareCardItem({ card, vitalityThreshold, onOpen, onSell }: MareCardItemProps) {
  const nameButton = useRef<HTMLButtonElement>(null);
  const { vitality, month } = card.vitality;
  const producing = card.status === 'producing';
  const confirmed = vitality.state === 'confirmed' ? vitality : undefined;
  const low = confirmed !== undefined && card.belowThreshold;
  return (
    <li
      className="mare-card"
      data-status={card.status}
      onClick={(event) => {
        // 點卡片開啟詳情欄；卡片內的按鈕與表單元件各自處理。先把焦點移到馬名按鈕，關閉後焦點回到這裡。
        if (
          event.target instanceof Element &&
          event.target.closest('button, a, input, select, textarea') !== null
        ) {
          return;
        }
        nameButton.current?.focus();
        onOpen();
      }}
    >
      <article aria-label={card.name}>
        <div className="mare-top">
          <h4 className="mare-name">
            <Button
              ref={nameButton}
              className="link-button"
              onPress={() => {
                onOpen();
              }}
            >
              {card.name}
            </Button>
          </h4>
          <p className="mare-meta">
            <span data-testid="mare-usage">{formatMareGroup(card.group)}</span>
            <span aria-hidden="true">・</span>
            <span data-testid="mare-generation">
              {card.generation === undefined ? '—' : formatGeneration(card.generation)}
            </span>
            <span aria-hidden="true">・</span>
            <span data-testid="mare-site">{SITE_LABELS[card.site]}</span>
            <span aria-hidden="true">・</span>
            <span>{card.age === undefined ? '年齡未知' : `${String(card.age)} 歲`}</span>
          </p>
        </div>
        <ul className="tag-row" aria-label="標籤">
          <li className={`tag ${producing ? 'tag-green' : ''}`} data-testid="mare-status">
            {formatStatus(card.status, card.leftReason)}・{ORIGIN_LABELS[card.origin]}
          </li>
          <li className="tag">
            今年計畫 <strong data-testid="mare-plan">{YEAR_PLAN_LABELS[card.yearPlan]}</strong>
          </li>
          <li className={`tag ${card.conception === undefined ? '' : 'tag-green'}`}>
            受胎 <strong>{card.conception ?? '未登記'}</strong>
          </li>
          {card.succession !== undefined && (
            <li className="tag tag-amber">
              接替{' '}
              <strong data-testid="mare-succession">{SUCCESSION_LABELS[card.succession]}</strong>
            </li>
          )}
        </ul>
        <div className="vitality-block">
          <p className="vitality-meta">
            <span>活力</span>
            <strong data-testid="mare-vitality">
              {confirmed !== undefined && (
                <meter
                  min={0}
                  max={100}
                  low={vitalityThreshold}
                  optimum={100}
                  value={confirmed.value}
                  aria-label="活力"
                  className="visually-hidden"
                />
              )}
              {formatVitality(vitality, month)}
            </strong>
          </p>
          <div
            className="vitality-track"
            data-state={vitality.state}
            data-low={low}
            aria-hidden="true"
          >
            {confirmed !== undefined && (
              <span className="vitality-fill" style={{ width: `${String(confirmed.value)}%` }} />
            )}
          </div>
        </div>
        <dl className="mare-facts">
          <div>
            <dt>自身父系</dt>
            <dd>{card.sireSubsystem ?? '未填'}</dd>
          </div>
          <div>
            <dt>牝系</dt>
            <dd>{femaleLineText(card.femaleLine)}</dd>
          </div>
          <div>
            <dt>仔出</dt>
            <dd data-testid="mare-kodashi">
              {card.kodashi === undefined
                ? '未取得'
                : `${String(card.kodashi.value)}（${String(card.kodashi.gameYear)} 年）`}
              {card.kodashi !== undefined && isCeExtended(card.kodashi.value) && (
                <span className="badge">CE 擴充值</span>
              )}
            </dd>
          </div>
        </dl>
        <MareNotices card={card} vitalityThreshold={vitalityThreshold} />
        <div className="mare-actions">
          {producing && (
            <>
              <Button
                className="button-small button-primary"
                onPress={() => {
                  onOpen('breeding');
                }}
              >
                配種
              </Button>
              <Button className="button-small button-danger" onPress={onSell}>
                賣出
              </Button>
            </>
          )}
          <span className="card-open-hint">點卡片看概要、配種、產駒、血緣與歷程</span>
        </div>
      </article>
    </li>
  );
}
