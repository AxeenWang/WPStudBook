import { Button } from 'react-aria-components';
import type { MareCard } from '../../services/mare-list.ts';
import { isCeExtended } from '../../services/mares.ts';
import { formatGeneration } from '../format.ts';
import {
  ORIGIN_LABELS,
  SITE_LABELS,
  YEAR_PLAN_LABELS,
  formatMareGroup,
  formatStatus,
  formatVitality,
} from './labels.ts';

interface MareCardItemProps {
  readonly card: MareCard;
  readonly vitalityThreshold: number | undefined;
  readonly onSell: () => void;
}

function femaleLineText(femaleLine: string | undefined): string {
  if (femaleLine === undefined) {
    return '未取得';
  }
  return femaleLine === '' ? '不屬於具名牝系' : femaleLine;
}

/** 母馬卡片（需求規格 13.3、UI-01）：只有「賣出」，沒有退役操作（8.5）。 */
export function MareCardItem({ card, vitalityThreshold, onSell }: MareCardItemProps) {
  const { vitality, month } = card.vitality;
  return (
    <li className="mare-card">
      <article aria-label={card.name}>
        <h4 className="mare-name">{card.name}</h4>
        <dl>
          <div>
            <dt>代數</dt>
            <dd data-testid="mare-generation">
              {card.generation === undefined ? '—' : formatGeneration(card.generation)}
            </dd>
          </div>
          <div>
            <dt>用途</dt>
            <dd data-testid="mare-usage">{formatMareGroup(card.group)}</dd>
          </div>
          <div>
            <dt>自身父系</dt>
            <dd>{card.sireSubsystem ?? '未填'}</dd>
          </div>
          <div>
            <dt>據點</dt>
            <dd data-testid="mare-site">{SITE_LABELS[card.site]}</dd>
          </div>
          <div>
            <dt>年齡</dt>
            <dd>{card.age === undefined ? '未知' : `${String(card.age)} 歲`}</dd>
          </div>
          <div>
            <dt>活力</dt>
            <dd data-testid="mare-vitality">
              {vitality.state === 'confirmed' && (
                <meter min={0} max={100} value={vitality.value} aria-label="活力" />
              )}
              {formatVitality(vitality, month)}
            </dd>
          </div>
          <div>
            <dt>本年度受胎</dt>
            <dd>{card.conception ?? '未登記'}</dd>
          </div>
          <div>
            <dt>今年計畫</dt>
            <dd data-testid="mare-plan">{YEAR_PLAN_LABELS[card.yearPlan]}</dd>
          </div>
          <div>
            <dt>狀態與來源</dt>
            <dd data-testid="mare-status">
              {formatStatus(card.status, card.leftReason)}・{ORIGIN_LABELS[card.origin]}
            </dd>
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
          <div>
            <dt>牝系</dt>
            <dd>{femaleLineText(card.femaleLine)}</dd>
          </div>
        </dl>
        {card.highAge && <p className="notice">產駒素質可能下降，可考慮出售</p>}
        {card.belowThreshold && vitalityThreshold !== undefined && (
          <p className="notice">活力低於建議門檻 {vitalityThreshold}</p>
        )}
        {card.status === 'producing' && (
          <div className="actions">
            <Button onPress={onSell}>賣出</Button>
          </div>
        )}
      </article>
    </li>
  );
}
