import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractScenarioIds,
  extractTaggedIds,
  findUncoveredScenarios,
} from './lib/scenario-coverage.ts';

function listTestFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(test|spec)\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const scenarioIds = extractScenarioIds(readFileSync('../docs/需求規格.md', 'utf8'));
if (scenarioIds.length === 0) {
  console.error('找不到規格第 15 章的情境代號，請確認 ../docs/需求規格.md 的章節標題');
  process.exit(1);
}
const taggedIds = new Set<string>();
for (const file of listTestFiles('tests')) {
  for (const id of extractTaggedIds(readFileSync(file, 'utf8'))) {
    taggedIds.add(id);
  }
}

const uncovered = findUncoveredScenarios(scenarioIds, taggedIds);
const covered = scenarioIds.length - uncovered.length;
console.log(
  `情境總數 ${String(scenarioIds.length)}，已有測試 ${String(covered)}，尚無測試 ${String(uncovered.length)}`,
);
if (uncovered.length > 0) {
  console.log(uncovered.join('、'));
}
