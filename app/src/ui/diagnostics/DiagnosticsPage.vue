<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  downloadTextFile,
  pickFolderAndWrite,
  probeIndexedDb,
  probePersistence,
  supportsDirectoryPicker,
  writeWithStoredFolder,
} from './browser-checks'
import { gzipRoundTrip, inspectCp932Samples, readFirstLineCp932, sha256Hex } from './checks'
import type { CheckOutcome, CheckRow, CheckStatus, DiagnosticsState } from './types'

const SHA256_OF_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const statusText: Record<CheckStatus, string> = { ok: '成功', ng: '失敗', info: '資訊' }

const rows = ref<CheckRow[]>([])
const manualMessage = ref('')
const firstLine = ref('')
const state: DiagnosticsState = { done: false, results: [], cp932: [], indexedDb: null }
window.__wpsbDiagnostics = state

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const hex = (codePoint: number | null) =>
  (codePoint ?? 0).toString(16).toUpperCase().padStart(4, '0')

async function run(id: string, title: string, check: () => Promise<CheckOutcome>): Promise<void> {
  let row: CheckRow
  try {
    row = { id, title, ...(await check()) }
  } catch (error) {
    row = { id, title, status: 'ng', detail: errorText(error) }
  }
  rows.value.push(row)
  state.results.push(row)
}

onMounted(async () => {
  await run('indexeddb', 'IndexedDB 讀寫', async () => {
    const probe = await probeIndexedDb()
    state.indexedDb = probe
    return {
      status: 'ok',
      detail: probe.previous
        ? `讀到上次寫入的資料（${probe.previous.savedAt}）`
        : '沒有先前資料（第一次開啟）',
    }
  })
  await run('persist', '持久保存（navigator.storage.persist）', async () => {
    const result = await probePersistence()
    if (!result.supported) return { status: 'info', detail: '不支援' }
    return {
      status: 'info',
      detail: `原本已持久：${result.persistedBefore}；申請結果：${result.granted}；已用 ${result.usage} / 配額 ${result.quota} bytes`,
    }
  })
  await run('secure-context', '安全環境（isSecureContext）', async () => ({
    status: 'info',
    detail: String(window.isSecureContext),
  }))
  await run('sha256', 'SHA-256（crypto.subtle）', async () => {
    const value = await sha256Hex('abc')
    return { status: value === SHA256_OF_ABC ? 'ok' : 'ng', detail: value }
  })
  await run('gzip', 'gzip（CompressionStream）', async () => {
    const text = '繁殖牝馬 エクリプス '.repeat(50)
    const result = await gzipRoundTrip(text)
    return {
      status: result.restored === text ? 'ok' : 'ng',
      detail: `${text.length} 字壓縮為 ${result.compressedBytes} bytes`,
    }
  })
  await run('cp932', 'CP932 解碼（TextDecoder shift_jis）', async () => {
    state.cp932 = inspectCp932Samples()
    const first = state.cp932[0]
    return {
      status: first?.decoded === 'あ' ? 'ok' : 'ng',
      detail: `${state.cp932.length} 個樣本解碼完成`,
    }
  })
  await run('cp932-windows', 'CP932 與 Windows 對照', async () => {
    if (state.cp932.length === 0) return { status: 'ng', detail: '解碼失敗，無法比對' }
    const different = state.cp932.filter((sample) => !sample.matchesWindows)
    return {
      status: 'info',
      detail:
        different.length === 0
          ? '全部與 Windows 一致'
          : different
              .map(
                (sample) =>
                  `${sample.label}：U+${hex(sample.codePoint)}（Windows 為 U+${hex(sample.windowsCodePoint)}）`,
              )
              .join('；'),
    }
  })
  await run('directory-picker', '選擇資料夾（檔案系統存取）', async () => ({
    status: 'info',
    detail: supportsDirectoryPicker()
      ? '支援；寫入請用下方按鈕手動測試'
      : '不支援；備份改用自動下載',
  }))
  state.done = true
})

async function attempt(action: () => Promise<string>): Promise<void> {
  try {
    manualMessage.value = `已寫入：${await action()}`
  } catch (error) {
    manualMessage.value = `失敗：${errorText(error)}`
  }
}

function downloadTest(): void {
  downloadTextFile('wpsb-download-test.txt', 'WPStudBook 下載測試\r\n')
  manualMessage.value = '已觸發下載：wpsb-download-test.txt'
}

async function onFileSelected(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    firstLine.value = (await readFirstLineCp932(file)).split('\t').join(' | ')
  } catch (error) {
    firstLine.value = `解碼失敗：${errorText(error)}`
  }
}
</script>

<template>
  <main class="diagnostics">
    <h1>WPStudBook 技術驗證</h1>
    <p>以 file:// 開啟本檔，確認瀏覽器功能能不能用。結果記錄到 docs/specs/技術設計.md 第 7 節。</p>

    <table>
      <thead>
        <tr>
          <th scope="col">項目</th>
          <th scope="col">結果</th>
          <th scope="col">說明</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :data-testid="`check-${row.id}`"
          :data-status="row.status"
        >
          <td>{{ row.title }}</td>
          <td>{{ statusText[row.status] }}</td>
          <td>{{ row.detail }}</td>
        </tr>
      </tbody>
    </table>

    <h2>手動測試</h2>
    <div class="actions">
      <button type="button" data-testid="pick-folder" @click="attempt(() => pickFolderAndWrite())">
        選擇備份資料夾並寫入測試檔
      </button>
      <button
        type="button"
        data-testid="reuse-folder"
        @click="attempt(() => writeWithStoredFolder())"
      >
        用上次的資料夾寫入
      </button>
      <button type="button" data-testid="download-test" @click="downloadTest">下載測試檔</button>
    </div>
    <p data-testid="manual-message" role="status">{{ manualMessage }}</p>

    <h2>讀取 CP932 檔案</h2>
    <label>
      選擇 CE 匯出檔或範例檔：
      <input
        type="file"
        data-testid="cp932-file"
        accept=".txt,.tsv,.csv"
        @change="onFileSelected"
      />
    </label>
    <p data-testid="cp932-first-line">{{ firstLine }}</p>
  </main>
</template>

<style scoped>
.diagnostics {
  font-family: 'Microsoft JhengHei', 'Noto Sans TC', system-ui, sans-serif;
  max-width: 960px;
  margin: 0 auto;
  padding: 16px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  border: 1px solid #c8ced6;
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
