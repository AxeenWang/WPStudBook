import type { Lineage } from '../../domain/lineage.ts';
import type { TaskBlocker, TaskDam, TaskPhase } from '../../domain/task.ts';
import type { TaskView } from '../../services/tasks.ts';

export const PHASE_LABELS: Readonly<Record<TaskPhase, string>> = {
  building: '建系期',
  cycling: '循環期',
};

export const BLOCKER_LABELS: Readonly<Record<TaskBlocker, string>> = {
  lineNotOpened: '系位置尚未開啟',
  noCurrentStallion: '缺少現任種牡馬',
  noMares: '母馬群沒有可配母馬',
};

/** 代數文字（需求規格 3 章）：任務標題沿用規格的「第 2 系零代」、「第 1 系 1 代」寫法。 */
function generationText(generation: number): string {
  return generation === 0 ? '零代' : ` ${String(generation)} 代`;
}

export function formatLineage(lineage: Lineage): string {
  return `第 ${String(lineage.position)} 系${generationText(lineage.generation)}`;
}

/** 母馬側（需求規格 7.3、8.3）：替代母馬不顯示為屬於該系，起點母馬群另外標示。 */
function formatDam(dam: TaskDam): string {
  if (dam.starter) {
    return `第 ${String(dam.position)} 系起點母馬群`;
  }
  return dam.substitute
    ? `替代第 ${String(dam.position)} 系`
    : `${formatLineage({ position: dam.position, generation: dam.generation })}母馬`;
}

/**
 * 任務標題（需求規格 7.3、7.4、LINE-09、LINE-15）：
 * 「第 1 系 1 代 × 替代第 2 系 → 第 1 系 2 代」、「第 X 系 N 代種牡馬 × 第 Y 系 N 代母馬 → 第 X 系 N+1 代」。
 */
export function formatTask(task: Pick<TaskView, 'kind' | 'sire' | 'dam' | 'target'>): string {
  const sire =
    task.kind === 'cycle' ? `${formatLineage(task.sire)}種牡馬` : formatLineage(task.sire);
  return `${sire} × ${formatDam(task.dam)} → ${formatLineage(task.target)}`;
}

/** 建系分支的兩條配對（需求規格 7.3）。 */
export function formatTaskKind(task: Pick<TaskView, 'kind' | 'dam'>): string {
  switch (task.kind) {
    case 'advance':
      return task.dam.starter ? '起點' : '推進原系';
    case 'found':
      return '建立新系';
    case 'cycle':
      return '循環配種';
  }
}
