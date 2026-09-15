export interface ExternalReference {
  kind: 'attribute' | 'css';
  value: string;
}

const SCRIPT_BLOCK = /<script\b([^>]*)>[\s\S]*?<\/script>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
// 屬性名稱前必須是空白、引號、斜線或冒號，避免把 data-src 之類的自訂屬性當成 src；冒號用於支援 xlink:href 等命名空間屬性。
const URL_ATTRIBUTE =
  /(?<=[\s"'/:])(src|href|srcset|imagesrcset|poster|action|formaction|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const STYLE_ATTRIBUTE = /(?<=[\s"'/:])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const META_TAG = /<meta\b[^>]*>/gi;
const HTTP_EQUIV_REFRESH = /(?<=[\s"'/:])http-equiv\s*=\s*["']?refresh\b/i;
const CONTENT_ATTRIBUTE = /(?<=[\s"'/:])content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const REFRESH_URL = /(?:^|[;,\s])url\s*=\s*(['"]?)([^'"]*)\1/i;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
const CSS_IMPORT_STRING = /@import\s+(?:"([^"]+)"|'([^']+)')/gi;

function isEmbedded(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized.startsWith('#') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:')
  );
}

// srcset holds comma-separated "url descriptor" candidates. A candidate URL is a run of
// non-whitespace characters, so commas inside a data: URL stay intact; trailing commas on
// the URL end that candidate (no descriptor follows), otherwise the descriptor runs up to
// the next comma.
function parseSrcsetCandidates(value: string): string[] {
  const urls: string[] = [];
  const length = value.length;
  let pos = 0;

  while (pos < length) {
    while (pos < length && /[\s,]/.test(value.charAt(pos))) {
      pos++;
    }
    if (pos >= length) break;

    const urlStart = pos;
    while (pos < length && !/\s/.test(value.charAt(pos))) {
      pos++;
    }
    const rawUrl = value.slice(urlStart, pos);

    if (rawUrl.endsWith(',')) {
      urls.push(rawUrl.replace(/,+$/, ''));
      continue;
    }
    urls.push(rawUrl);

    while (pos < length && /\s/.test(value.charAt(pos))) {
      pos++;
    }
    while (pos < length && value[pos] !== ',') {
      pos++;
    }
    if (pos < length && value[pos] === ',') {
      pos++;
    }
  }

  return urls;
}

export function findExternalReferences(html: string): ExternalReference[] {
  const references: ExternalReference[] = [];
  const cssBlocks: string[] = [];

  // 先移除 script 內容（程式碼可能含有 "<!--" 字串），再移除 HTML 註解，最後取出 style 區塊。
  const markup = html
    .replace(SCRIPT_BLOCK, (_match: string, attributes: string) => `<script${attributes}></script>`)
    .replace(HTML_COMMENT, '')
    .replace(STYLE_BLOCK, (_match: string, attributes: string, css: string) => {
      cssBlocks.push(css);
      return `<style${attributes}></style>`;
    });

  for (const match of markup.matchAll(URL_ATTRIBUTE)) {
    const attribute = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    if (attribute === 'srcset' || attribute === 'imagesrcset') {
      for (const candidate of parseSrcsetCandidates(value)) {
        if (!isEmbedded(candidate)) {
          references.push({ kind: 'attribute', value: candidate });
        }
      }
      continue;
    }

    if (!isEmbedded(value)) {
      references.push({ kind: 'attribute', value });
    }
  }

  for (const match of markup.matchAll(META_TAG)) {
    const tag = match[0];
    if (!HTTP_EQUIV_REFRESH.test(tag)) {
      continue;
    }
    const content = CONTENT_ATTRIBUTE.exec(tag);
    const contentValue = content?.[1] ?? content?.[2] ?? content?.[3] ?? '';
    const url = (REFRESH_URL.exec(contentValue)?.[2] ?? '').trim();
    if (url !== '' && !isEmbedded(url)) {
      references.push({ kind: 'attribute', value: url });
    }
  }

  const inlineStyles = Array.from(
    markup.matchAll(STYLE_ATTRIBUTE),
    (match) => match[1] ?? match[2] ?? '',
  );
  for (const css of [...cssBlocks, ...inlineStyles]) {
    for (const match of css.matchAll(CSS_URL)) {
      const value = match[1] ?? match[2] ?? match[3] ?? '';
      if (!isEmbedded(value)) {
        references.push({ kind: 'css', value });
      }
    }
    for (const match of css.matchAll(CSS_IMPORT_STRING)) {
      const value = match[1] ?? match[2] ?? '';
      if (!isEmbedded(value)) {
        references.push({ kind: 'css', value });
      }
    }
  }

  return references;
}
