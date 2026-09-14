import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findExternalReferences } from './lib/external-refs.ts';

const DIST_DIR = 'dist';
const OUTPUT_FILE = 'WPStudBook.html';

const entries = readdirSync(DIST_DIR);
if (entries.length !== 1 || entries[0] !== OUTPUT_FILE) {
  console.error(`dist/ 應只有 ${OUTPUT_FILE}，實際為：${entries.join(', ')}`);
  process.exit(1);
}

const filePath = join(DIST_DIR, OUTPUT_FILE);
const references = findExternalReferences(readFileSync(filePath, 'utf8'));
if (references.length > 0) {
  console.error('成品含有外部載入：');
  for (const reference of references) {
    console.error(`- [${reference.kind}] ${reference.value}`);
  }
  process.exit(1);
}

const sizeKb = (statSync(filePath).size / 1024).toFixed(1);
console.log(`dist/${OUTPUT_FILE} 通過外部載入檢查，大小 ${sizeKb} KB`);
