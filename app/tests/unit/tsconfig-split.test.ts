import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function parseConfig(path: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(path, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (parsed === undefined) {
    throw new Error(`無法讀取 ${path}`);
  }
  return parsed;
}

function normalize(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

describe('TypeScript 設定分開瀏覽器與 Node 型別', () => {
  it('src 只含瀏覽器程式，不載入 Node 型別，並保留嚴格選項', () => {
    const config = parseConfig('src/tsconfig.json');
    const files = config.fileNames.map(normalize);
    expect(config.options.types).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.includes('/src/'))).toBe(true);
    expect(config.options).toMatchObject({
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      erasableSyntaxOnly: true,
    });
  });

  it('測試、腳本與設定檔使用 Node 型別，src 只直接收錄全域常數宣告', () => {
    const config = parseConfig('tsconfig.json');
    const files = config.fileNames.map(normalize);
    expect(config.options.types).toEqual(['node']);
    expect(
      files
        .filter((file) => file.includes('/src/'))
        .map((file) => file.slice(file.indexOf('/src/'))),
    ).toEqual(['/src/env.d.ts']);
    expect(files.some((file) => file.includes('/tests/'))).toBe(true);
    expect(files.some((file) => file.includes('/scripts/'))).toBe(true);
  });
});
