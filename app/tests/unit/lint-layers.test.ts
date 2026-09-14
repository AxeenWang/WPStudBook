import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { layerConfigs } from '../../eslint.layers.js';

async function lintRuleIds(filePath: string, code: string): Promise<string[]> {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: layerConfigs });
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((result) => result.messages.map((message) => message.ruleId ?? 'fatal'));
}

describe('分層規則（設計決策第 4 節）', () => {
  it('domain 不可引用 React', async () => {
    const ids = await lintRuleIds(
      'src/domain/probe.ts',
      "import { useState } from 'react';\nexport const hook = useState;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('domain 不可使用瀏覽器全域物件', async () => {
    const ids = await lintRuleIds('src/domain/probe.ts', 'export const place = window.location;\n');
    expect(ids).toContain('no-restricted-globals');
  });

  it('ui 不可引用 storage', async () => {
    const ids = await lintRuleIds(
      'src/ui/Probe.tsx',
      "import { openProbe } from '../storage/probe.ts';\nexport const probe = openProbe;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('ui 可以用 import type 引用 domain', async () => {
    const ids = await lintRuleIds(
      'src/ui/Probe.tsx',
      "import type { Horse } from '../domain/horse.ts';\nexport type ProbeHorse = Horse;\n",
    );
    expect(ids).toEqual([]);
  });

  it('ui 不可引用 domain 的值', async () => {
    const ids = await lintRuleIds(
      'src/ui/Probe.tsx',
      "import { rule } from '../domain/rule.ts';\nexport const probe = rule;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('services 可以引用 storage', async () => {
    const ids = await lintRuleIds(
      'src/services/probe.ts',
      "import { openProbe } from '../storage/probe.ts';\nexport const probe = openProbe;\n",
    );
    expect(ids).toEqual([]);
  });

  it('storage 不可引用 services', async () => {
    const ids = await lintRuleIds(
      'src/storage/probe.ts',
      "import { runCheck } from '../services/check.ts';\nexport const probe = runCheck;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });
});
