export const IMPORT_TYPES = [
  'jan2yo',
  'aprFoals',
  'mayMares',
  'julMares',
  'candidateFile',
  'mayStallions',
  'targetStallion',
  'octWorldMares',
] as const;

export type ImportType = (typeof IMPORT_TYPES)[number];
