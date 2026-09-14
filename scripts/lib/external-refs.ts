export interface ExternalReference {
  kind: 'attribute' | 'css';
  value: string;
}

const SCRIPT_BLOCK = /<script\b([^>]*)>[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const URL_ATTRIBUTE =
  /\b(src|href|srcset|poster|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
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
    while (pos < length && /[\s,]/.test(value[pos]!)) {
      pos++;
    }
    if (pos >= length) break;

    const urlStart = pos;
    while (pos < length && !/\s/.test(value[pos]!)) {
      pos++;
    }
    const rawUrl = value.slice(urlStart, pos);

    if (rawUrl.endsWith(',')) {
      urls.push(rawUrl.replace(/,+$/, ''));
      continue;
    }
    urls.push(rawUrl);

    while (pos < length && /\s/.test(value[pos]!)) {
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

  const markup = html
    .replace(SCRIPT_BLOCK, (_match: string, attributes: string) => `<script${attributes}></script>`)
    .replace(STYLE_BLOCK, (_match: string, attributes: string, css: string) => {
      cssBlocks.push(css);
      return `<style${attributes}></style>`;
    });

  for (const match of markup.matchAll(URL_ATTRIBUTE)) {
    const attribute = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    if (attribute === 'srcset') {
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

  for (const css of cssBlocks) {
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
