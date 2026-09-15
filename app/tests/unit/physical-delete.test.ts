import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => relative('.', join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
}

function deleteCalls(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return Array.from(source.matchAll(/\.delete\(([^)]*)\)/g), (match) => (match[1] ?? '').trim());
}

describe('禁止物理刪除（需求規格 5.1、5.3、10.4）', () => {
  it('[PED-10] 程式沒有逐筆刪除馬匹、母馬、產駒、任期或配種紀錄的路徑；只有整局刪除、回溯與檢查點、對照表的刪除', () => {
    const calls = Object.fromEntries(
      sourceFiles('src')
        .map((file) => [file, deleteCalls(file)] as const)
        .filter(([, found]) => found.length > 0),
    );
    expect(calls).toEqual({
      // 回溯前清除較晚的檢查點。
      'src/storage/checkpoints.ts': ['[gameId, id]', '[gameId, id]'],
      // 刪除整局：遊戲局、設定以外的資料表都以該局主鍵範圍刪除。
      'src/storage/games.ts': [
        'gameId',
        "name === 'gameSettings' ? gameId : range",
        'CURRENT_GAME_KEY',
      ],
      // 回溯：以該局主鍵範圍清除後寫入檢查點內容；逐筆刪除只用於檢查點資料表。
      'src/storage/snapshot.ts': ['gameId', 'range', '[gameId, id]'],
      // 系統對照表的刪除只影響子系統對照，歷程保留。
      'src/storage/system-map.ts': ['[gameId, write.deleteId]'],
    });
    const snapshot = readFileSync('src/storage/snapshot.ts', 'utf8');
    expect(snapshot).toContain(
      'RECORD_COLLECTIONS.map((name) => transaction.objectStore(name).delete(range))',
    );
    expect(snapshot).toMatch(
      /CHECKPOINT_STORES\.flatMap\(\(name\) =>\s+replacement\.removeCheckpointIds\.map\(\(id\) =>\s+transaction\.objectStore\(name\)\.delete\(\[gameId, id\]\)/,
    );
  });
});
