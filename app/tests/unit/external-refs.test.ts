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
    expect(findExternalReferences(html)).toEqual([
      { kind: 'attribute', value: '/assets/index.js' },
    ]);
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
    const html =
      '<a href="#top">頂端</a><img src="data:image/png;base64,AAAA"><a href="blob:abc">檔案</a>';
    expect(findExternalReferences(html)).toEqual([]);
  });

  it('沒有引號的屬性也能偵測', () => {
    expect(findExternalReferences('<img src=logo.png>')).toEqual([
      { kind: 'attribute', value: 'logo.png' },
    ]);
  });

  it('srcset 前段是 data: URL 時，仍需偵測後段的外部網址', () => {
    const html = '<img srcset="data:image/png;base64,AAAA 1x, https://cdn.example.com/b.png 2x">';
    expect(findExternalReferences(html)).toEqual([
      { kind: 'attribute', value: 'https://cdn.example.com/b.png' },
    ]);
  });

  it('srcset 全部候選網址皆為 data: 時不回報', () => {
    const html = '<img srcset="data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x">';
    expect(findExternalReferences(html)).toEqual([]);
  });

  it('srcset 逗號後沒有空白時，仍能個別偵測每個候選網址', () => {
    const html = '<img srcset="a.png 1x,b.png 2x">';
    expect(findExternalReferences(html)).toEqual([
      { kind: 'attribute', value: 'a.png' },
      { kind: 'attribute', value: 'b.png' },
    ]);
  });

  it('[BLD-02] object 的 data、按鈕的 formaction、link 的 imagesrcset 指向外部時回報', () => {
    const html =
      '<object data="https://example.com/a.swf"></object>' +
      '<button formaction="https://example.com/submit">送出</button>' +
      '<link rel="preload" as="image" imagesrcset="data:image/png;base64,AAAA 1x, https://cdn.example.com/b.png 2x">';
    expect(findExternalReferences(html)).toEqual([
      { kind: 'attribute', value: 'https://example.com/a.swf' },
      { kind: 'attribute', value: 'https://example.com/submit' },
      { kind: 'attribute', value: 'https://cdn.example.com/b.png' },
    ]);
  });

  it('[BLD-02] meta refresh 導向外部網址時回報，單純定時重新整理與其他 meta 不回報', () => {
    const html =
      '<meta http-equiv="refresh" content="0; url=https://example.com/next">' +
      '<meta http-equiv="refresh" content="30">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    expect(findExternalReferences(html)).toEqual([
      { kind: 'attribute', value: 'https://example.com/next' },
    ]);
  });

  it('[BLD-02] 行內 style 屬性的 url() 指向外部時回報', () => {
    const html =
      `<div style="background:url('https://cdn.example.com/bg.png')"></div>` +
      `<span style='mask:url(data:image/svg+xml;base64,AAAA)'></span>`;
    expect(findExternalReferences(html)).toEqual([
      { kind: 'css', value: 'https://cdn.example.com/bg.png' },
    ]);
  });

  it('data-src 之類的自訂屬性不算外部載入', () => {
    const html =
      '<img data-src="https://example.com/lazy.png" src="data:image/png;base64,AAAA">' +
      '<div data-href="page.html"></div>';
    expect(findExternalReferences(html)).toEqual([]);
  });

  it('HTML 註解內的網址不算外部載入', () => {
    const html =
      '<!-- <script src="https://cdn.example.com/old.js"></script> -->' +
      '<!--<img src=old.png>--><p>內容</p>';
    expect(findExternalReferences(html)).toEqual([]);
  });
});
