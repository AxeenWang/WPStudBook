export const BROWSER_CHANNELS = ['msedge', 'chrome'] as const;

export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

function isBrowserChannel(value: string): value is BrowserChannel {
  return (BROWSER_CHANNELS as readonly string[]).includes(value);
}

export function parseBrowserChannels(raw: string | undefined): BrowserChannel[] {
  const items = (raw ?? 'msedge')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const unsupported = items.filter((item) => !isBrowserChannel(item));
  if (items.length === 0 || unsupported.length > 0) {
    const detail = unsupported.length > 0 ? unsupported.join('、') : '（空白）';
    throw new Error(
      `E2E_BROWSERS 只接受 ${BROWSER_CHANNELS.join('、')}，以逗號分隔；不支援的值：${detail}`,
    );
  }
  return [...new Set(items.filter(isBrowserChannel))];
}
