import { describe, expect, it } from 'vitest';
import {
  isRecoveryInProgress,
  needsReplenish,
  recoveryTargetGeneration,
  RECOVERY_CHOICES,
} from '../../src/domain/recovery.ts';

describe('斷血補系（需求規格 7.6）', () => {
  it('[LINE-18] 已成立世代的在圈母馬降為 0 時待補，未成立或還有母馬時不提醒', () => {
    expect(needsReplenish(true, 0)).toBe(true);
    expect(needsReplenish(true, 1)).toBe(false);
    expect(needsReplenish(false, 0)).toBe(false);
  });

  it('[LINE-19] 斷血時系統只列出三個選項，不代選', () => {
    expect([...RECOVERY_CHOICES]).toEqual(['retry', 'replenish', 'recovery']);
  });

  it('[LINE-20] 補系產出斷血代數的下一代', () => {
    expect(recoveryTargetGeneration({ generation: 12 })).toBe(13);
    expect(recoveryTargetGeneration({ generation: 1 })).toBe(2);
  });

  it('只有進行中的補系會暫停任務', () => {
    expect([
      isRecoveryInProgress({ status: 'inProgress' }),
      isRecoveryInProgress({ status: 'completed' }),
      isRecoveryInProgress({ status: 'cancelled' }),
    ]).toEqual([true, false, false]);
  });
});
