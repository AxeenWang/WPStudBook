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

  it('domain 不可引用 idb', async () => {
    const ids = await lintRuleIds(
      'src/domain/probe.ts',
      "import { openDB } from 'idb';\nexport const probe = openDB;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('import 不可引用 storage', async () => {
    const ids = await lintRuleIds(
      'src/import/probe.ts',
      "import { openProbe } from '../storage/probe.ts';\nexport const probe = openProbe;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('services 不可引用 React', async () => {
    const ids = await lintRuleIds(
      'src/services/probe.ts',
      "import { useState } from 'react';\nexport const probe = useState;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('ui 不可引用 import 與 idb', async () => {
    const ids = await lintRuleIds(
      'src/ui/Probe.tsx',
      "import { parse } from '../import/formats.ts';\nimport { openDB } from 'idb';\nexport const probe = [parse, openDB];\n",
    );
    expect(ids.filter((id) => id === '@typescript-eslint/no-restricted-imports')).toHaveLength(2);
  });

  it('ui 連型別也不可引用 storage', async () => {
    const ids = await lintRuleIds(
      'src/ui/Probe.tsx',
      "import type { AppDatabase } from '../storage/database.ts';\nexport type Probe = AppDatabase;\n",
    );
    expect(ids).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('main.tsx 不可直接引用 services 或 storage', async () => {
    const ids = await lintRuleIds(
      'src/main.tsx',
      "import { open } from './services/context.ts';\nimport { openDB } from './storage/database.ts';\nexport const probe = [open, openDB];\n",
    );
    expect(ids.filter((id) => id === '@typescript-eslint/no-restricted-imports')).toHaveLength(2);
  });

  it('main.tsx 可以引用 ui', async () => {
    const ids = await lintRuleIds(
      'src/main.tsx',
      "import { App } from './ui/App.tsx';\nexport const probe = App;\n",
    );
    expect(ids).toEqual([]);
  });

  it('src 不可使用動態 import', async () => {
    const ids = await lintRuleIds(
      'src/services/probe.ts',
      "export const load = () => import('./other.ts');\n",
    );
    expect(ids).toContain('no-restricted-syntax');
  });

  it('[BLD-04] 不可使用對外連線與檔案系統 API', async () => {
    const ids = await lintRuleIds(
      'src/ui/Probe.tsx',
      [
        "export const a = () => fetch('https://example.com/');",
        "export const b = () => new WebSocket('wss://example.com/');",
        'export const c = () => showSaveFilePicker();',
      ].join('\n'),
    );
    expect(ids.filter((id) => id === 'no-restricted-globals')).toHaveLength(3);
  });

  it('[BLD-04] 不可經由 window、globalThis 或 navigator 取用對外 API', async () => {
    const ids = await lintRuleIds(
      'src/services/probe.ts',
      [
        "export const a = () => window.fetch('x');",
        'export const b = () => globalThis.EventSource;',
        "export const c = () => navigator.sendBeacon('x');",
        'export const d = () => navigator.usb;',
      ].join('\n'),
    );
    expect(ids.filter((id) => id === 'no-restricted-properties')).toHaveLength(4);
  });

  it('[BLD-04] domain 同時禁止瀏覽器全域物件與對外 API', async () => {
    const ids = await lintRuleIds(
      'src/domain/probe.ts',
      'export const a = () => document.title;\nexport const b = () => new XMLHttpRequest();\n',
    );
    expect(ids.filter((id) => id === 'no-restricted-globals')).toHaveLength(2);
  });
});
