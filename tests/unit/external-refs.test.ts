import { describe, expect, it } from 'vitest';
import { findExternalReferences } from '../../scripts/lib/external-refs.ts';

describe('findExternalReferences', () => {
  it('內嵌的 script 與 style 不算外部載入，即使程式內容含有網址字串', () => {
    const html =
      '<html><head><style>body{background:url(data:image/png;base64,AAAA)}</style></head>' +
      '<body><script type="module">const markup = "<img src=\\"https://example.com/a.png\\">";</script></body></html>';
    expect(findExternalReferences(html)).toEqual([]);
  });

  it('script 的 src 指向檔案時回報', () => {
    const html = '<script type="module" src="/assets/index.js"></script>';
    expect(findExternalReferences(html)).toEqual([{ kind: 'attribute', value: '/assets/index.js' }]);
  });

  it('外部樣式表連結回報', () => {
    const html = '<link rel="stylesheet" href="https://cdn.example.com/site.css">';
    expect(findExternalReferences(html)).toEqual([
      { kind: 'attribute', value: 'https://cdn.example.com/site.css' },
    ]);
  });

  it('CSS 的 url() 與 @import 指向外部時回報', () => {
    const html =
      '<style>@import "https://cdn.example.com/base.css";' +
      '@font-face{src:url("fonts/a.woff2")}</style>';
    expect(findExternalReferences(html)).toEqual([
      { kind: 'css', value: 'fonts/a.woff2' },
      { kind: 'css', value: 'https://cdn.example.com/base.css' },
    ]);
  });

  it('錨點、data 與 blob 網址不算外部載入', () => {
    const html = '<a href="#top">頂端</a><img src="data:image/png;base64,AAAA"><a href="blob:abc">檔案</a>';
    expect(findExternalReferences(html)).toEqual([]);
  });

  it('沒有引號的屬性也能偵測', () => {
    expect(findExternalReferences('<img src=logo.png>')).toEqual([{ kind: 'attribute', value: 'logo.png' }]);
  });
});
