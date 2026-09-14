const SCENARIO_ID = /\*\*([A-Z]+-\d{2})\*\*/g;
const TEST_TAG = /['"`]\[([A-Z]+-\d{2})\]/g;

export function extractScenarioIds(specMarkdown: string): string[] {
  const afterChapter15 = specMarkdown.split(/^## 15\. /m)[1] ?? '';
  const chapter15 = afterChapter15.split(/^## 16\. /m)[0] ?? '';
  const ids = Array.from(chapter15.matchAll(SCENARIO_ID), (match) => match[1] ?? '');
  return [...new Set(ids.filter((id) => id !== ''))];
}

export function extractTaggedIds(testSource: string): Set<string> {
  const ids = Array.from(testSource.matchAll(TEST_TAG), (match) => match[1] ?? '');
  return new Set(ids.filter((id) => id !== ''));
}

export function findUncoveredScenarios(
  scenarioIds: readonly string[],
  taggedIds: ReadonlySet<string>,
): string[] {
  return scenarioIds.filter((id) => !taggedIds.has(id));
}
