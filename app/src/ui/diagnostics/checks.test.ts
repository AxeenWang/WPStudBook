import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import {
  CP932_SAMPLES,
  decodeCp932,
  gzipRoundTrip,
  inspectCp932Samples,
  readFirstLineCp932,
  sha256Hex,
} from './checks'

describe('sha256Hex', () => {
  it('算出 abc 的標準 SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('gzipRoundTrip', () => {
  it('壓縮再解壓後內容不變，且壓縮後較小', async () => {
    const text = '繁殖牝馬 エクリプス '.repeat(100)
    const result = await gzipRoundTrip(text)
    expect(result.restored).toBe(text)
    expect(result.compressedBytes).toBeGreaterThan(0)
    expect(result.compressedBytes).toBeLessThan(new TextEncoder().encode(text).byteLength)
  })
})

describe('decodeCp932', () => {
  it('解碼平假名', () => {
    expect(decodeCp932(new Uint8Array([0x82, 0xa0]))).toBe('あ')
  })

  it('與 iconv-lite 以 CP932 編碼的一般文字往返一致', () => {
    const text = 'テストウマ\t日\tエクリプス系'
    expect(decodeCp932(new Uint8Array(iconv.encode(text, 'cp932')))).toBe(text)
  })

  it('位元組不完整時丟出錯誤', () => {
    expect(() => decodeCp932(new Uint8Array([0x82]))).toThrow(TypeError)
  })
})

describe('readFirstLineCp932', () => {
  it('只回傳第一行', async () => {
    const bytes = iconv.encode('馬名\t国\r\nテストウマ\t日\r\n', 'cp932')
    expect(await readFirstLineCp932(new Blob([new Uint8Array(bytes)]))).toBe('馬名\t国')
  })
})

describe('inspectCp932Samples', () => {
  it('每個樣本都有結果，平假名與 Windows 一致', () => {
    const results = inspectCp932Samples()
    expect(results).toHaveLength(CP932_SAMPLES.length)
    expect(results[0]).toMatchObject({ label: 'あ', decoded: 'あ', matchesWindows: true })
  })

  it('Windows 對照碼位正確', () => {
    expect(CP932_SAMPLES.map((sample) => sample.windowsCodePoint)).toEqual([
      0x3042, 0x2460, 0x9ad9, 0xff5e, 0x2225, 0xff0d, 0xffe0, 0xffe1, 0xffe2,
    ])
  })
})
