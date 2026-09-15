import { describe, expect, it } from 'vitest';
import { parseBrowserChannels } from '../../scripts/lib/browser-channels.ts';

describe('parseBrowserChannels', () => {
  it('未設定時預設只跑 Edge', () => {
    expect(parseBrowserChannels(undefined)).toEqual(['msedge']);
  });

  it('接受逗號分隔，去除空白與重複', () => {
    expect(parseBrowserChannels(' msedge , chrome,msedge ')).toEqual(['msedge', 'chrome']);
  });

  it('含不支援的值時丟出錯誤，不會靜默略過', () => {
    expect(() => parseBrowserChannels('msedge,firefox')).toThrow('firefox');
  });

  it('只有空白或逗號時丟出錯誤', () => {
    expect(() => parseBrowserChannels(' , ')).toThrow('E2E_BROWSERS');
  });
});
