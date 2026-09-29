import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './src/storage/version'

describe('vite.config.ts', () => {
  it('把 package.json 的 version 注入成應用版本（src/storage/version.ts）', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
    )
    expect(APP_VERSION).toBe(packageJson.version)
  })
})
