import { describe, expect, it } from 'vitest';
import {
  selectCheckpointsToPrune,
  selectLaterCheckpoints,
  type Checkpoint,
} from '../../src/domain/checkpoint.ts';

function checkpoint(index: number, pinned = false): Checkpoint {
  return {
    id: `cp-${String(index).padStart(2, '0')}`,
    gameYear: 1968 + index,
    createdAt: new Date(Date.UTC(2026, 8, 15, 0, 0, index)).toISOString(),
    pinned,
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    counts: {},
  };
}

describe('檢查點保留', () => {
  it('[CKPT-03] 超過保留數時清除最舊且未釘選者', () => {
    const list = Array.from({ length: 16 }, (_, index) => checkpoint(index, index === 0));
    expect(selectCheckpointsToPrune(list.reverse(), 15)).toEqual(['cp-01']);
  });

  it('[CKPT-03] 未超過保留數時不清除', () => {
    const list = Array.from({ length: 15 }, (_, index) => checkpoint(index));
    expect(selectCheckpointsToPrune(list, 15)).toEqual([]);
  });

  it('[CKPT-03] 釘選者不自動清除，即使總數仍超過保留數', () => {
    const list = Array.from({ length: 17 }, (_, index) => checkpoint(index, index !== 16));
    expect(selectCheckpointsToPrune(list, 15, 'cp-16')).toEqual([]);
  });

  it('[CKPT-03] 剛建立的檢查點不會被清除，改清除其他最舊且未釘選者', () => {
    const list = Array.from({ length: 16 }, (_, index) =>
      checkpoint(index, index >= 1 && index <= 14),
    );
    expect(selectCheckpointsToPrune(list, 15, 'cp-15')).toEqual(['cp-00']);
  });
});

describe('較晚的檢查點', () => {
  it('依建立時間判斷，不含回溯目標本身', () => {
    const list = [checkpoint(3), checkpoint(1), checkpoint(2)];
    expect(selectLaterCheckpoints(list, checkpoint(1)).map((item) => item.id)).toEqual([
      'cp-02',
      'cp-03',
    ]);
  });
});
