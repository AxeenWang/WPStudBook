import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestPersistence } from './persistence'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 以 vi.stubGlobal 換掉 navigator.storage 的 persisted 與 persist */
function stubStorage(persisted: () => Promise<boolean>, persist: () => Promise<boolean>) {
  const storage = { persisted: vi.fn(persisted), persist: vi.fn(persist) }
  vi.stubGlobal('navigator', { storage })
  return storage
}

describe('requestPersistence', () => {
  it('瀏覽器沒有 navigator.storage.persist 時為不支援、未取得', async () => {
    vi.stubGlobal('navigator', {})
    expect(await requestPersistence()).toStrictEqual({ supported: false, persisted: false })
  })

  it('已經是持久保存時不再申請', async () => {
    const storage = stubStorage(
      async () => true,
      async () => false,
    )
    expect(await requestPersistence()).toStrictEqual({ supported: true, persisted: true })
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('還不是持久保存時申請，回傳申請的結果', async () => {
    const granted = stubStorage(
      async () => false,
      async () => true,
    )
    expect(await requestPersistence()).toStrictEqual({ supported: true, persisted: true })
    expect(granted.persist).toHaveBeenCalledOnce()

    stubStorage(
      async () => false,
      async () => false,
    )
    expect(await requestPersistence()).toStrictEqual({ supported: true, persisted: false })
  })

  it('申請時丟出例外視為未取得，不丟出', async () => {
    stubStorage(
      async () => false,
      async () => {
        throw new Error('拒絕')
      },
    )
    expect(await requestPersistence()).toStrictEqual({ supported: true, persisted: false })
  })
})
