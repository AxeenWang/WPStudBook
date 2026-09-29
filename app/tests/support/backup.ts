import { exportBackup, sha256Hex, type BackupFile } from '../../src/storage/backup'
import type { WPStudBookDatabase } from '../../src/storage/database'
import type { GameRow } from '../../src/storage/records'
import { testDatabase } from './database'
import { addSampleGame } from './game-data'
import { GAME } from './rows'

/** 以 DecompressionStream 解開 gzip，取出文字 */
export async function gunzipText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** 樣本局（addSampleGame）的備份：匯出的檔案內容與解析後的物件 */
export async function sampleBackup(
  fields: Partial<GameRow> = {},
): Promise<{ db: WPStudBookDatabase; bytes: Uint8Array<ArrayBuffer>; file: BackupFile }> {
  const db = testDatabase()
  await addSampleGame(db, fields)
  const { bytes } = await exportBackup(db, fields.id ?? GAME, new Date('2026-09-29T01:02:03.000Z'))
  return { db, bytes, file: JSON.parse(await gunzipText(bytes)) }
}

/** 重新算雜湊後編成未壓縮的 JSON 位元組：用來做出內容有問題、但雜湊相符的備份檔 */
export async function signedBytes(file: object): Promise<Uint8Array<ArrayBuffer>> {
  const body: Record<string, unknown> = { ...file }
  delete body.sha256
  const text = JSON.stringify({ ...body, sha256: await sha256Hex(JSON.stringify(body)) })
  return new TextEncoder().encode(text)
}
