import { mkdirSync, writeFileSync } from 'node:fs'
import iconv from 'iconv-lite'

// 人工樣本：只模仿繁殖牝馬匯出檔的前幾欄，內容虛構，不含真實匯出資料
const dir = new URL('../tests/fixtures/', import.meta.url)
mkdirSync(dir, { recursive: true })
const lines = [
  ['馬名', '国', '年', 'SP', 'ST', '距離適性', '父系'].join('\t'),
  ['テストウマ', '日', '5', '72', '40', '1700～3100m', 'エクリプス系'].join('\t'),
]
writeFileSync(new URL('sample-cp932.txt', dir), iconv.encode(`${lines.join('\r\n')}\r\n`, 'cp932'))
console.log('已產生 tests/fixtures/sample-cp932.txt')
