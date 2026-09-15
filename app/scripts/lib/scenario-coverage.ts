const SCENARIO_ID = /\*\*([A-Z]+-\d{2,})\*\*/g;
const LEADING_TAGS = /['"`]((?:\[[A-Z]+-\d{2,}\])+)/g;
const TAG = /\[([A-Z]+-\d{2,})\]/g;

export function extractScenarioIds(specMarkdown: string): string[] {
  const afterChapter15 = specMarkdown.split(/^## 15\. /m)[1] ?? '';
  const chapter15 = afterChapter15.split(/^## 16\. /m)[0] ?? '';
  const ids = Array.from(chapter15.matchAll(SCENARIO_ID), (match) => match[1] ?? '');
  return [...new Set(ids.filter((id) => id !== ''))];
}

export function extractTaggedIds(testSource: string): Set<string> {
  const ids = new Set<string>();
  for (const match of testSource.matchAll(LEADING_TAGS)) {
    for (const tag of (match[1] ?? '').matchAll(TAG)) {
      if (tag[1] !== undefined) {
        ids.add(tag[1]);
      }
    }
  }
  return ids;
}

export function findUncoveredScenarios(
  scenarioIds: readonly string[],
  taggedIds: ReadonlySet<string>,
): string[] {
  return scenarioIds.filter((id) => !taggedIds.has(id));
}
