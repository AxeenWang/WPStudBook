import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createDatabase, type WPStudBookDatabase } from '../../src/storage/database'

/** 測試用資料庫：每次呼叫都是全新、互不相干的 fake-indexeddb */
export function testDatabase(): WPStudBookDatabase {
  return createDatabase('wpstudbook-test', { indexedDB: new IDBFactory(), IDBKeyRange })
}
