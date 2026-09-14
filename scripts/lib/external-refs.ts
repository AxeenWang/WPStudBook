export interface ExternalReference {
  kind: 'attribute' | 'css';
  value: string;
}

const SCRIPT_BLOCK = /<script\b([^>]*)>[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const URL_ATTRIBUTE = /\b(?:src|href|srcset|poster|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
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
    const value = match[1] ?? match[2] ?? match[3] ?? '';
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
