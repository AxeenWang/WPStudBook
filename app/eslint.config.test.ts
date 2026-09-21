import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: fileURLToPath(new URL('.', import.meta.url)) })

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).map((message) => message.ruleId ?? '')
}

describe('模組邊界', () => {
  it('core 不得引用 Vue', async () => {
    const ids = await ruleIds(
      "import { ref } from 'vue'\nexport const a = ref(1)\n",
      'src/core/sample.ts',
    )
    expect(ids).toContain('no-restricted-imports')
  })

  it('core 不得引用其他 src 模組', async () => {
    const ids = await ruleIds(
      "import { x } from '@/storage/db'\nexport const a = x\n",
      'src/core/sample.ts',
    )
    expect(ids).toContain('no-restricted-imports')
  })

  it('core 不得使用 DOM 全域物件', async () => {
    const ids = await ruleIds('export const a = document.title\n', 'src/core/sample.ts')
    expect(ids).toContain('no-restricted-globals')
  })

  it('ce-import 可以引用 core，但不得引用 storage', async () => {
    const allowed = await ruleIds(
      "import { x } from '@/core/model'\nexport const a = x\n",
      'src/ce-import/sample.ts',
    )
    expect(allowed).not.toContain('no-restricted-imports')
    const denied = await ruleIds(
      "import { y } from '../storage/db'\nexport const b = y\n",
      'src/ce-import/sample.ts',
    )
    expect(denied).toContain('no-restricted-imports')
  })

  it('storage 不得引用 ui', async () => {
    const ids = await ruleIds(
      "import { z } from '@/ui/App.vue'\nexport const c = z\n",
      'src/storage/sample.ts',
    )
    expect(ids).toContain('no-restricted-imports')
  })

  it('ui 可以引用所有模組', async () => {
    const ids = await ruleIds(
      "import { x } from '@/storage/db'\nexport const a = x\n",
      'src/ui/sample.ts',
    )
    expect(ids).not.toContain('no-restricted-imports')
  })
})
