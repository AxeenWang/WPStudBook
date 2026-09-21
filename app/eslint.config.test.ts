import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: fileURLToPath(new URL('.', import.meta.url)) })

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).map((message) => message.ruleId ?? '')
}

// 預熱共用的 ESLint 執行個體：首次載入 flat config／TypeScript project service
// 在較慢的機器上可能超過 Vitest 預設的 5000ms 測試逾時，故在此以較寬鬆的
// 逾時先跑過一次，讓下面每個測試案例都在暖機後的執行個體上運行。
beforeAll(async () => {
  await ruleIds('export const warmup = 1\n', 'src/core/warmup.ts')
}, 30000)

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
