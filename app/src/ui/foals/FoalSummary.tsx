import { useState } from 'react';
import { Button } from 'react-aria-components';
import type { FoalCard } from '../../services/foals.ts';
import { FoalPanel } from './FoalPanel.tsx';
import { DISPOSITION_LABELS, SURFACE_LABELS, lineageText, mareElsewhereText } from './labels.ts';
import { SexMarker } from './SexMarker.tsx';

function abilityText(card: FoalCard): string {
  const parts = [
    card.sp === undefined ? undefined : `SP ${String(card.sp)}`,
    card.st === undefined ? undefined : `ST ${String(card.st)}`,
    card.subParamTotal === undefined ? undefined : `サ ${String(card.subParamTotal)}`,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? '能力未取得' : parts.join('・');
}

function aptitudeText(card: FoalCard): string | undefined {
  if (card.turf === undefined && card.dirt === undefined) {
    return undefined;
  }
  const surface = card.surface === undefined ? '' : `（${SURFACE_LABELS[card.surface]}）`;
  return `芝 ${card.turf ?? '—'}・ダ ${card.dirt ?? '—'}${surface}`;
}

/** 產駒的一張卡（需求規格 9.3、9.4、13.4）：名稱、性別、父母、系與代數、處置、能力與適性，可展開管理。 */
export function FoalSummary({ card }: { readonly card: FoalCard }) {
  const [managing, setManaging] = useState(false);
  const aptitude = aptitudeText(card);
  return (
    <article className="foal-card" aria-label={card.name}>
      <h4 className="foal-name">
        <SexMarker sex={card.sex} /> {card.name}
        {card.freeBred && <span className="badge">自由配種</span>}
        {card.isMare && <span className="badge">已轉入母馬群</span>}
        {card.isStallion && <span className="badge">已成為種牡馬</span>}
        {card.mareElsewhere !== undefined && (
          <span className="badge" data-testid="foal-mare-elsewhere">
            {mareElsewhereText(card.mareElsewhere)}
          </span>
        )}
      </h4>
      <p>
        {card.birthYear} 年生・{card.age} 歲・父 {card.sireName ?? '未取得'}・
        {card.lineage === undefined ? '沒有八系的系與代數' : lineageText(card.lineage)}・
        <span data-testid="foal-disposition">{DISPOSITION_LABELS[card.disposition]}</span>
      </p>
      {card.named && card.trackingName !== undefined && (
        <p className="notice">追蹤名：{card.trackingName}</p>
      )}
      <p data-testid="foal-abilities">
        {abilityText(card)}
        {aptitude === undefined ? '' : `・${aptitude}`}
        {card.distanceText === undefined ? '' : `・${card.distanceText}`}
      </p>
      <Button
        aria-expanded={managing}
        onPress={() => {
          setManaging(!managing);
        }}
      >
        {managing ? '收合管理' : '管理'}
      </Button>
      {managing && <FoalPanel card={card} />}
    </article>
  );
}
