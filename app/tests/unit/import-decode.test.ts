import { describe, expect, it } from 'vitest';
import { decodeImportFile, type DecodeResult } from '../../src/import/decode.ts';

/** CP932 的「テスト馬」；遊戲匯出的樣本都是無 BOM 的 CP932（附錄 A）。 */
const CP932_SAMPLE = new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x94, 0x6e]);
const SAMPLE_TEXT = 'テスト馬';

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function problemOf(result: DecodeResult): string {
  if (result.ok) {
    throw new Error('預期解碼失敗，實際成功');
  }
  return result.problem;
}

describe('匯入檔解碼（需求規格 11.1、IMP-01）', () => {
  it('[IMP-01] 無 BOM 的 CP932 以 CP932 解碼', () => {
    expect(decodeImportFile(CP932_SAMPLE)).toEqual({
      ok: true,
      text: SAMPLE_TEXT,
      encoding: 'cp932',
    });
  });

  it('同樣內容的 UTF-8 以 UTF-8 解碼，不會被 CP932 解成亂碼', () => {
    expect(decodeImportFile(utf8(SAMPLE_TEXT))).toEqual({
      ok: true,
      text: SAMPLE_TEXT,
      encoding: 'utf-8',
    });
  });

  it('UTF-8 BOM 不留在內容裡', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SAMPLE_TEXT)]);
    expect(decodeImportFile(withBom)).toEqual({ ok: true, text: SAMPLE_TEXT, encoding: 'utf-8' });
  });

  it('純 ASCII 解碼為 UTF-8，內容與 CP932 相同', () => {
    expect(decodeImportFile(utf8('name\tSP'))).toEqual({
      ok: true,
      text: 'name\tSP',
      encoding: 'utf-8',
    });
  });

  it('兩種編碼都無法嚴格解碼時停止', () => {
    expect(problemOf(decodeImportFile(new Uint8Array([0x83])))).toContain(
      '無法以 UTF-8 或 CP932 解碼',
    );
  });

  it('有 BOM 卻不是合法 UTF-8 時不退回 CP932', () => {
    expect(problemOf(decodeImportFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x83])))).toContain('BOM');
  });
});
