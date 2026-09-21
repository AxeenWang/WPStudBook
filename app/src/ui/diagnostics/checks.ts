export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function gzipRoundTrip(
  text: string,
): Promise<{ restored: string; compressedBytes: number }> {
  const compressedStream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer())
  const restoredStream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  const restored = await new Response(restoredStream).text()
  return { restored, compressedBytes: compressed.byteLength }
}

export function decodeCp932(bytes: Uint8Array): string {
  return new TextDecoder('shift_jis', { fatal: true }).decode(bytes)
}

export async function readFirstLineCp932(file: Blob): Promise<string> {
  const text = decodeCp932(new Uint8Array(await file.arrayBuffer()))
  return text.split(/\r?\n/)[0] ?? ''
}

export interface Cp932Sample {
  label: string
  bytes: number[]
  windowsCodePoint: number
}

// Windows CP932 的解碼結果；瀏覽器的 Shift_JIS 解碼器對後六個字可能給出不同字元
export const CP932_SAMPLES: Cp932Sample[] = [
  { label: 'あ', bytes: [0x82, 0xa0], windowsCodePoint: 0x3042 },
  { label: 'NEC 特殊字 ①', bytes: [0x87, 0x40], windowsCodePoint: 0x2460 },
  { label: 'IBM 擴充字 髙', bytes: [0xfb, 0xfc], windowsCodePoint: 0x9ad9 },
  { label: '波浪號（距離適性用）', bytes: [0x81, 0x60], windowsCodePoint: 0xff5e },
  { label: '平行符號', bytes: [0x81, 0x61], windowsCodePoint: 0x2225 },
  { label: '減號', bytes: [0x81, 0x7c], windowsCodePoint: 0xff0d },
  { label: '分幣符號', bytes: [0x81, 0x91], windowsCodePoint: 0xffe0 },
  { label: '英鎊符號', bytes: [0x81, 0x92], windowsCodePoint: 0xffe1 },
  { label: '否定符號', bytes: [0x81, 0xca], windowsCodePoint: 0xffe2 },
]

export interface Cp932Inspection {
  label: string
  decoded: string
  codePoint: number | null
  windowsCodePoint: number
  matchesWindows: boolean
}

export function inspectCp932Samples(): Cp932Inspection[] {
  return CP932_SAMPLES.map((sample) => {
    const decoded = decodeCp932(new Uint8Array(sample.bytes))
    const codePoint = decoded.codePointAt(0) ?? null
    return {
      label: sample.label,
      decoded,
      codePoint,
      windowsCodePoint: sample.windowsCodePoint,
      matchesWindows: codePoint === sample.windowsCodePoint,
    }
  })
}
