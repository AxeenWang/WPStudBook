import type { HistoryEvent } from '../domain/history-event.ts';
import { toBaseName, withStageNumber, type Horse } from '../domain/horse.ts';
import type { JsonValue } from '../domain/json.ts';
import { inferBirthYear } from '../domain/identity.ts';
import type { PreviewIssue, PreviewOutcome, PreviewRow } from '../domain/import-batch.ts';
import {
  marketGroupFor,
  type Mare,
  type MareGroup,
  type MareOrigin,
  type MareSite,
} from '../domain/mare.ts';
import { isLinePosition } from '../domain/line.ts';
import { readBroodmareRow, type BroodmareValues } from '../import/broodmare.ts';
import { isPrefixOnlyName } from '../import/values.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { listMares } from '../storage/mares.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import {
  duplicateAbilityNosIn,
  importedStageNumber,
  resolveIdentities,
  type IdentityResolution,
  type IdentityRow,
} from './import-identity.ts';
import type { ImportHandler } from './imports.ts';

export interface CandidateRow extends PreviewRow {
  readonly values: BroodmareValues;
  readonly birthYear: number | undefined;
  /** 已在繁殖牝馬圈或已有紀錄的既有馬匹（CAND-03）。 */
  readonly existingHorseId: string | undefined;
}

/** 匯入時套用到每一匹勾選母馬的用途；據點由使用者選，原牧場只記為來源（需求規格 11.7）。 */
export interface CandidateTarget {
  /** 待指定用途時為 undefined。 */
  readonly group: { readonly position: number; readonly generation: number } | undefined;
  readonly site: MareSite;
  readonly origin: MareOrigin;
}

const ISSUES = {
  missingName: { code: 'missingName', message: '沒有馬名', handling: 'halt' },
  missingAbilityNo: { code: 'missingAbilityNo', message: '沒有能力番号', handling: 'halt' },
  prefixOnlyName: {
    code: 'prefixOnlyName',
    message: '只有 (外) 或 [地] 前綴、沒有馬名，略過這一筆',
    handling: 'confirm',
  },
  alreadyInHerd: {
    code: 'alreadyInHerd',
    message: '已在繁殖牝馬圈，不重複匯入',
    handling: 'confirm',
  },
  existingHorse: {
    code: 'existingHorse',
    message: '這匹馬已有紀錄但不在繁殖牝馬圈，請確認用途後再處理',
    handling: 'confirm',
  },
  identityConflict: {
    code: 'identityConflict',
    message: '與既有紀錄的身分不符，交由使用者處理',
    handling: 'confirm',
  },
  identityAmbiguous: {
    code: 'identityAmbiguous',
    message: '有多筆名稱相符的既有紀錄，無法唯一配對',
    handling: 'confirm',
  },
} as const satisfies Readonly<Record<string, PreviewIssue>>;

function toIdentityRow(values: BroodmareValues, birthYear: number | undefined): IdentityRow {
  return {
    lineNumber: values.lineNumber,
    abilityNo: values.abilityNo,
    birthYear,
    fullName: values.fullName,
    baseName: values.baseName,
    sireName: values.sireName,
    damName: values.damName,
  };
}

interface Classification {
  readonly outcome: PreviewOutcome;
  readonly issues: readonly PreviewIssue[];
  readonly existingHorseId: string | undefined;
}

function classify(
  values: BroodmareValues,
  resolution: IdentityResolution,
  herd: ReadonlySet<string>,
): Classification {
  if (isPrefixOnlyName(values.fullName)) {
    return { outcome: 'skip', issues: [ISSUES.prefixOnlyName], existingHorseId: undefined };
  }
  if (values.fullName === undefined) {
    return { outcome: 'error', issues: [ISSUES.missingName], existingHorseId: undefined };
  }
  if (values.abilityNo === undefined) {
    return { outcome: 'error', issues: [ISSUES.missingAbilityNo], existingHorseId: undefined };
  }
  switch (resolution.kind) {
    case 'new':
      return { outcome: 'apply', issues: [], existingHorseId: undefined };
    case 'ambiguous':
      return { outcome: 'review', issues: [ISSUES.identityAmbiguous], existingHorseId: undefined };
    case 'conflict':
      return {
        outcome: 'review',
        issues: [ISSUES.identityConflict],
        existingHorseId: resolution.horse.id,
      };
    default:
      return herd.has(resolution.horse.id)
        ? { outcome: 'skip', issues: [ISSUES.alreadyInHerd], existingHorseId: resolution.horse.id }
        : {
            outcome: 'review',
            issues: [ISSUES.existingHorse],
            existingHorseId: resolution.horse.id,
          };
  }
}

function groupOf(target: CandidateTarget): MareGroup {
  const { group } = target;
  if (group === undefined || !isLinePosition(group.position)) {
    return { kind: 'unassigned' };
  }
  return marketGroupFor(group.position, group.generation);
}

/**
 * 候選 TXT（需求規格 11.7）：只建立勾選的新進母馬，不對帳整個繁殖牝馬圈，
 * 也不標記五月年度工作完成（CAND-05 由 isYearlyTotal 決定）。
 */
export function candidateImportHandler(target: CandidateTarget): ImportHandler<CandidateRow> {
  return {
    type: 'candidateFile',
    collections: ['horses', 'mares'],
    preview: async (context, game, file, choice) => {
      const values = file.rows.map(readBroodmareRow);
      const identityRows = values.map((item) =>
        toIdentityRow(item, inferBirthYear('candidateFile', choice.gameYear, item.age)),
      );
      // 檔內能力番号重複整份拒絕（需求規格 11.7、ID-06）。
      const duplicates = duplicateAbilityNosIn(identityRows);
      if (duplicates.length > 0) {
        throw new ServiceError(
          'importHalted',
          `檔案內有重複的能力番号，整份不套用：${duplicates.map((no) => `0x${no.toString(16).toUpperCase().padStart(4, '0')}`).join('、')}`,
        );
      }
      const [resolutions, mares] = await Promise.all([
        resolveIdentities(context.database, game.id, identityRows),
        listMares(context.database, game.id),
      ]);
      const herd = new Set(
        mares.filter((mare) => mare.status === 'producing').map((mare) => mare.id),
      );
      return values.map((item, index): CandidateRow => {
        const resolution = resolutions[index] ?? { kind: 'new' as const };
        const classification = classify(item, resolution, herd);
        return {
          key: String(item.lineNumber),
          lineNumber: item.lineNumber,
          label: item.fullName ?? `第 ${String(item.lineNumber)} 行`,
          outcome: classification.outcome,
          issues: classification.issues,
          values: item,
          birthYear: identityRows[index]?.birthYear,
          existingHorseId: classification.existingHorseId,
        };
      });
    },
    build: ({ rows, game, choice, newId, occurredAt }) => {
      const group = groupOf(target);
      // 事件的後值要是純資料，不能直接放介面型別（設計決策 5.3 節）。
      const groupValue: JsonValue =
        group.kind === 'unassigned'
          ? { kind: group.kind }
          : { kind: group.kind, position: group.position, generation: group.generation };
      const records: CollectionRecord[] = [];
      const events: HistoryEvent[] = [];
      for (const row of rows) {
        const { values } = row;
        const fullName = values.fullName ?? '';
        const base: Horse = {
          id: newId(),
          sex: 'female',
          ...(values.abilityNo === undefined ? {} : { abilityNo: values.abilityNo }),
          ...(row.birthYear === undefined ? {} : { birthYear: row.birthYear }),
          fullName,
          baseName: values.baseName ?? toBaseName(fullName),
          ...(values.sireName === undefined ? {} : { sireName: values.sireName }),
          ...(values.damName === undefined ? {} : { damName: values.damName }),
          ...(values.sireSubsystem === undefined ? {} : { sireSubsystem: values.sireSubsystem }),
          ...(values.femaleLine === undefined ? {} : { femaleLine: values.femaleLine }),
          stageNumbers: [],
          aliases: [],
        };
        const horse =
          values.horseNo === undefined
            ? base
            : withStageNumber(
                base,
                importedStageNumber('candidateFile', values.horseNo, choice.gameYear),
              );
        // 原牧場只記為來源，據點由使用者選（需求規格 11.7、CAND-04）。
        const originNote =
          values.farmNo === undefined ? undefined : `候選 TXT 原牧場 ${String(values.farmNo)}`;
        const mare: Mare = {
          id: horse.id,
          group,
          origin: target.origin,
          ...(originNote === undefined ? {} : { originNote }),
          status: 'producing',
          site: target.site,
        };
        records.push(
          { collection: 'horses', record: horse },
          { collection: 'mares', record: mare },
        );
        events.push(
          userEvent(
            { newId },
            {
              subjectId: horse.id,
              type: 'horseCreated',
              gameYear: game.currentYear,
              occurredAt,
              after: { fullName, sex: 'female' },
            },
          ),
          userEvent(
            { newId },
            {
              subjectId: horse.id,
              type: 'mareAdded',
              gameYear: game.currentYear,
              occurredAt,
              after: { group: groupValue, origin: target.origin, site: target.site },
            },
          ),
        );
      }
      return { records, events };
    },
  };
}
