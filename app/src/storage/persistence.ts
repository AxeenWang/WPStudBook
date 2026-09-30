/** 持久保存的申請結果（需求規格 12.2、DATA-14） */
export interface PersistenceStatus {
  /** 瀏覽器有沒有 navigator.storage.persist */
  supported: boolean
  /** 是否取得持久保存 */
  persisted: boolean
}

/**
 * 向瀏覽器申請持久保存（技術設計 4.3「瀏覽器整合」）：已經持久時不再申請；不支援，或申請時丟出例外，
 * 都視為未取得，不丟出。結果不存進資料庫：它是這次開啟時瀏覽器的狀態，每次開啟重新申請
 */
export async function requestPersistence(): Promise<PersistenceStatus> {
  const storage = globalThis.navigator?.storage
  if (typeof storage?.persist !== 'function') return { supported: false, persisted: false }
  try {
    if (await storage.persisted()) return { supported: true, persisted: true }
    return { supported: true, persisted: await storage.persist() }
  } catch {
    return { supported: true, persisted: false }
  }
}
