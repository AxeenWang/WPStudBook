import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
const target = 'WPStudBook.html'

function fail(message) {
  console.error(`單檔檢查失敗：${message}`)
  process.exit(1)
}

let files = []
try {
  files = readdirSync(distDir)
} catch {
  fail('找不到 dist 資料夾，請先建置')
}
if (!files.includes(target)) fail(`找不到 dist/${target}`)
const others = files.filter((name) => name !== target)
if (others.length > 0) fail(`dist 內還有其他檔案：${others.join('、')}`)

const html = readFileSync(distDir + target, 'utf8')
const external = [...html.matchAll(/<(script|link)\b[^>]*\b(src|href)=["']([^"']+)["']/gi)].map(
  (match) => match[3],
)
if (external.length > 0) fail(`HTML 仍引用外部檔案：${external.join('、')}`)
console.log(`單檔檢查通過：dist/${target}（${Math.round(html.length / 1024)} KB）`)
