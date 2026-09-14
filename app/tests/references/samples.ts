import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportFormatId } from '../../src/import/formats.ts';

export interface ReferenceSample {
  readonly fileName: string;
  readonly formatId: ImportFormatId;
}

const REFERENCE_DIR = '../.references';

export const REFERENCE_SAMPLES: readonly ReferenceSample[] = [
  { fileName: '1968年 1月1週._二歲新馬.txt', formatId: 'jan2yo' },
  { fileName: '1968年 4月1週_幼駒誕生.txt', formatId: 'aprFoals' },
  { fileName: '1968年 5月1週_繁殖牝馬.txt', formatId: 'broodmare' },
  { fileName: '1968年 7月1週_繁殖牝馬.txt', formatId: 'broodmare' },
  { fileName: '1968年10月1週_繁殖牝馬.txt', formatId: 'broodmare' },
  { fileName: '1968年5月1週_種牡馬.txt', formatId: 'stallion' },
];

function samplePath(sample: ReferenceSample): string {
  return join(REFERENCE_DIR, sample.fileName);
}

export function sampleExists(sample: ReferenceSample): boolean {
  return existsSync(samplePath(sample));
}

export function readSampleBytes(sample: ReferenceSample): Uint8Array {
  return new Uint8Array(readFileSync(samplePath(sample)));
}
