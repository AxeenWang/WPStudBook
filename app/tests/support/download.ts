import { vi } from 'vitest'

/** 被點擊的下載連結：檔名、網址與內容 */
export interface Download {
  fileName: string
  url: string
  blob: Blob
}

/**
 * 以 vi.stubGlobal 換掉 document（Node 沒有 document），記錄 downloadFile 建立並點擊的每一個連結。
 * URL.createObjectURL 照常產生網址（Node 本身就有），另外記下網址對應的 Blob。
 * 測試結束時要呼叫 vi.unstubAllGlobals() 與 vi.restoreAllMocks()
 */
export function stubDownloads(): Download[] {
  const downloads: Download[] = []
  const blobs = new Map<string, Blob>()
  const createObjectURL = URL.createObjectURL.bind(URL)
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = createObjectURL(blob)
    blobs.set(url, blob as Blob)
    return url
  })
  vi.stubGlobal('document', {
    createElement(tag: string) {
      if (tag !== 'a') throw new Error(`下載只建立 <a>，不是 <${tag}>`)
      const anchor = {
        href: '',
        download: '',
        click() {
          downloads.push({
            fileName: anchor.download,
            url: anchor.href,
            blob: blobs.get(anchor.href)!,
          })
        },
      }
      return anchor
    },
  })
  return downloads
}

/** Blob 的位元組 */
export async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer())
}
