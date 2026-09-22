import Dexie, { type EntityTable } from 'dexie'

export interface KvRow {
  key: string
  value: string
  savedAt: string
}

// 檔案系統存取 API 還不在 TypeScript 的 DOM 型別內，只宣告這裡用到的部分
interface WritableStreamLike {
  write(data: string): Promise<void>
  close(): Promise<void>
}
interface FileHandleLike {
  createWritable(): Promise<WritableStreamLike>
}
interface DirectoryHandleLike {
  readonly name: string
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandleLike>
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
}
type DirectoryPicker = (options: { mode: 'readwrite'; id: string }) => Promise<DirectoryHandleLike>

interface HandleRow {
  key: string
  handle: DirectoryHandleLike
}

const db = new Dexie('wpsb-diagnostics') as Dexie & {
  kv: EntityTable<KvRow, 'key'>
  handles: EntityTable<HandleRow, 'key'>
}
db.version(1).stores({ kv: 'key', handles: 'key' })

export interface IndexedDbProbe {
  previous: KvRow | null
  written: KvRow
}

export async function probeIndexedDb(now = new Date()): Promise<IndexedDbProbe> {
  const previous = (await db.kv.get('probe')) ?? null
  // 不用 crypto.randomUUID：它只在安全環境可用，而 file:// 是否算安全環境正是要驗證的項目
  const value = `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`
  const written: KvRow = { key: 'probe', value, savedAt: now.toISOString() }
  await db.kv.put(written)
  return { previous, written }
}

export interface PersistenceProbe {
  supported: boolean
  persistedBefore: boolean | null
  granted: boolean | null
  usage: number | null
  quota: number | null
}

export async function probePersistence(): Promise<PersistenceProbe> {
  const storage = navigator.storage
  if (!storage || typeof storage.persist !== 'function') {
    return { supported: false, persistedBefore: null, granted: null, usage: null, quota: null }
  }
  const persistedBefore = await storage.persisted()
  const granted = persistedBefore ? true : await storage.persist()
  const estimate = await storage.estimate()
  return {
    supported: true,
    persistedBefore,
    granted,
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
  }
}

function directoryPicker(): DirectoryPicker | undefined {
  return (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
}

export function supportsDirectoryPicker(): boolean {
  return typeof directoryPicker() === 'function'
}

async function writeProbeFile(dir: DirectoryHandleLike, now: Date): Promise<string> {
  const name = 'wpsb-backup-probe.txt'
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(`WPStudBook 備份資料夾測試 ${now.toISOString()}\r\n`)
  await writable.close()
  return `${dir.name}/${name}`
}

export async function pickFolderAndWrite(now = new Date()): Promise<string> {
  const pick = directoryPicker()
  if (!pick) throw new Error('此瀏覽器不支援選擇資料夾')
  const dir = await pick({ mode: 'readwrite', id: 'wpsb-backup' })
  await db.handles.put({ key: 'backup', handle: dir })
  return writeProbeFile(dir, now)
}

export async function writeWithStoredFolder(now = new Date()): Promise<string> {
  const row = await db.handles.get('backup')
  if (!row) throw new Error('尚未選擇備份資料夾')
  let state = await row.handle.queryPermission({ mode: 'readwrite' })
  if (state !== 'granted') state = await row.handle.requestPermission({ mode: 'readwrite' })
  if (state !== 'granted') throw new Error(`未取得寫入權限：${state}`)
  return writeProbeFile(row.handle, now)
}

export function downloadTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
