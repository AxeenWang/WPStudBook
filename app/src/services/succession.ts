import { stallionLineage, subParamTotal, trackingName } from '../domain/foal.ts';
import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import { horseDisplayName, nameForTracking } from '../domain/horse.ts';
import { establishGeneration } from '../domain/line.ts';
import { offspringLineage, type Lineage } from '../domain/lineage.ts';
import {
  establishesGeneration,
  initialSuccession,
  isActiveSuccession,
  isMareSite,
  mareGeneration,
  type AssignedMareGroup,
  type LeftReason,
  type Mare,
  type MareStatus,
  type Succession,
} from '../domain/mare.ts';
import { getFoal, type SireRecords } from '../storage/foals.ts';
import { getHorse } from '../storage/horses.ts';
import {
  insertOwnMare,
  loadOwnMareState,
  loadSuccessionState,
  modifySuccession,
  type OwnMareState,
} from '../storage/succession.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

export interface ConvertFoalInput {
  readonly foalId: string;
  /** 未選擇時傳入 NaN。 */
  readonly site: number;
}

export interface ConvertPreview {
  readonly group: AssignedMareGroup;
  readonly succession: Succession;
  /** 轉入後該代立即成立（該代第一匹暫定或正式保留的自家母駒）。 */
  readonly establishes: boolean;
  /** 已在圈內、列入任務的姊妹。 */
  readonly sisterIds: readonly string[];
}

export interface ConvertCheck {
  readonly issues: readonly string[];
  /** 有問題時為 undefined。 */
  readonly preview: ConvertPreview | undefined;
}

export function lineageText(position: number, generation: number): string {
  return `第 ${String(position)} 系 ${String(generation)} 代`;
}

/** 由父馬的系與代數、母馬的代數推導產駒的系與代數（需求規格 8.2）；任一方查不到時為 undefined。 */
export function deriveOffspringLineage(
  sire: SireRecords | undefined,
  dam: Mare | undefined,
): Lineage | undefined {
  const sireLineage = sire === undefined ? undefined : stallionLineage(sire.duties, sire.foal);
  const damGeneration = dam === undefined ? undefined : mareGeneration(dam.group);
  return sireLineage === undefined || damGeneration === undefined
    ? undefined
    : offspringLineage(sireLineage, damGeneration);
}

/** 進入母馬群或接任前再次核對（需求規格 9.6）：出生紀錄的系與代數必須與父母推導的結果相同。 */
export function lineageMismatch(
  recorded: Lineage,
  sire: SireRecords | undefined,
  dam: Mare | undefined,
): string | undefined {
  const expected = deriveOffspringLineage(sire, dam);
  if (expected === undefined) {
    return '無法核對父母、系與代數：找不到父馬的系位置或母馬的母馬群';
  }
  return expected.position === recorded.position && expected.generation === recorded.generation
    ? undefined
    : `出生紀錄的系與代數（${lineageText(recorded.position, recorded.generation)}）與父母推導的結果（${lineageText(expected.position, expected.generation)}）不符`;
}

/**
 * 從產駒手動轉入繁殖牝馬前的核對（需求規格 8.4、9.6）：只有非自由配種、未售出的自家母駒可以轉入；
 * 進入母馬群前以父母再次推導系與代數，與出生紀錄不符時阻止。接替狀態依在圈姊妹決定（8.9）。
 *
 * 五月匯入的新進自家產駒走同一套規則（需求規格 11.5、MAY-09），所以這個純函式對外公開：
 * 匯入在預覽時先算好，套用時在單一交易內用同一份結果建紀錄。
 */
export function planConversion(state: OwnMareState, input: ConvertFoalInput): ConvertCheck {
  const { foal, horse, existingMare, dam, sire, sisters, line } = state;
  if (foal === undefined || horse === undefined) {
    return { issues: ['找不到這匹產駒'], preview: undefined };
  }
  const issues: string[] = [];
  if (existingMare !== undefined) {
    issues.push('這匹產駒已轉入為繁殖牝馬');
  }
  if (horse.sex !== 'female') {
    issues.push('只有母駒可以轉入為繁殖牝馬');
  }
  const { lineage } = foal;
  if (foal.freeBred || lineage === undefined) {
    issues.push('自由配種產駒不能成為八系後繼，不能轉入母馬群');
  }
  if (foal.disposition === 'sold') {
    issues.push('已售出的產駒不能轉入');
  }
  if (!isMareSite(input.site)) {
    issues.push('請選擇據點');
  }
  if (lineage !== undefined) {
    const mismatch = lineageMismatch(lineage, sire, dam);
    if (mismatch !== undefined) {
      issues.push(mismatch);
    }
    if (line === undefined) {
      issues.push(`第 ${String(lineage.position)} 系尚未開啟`);
    }
  }
  if (issues.length > 0 || lineage === undefined || line === undefined) {
    return { issues, preview: undefined };
  }
  const activeSisters = sisters.filter(
    (sister) => sister.mare.status === 'producing' && isActiveSuccession(sister.mare.succession),
  );
  const succession = initialSuccession(sisters.map((sister) => sister.mare));
  return {
    issues,
    preview: {
      group: { kind: 'own', position: lineage.position, generation: lineage.generation },
      succession,
      establishes:
        establishesGeneration(succession) &&
        !line.establishedGenerations.some((item) => item.generation === lineage.generation),
      sisterIds: activeSisters.map((sister) => sister.mare.id),
    },
  };
}

export async function checkConvertFoal(
  context: ServiceContext,
  input: ConvertFoalInput,
): Promise<ConvertCheck> {
  const game = await requireCurrentGame(context);
  return planConversion(await loadOwnMareState(context.database, game.id, input.foalId), input);
}

export interface ConvertedMare {
  readonly mare: Mare;
  readonly establishedGeneration: boolean;
}

/**
 * 自家母駒手動轉入（需求規格 8.4、8.9、9.6）：依出生紀錄加入第 q 系 N 代母馬群，來源為所屬競走馬引退轉入，
 * 自身父系沿用出生時由父馬決定的值。以暫定或正式保留轉入時該代立即成立，不需 5 匹或種牡馬就緒（8.2）。
 * 五月匯入（11.5）在階段 4 呼叫同一套規則。
 */
export async function convertFoalToMare(
  context: ServiceContext,
  input: ConvertFoalInput,
): Promise<ConvertedMare> {
  const check = await checkConvertFoal(context, input);
  if (check.issues.length > 0) {
    throw new ServiceError('invalidInput', check.issues.join('；'));
  }
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  const records = await trackWrite(context, () =>
    insertOwnMare(context.database, {
      gameId: game.id,
      foalId: input.foalId,
      touch: gameTouch(context, now),
      build: (stored, state) => buildConversion(context, stored, state, input, now),
    }),
  );
  return { mare: records.mare, establishedGeneration: records.line !== undefined };
}

function buildConversion(
  context: ServiceContext,
  game: Game,
  state: OwnMareState,
  input: ConvertFoalInput,
  now: string,
) {
  const { issues, preview } = planConversion(state, input);
  const { foal, line } = state;
  if (issues.length > 0 || preview === undefined || foal === undefined || line === undefined) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  if (!isMareSite(input.site)) {
    throw new ServiceError('invalidInput', '請選擇據點');
  }
  const { group, succession } = preview;
  const mare: Mare = {
    id: foal.id,
    group,
    origin: 'ownRetired',
    status: 'producing',
    site: input.site,
    succession,
  };
  const kept = foal.disposition === 'keep' ? undefined : { ...foal, disposition: 'keep' as const };
  const established = preview.establishes
    ? establishGeneration(line, group.generation, game.currentYear)
    : undefined;
  const events: HistoryEvent[] = [
    userEvent(context, {
      subjectId: mare.id,
      type: 'mareAdded',
      gameYear: game.currentYear,
      occurredAt: now,
      after: {
        group: { kind: group.kind, position: group.position, generation: group.generation },
        origin: mare.origin,
        site: mare.site,
        succession,
      },
    }),
    ...(kept === undefined
      ? []
      : [
          userEvent(context, {
            subjectId: foal.id,
            type: 'foalChanged',
            gameYear: game.currentYear,
            occurredAt: now,
            before: { disposition: foal.disposition },
            after: { disposition: 'keep' },
          }),
        ]),
    ...(established === undefined
      ? []
      : [
          userEvent(context, {
            subjectId: line.id,
            type: 'lineGenerationEstablished',
            gameYear: game.currentYear,
            occurredAt: now,
            after: { generation: group.generation, mareId: mare.id },
          }),
        ]),
  ];
  return { mare, foal: kept, line: established, events };
}

/**
 * 選定正式保留（需求規格 8.9、MARE-12）：由使用者比較後決定，同一父母組合只留一匹正式保留，
 * 其他列入任務的姊妹改為已被取代；被取代者仍在圈內，紀錄與歷程保留，已售出者不變。
 */
export async function confirmSuccession(context: ServiceContext, mareId: string): Promise<Mare> {
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  const change = await trackWrite(context, () =>
    modifySuccession(context.database, {
      gameId: game.id,
      mareId,
      touch: gameTouch(context, now),
      apply: (stored, { mare, sisters }) => {
        if (mare === undefined) {
          throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
        }
        if (mare.status !== 'producing') {
          throw new ServiceError('invalidInput', '這匹繁殖牝馬已離圈');
        }
        if (mare.succession === undefined) {
          throw new ServiceError('invalidInput', '只有自家母駒轉入的母馬有姊妹接替狀態');
        }
        if (mare.succession === 'confirmed') {
          throw new ServiceError('invalidInput', '這匹母馬已經是正式保留');
        }
        const changes: [Mare, Succession][] = [
          [mare, 'confirmed'],
          ...sisters
            .filter((sister) => isActiveSuccession(sister.mare.succession))
            .map((sister): [Mare, Succession] => [sister.mare, 'replaced']),
        ];
        const mares = changes.map(([item, succession]) => ({ ...item, succession }));
        const events = changes.map(([item, succession]) =>
          userEvent(context, {
            subjectId: item.id,
            type: 'successionChanged',
            gameYear: stored.currentYear,
            occurredAt: now,
            before: item.succession === undefined ? undefined : { succession: item.succession },
            after: { succession },
          }),
        );
        return { mares, events };
      },
    }),
  );
  const confirmed = change.mares.find((item) => item.id === mareId);
  if (confirmed === undefined) {
    throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
  }
  return confirmed;
}

/** 姊妹並排比較的一列（需求規格 8.9、13.5）。 */
export interface SisterRow {
  readonly id: string;
  readonly name: string;
  readonly birthYear: number | undefined;
  readonly sireName: string | undefined;
  readonly damName: string | undefined;
  readonly sp: number | undefined;
  readonly st: number | undefined;
  readonly subParamTotal: number | undefined;
  readonly status: MareStatus;
  readonly leftReason: LeftReason | undefined;
  readonly succession: Succession | undefined;
  /** 生產中且尚未正式保留時可以選為正式保留。 */
  readonly canConfirm: boolean;
}

/** 這匹母馬與她已轉入的同父同母姊妹（出生年由小到大）；沒有姊妹時只有自己。 */
export async function loadSisterComparison(
  context: ServiceContext,
  mareId: string,
): Promise<readonly SisterRow[]> {
  const game = await requireCurrentGame(context);
  const state = await loadSuccessionState(context.database, game.id, mareId);
  const { horse, mare } = state;
  if (horse === undefined || mare === undefined) {
    throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
  }
  const members = [{ horse, mare }, ...state.sisters];
  const [sire, dam, foals] = await Promise.all([
    horse.sireId === undefined ? undefined : getHorse(context.database, game.id, horse.sireId),
    horse.damId === undefined ? undefined : getHorse(context.database, game.id, horse.damId),
    Promise.all(members.map((member) => getFoal(context.database, game.id, member.mare.id))),
  ]);
  const damTrackingName = dam === undefined ? undefined : nameForTracking(dam);
  return members
    .map((member, index): SisterRow => {
      const foal = foals[index];
      const { birthYear } = member.horse;
      return {
        id: member.mare.id,
        name:
          horseDisplayName(
            member.horse,
            birthYear === undefined ? undefined : trackingName(damTrackingName, birthYear),
          ) ?? member.mare.id,
        birthYear,
        sireName:
          (sire === undefined ? undefined : horseDisplayName(sire, undefined)) ??
          member.horse.sireName,
        damName:
          (dam === undefined ? undefined : horseDisplayName(dam, undefined)) ??
          member.horse.damName,
        sp: foal?.sp,
        st: foal?.st,
        subParamTotal: subParamTotal(foal?.subParams),
        status: member.mare.status,
        leftReason: member.mare.leftReason,
        succession: member.mare.succession,
        canConfirm:
          member.mare.status === 'producing' &&
          member.mare.succession !== undefined &&
          member.mare.succession !== 'confirmed',
      };
    })
    .sort((a, b) => (a.birthYear ?? 0) - (b.birthYear ?? 0) || a.id.localeCompare(b.id));
}
