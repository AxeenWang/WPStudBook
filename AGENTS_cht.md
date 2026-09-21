# WPStudBook

> 本檔為 `AGENTS.md` 的繁體中文參考版本，不是指令入口。
> 兩者衝突時，以 `AGENTS.md` 為準並回報不一致之處。
> 兩個檔案須在同一次變更中同步更新。

## CodeLab Governance Bootstrap

CodeLab-Governance: optional

本專案支援 CodeLab-managed 與 standalone 兩種運作模式。

當 `../../AGENTS.md` 含有完全相符的獨立行 `CodeLab-Workspace-Root: v1`，且必要錨點可用時，使用 CodeLab-managed mode。進行專案工作前，先讀 `../../AGENTS.md` 與 `../../governance_eng.md`。Claude Code / Cowork 另須讀 `../../CLAUDE.md`。只有在中文請求、雙語維護或檢查不一致時，才讀 `../../governance_cht.md`。

其他情況下，不得到別處搜尋替代品。使用 standalone mode 與專案本地規則。未經使用者授權，不得讀寫專案目錄以外的內容。互動式工作與非互動式輸出都要回報模式及原因。

當 managed mode 驗證失敗必須阻止專案工作時，將標記改為 `CodeLab-Governance: required`。

## Repository

- 遠端：`https://github.com/AxeenWang/WPStudBook.git`
- 預設分支：`main`

## 專案規則

需求：`docs/specs/需求規格.md`。技術設計與選型理由：`docs/specs/技術設計.md`。

### 技術棧

- 成品：單一 HTML 檔 `app/dist/WPStudBook.html`，在 Windows 最新版 Edge 與 Chrome 以 `file://` 離線使用。執行時不依賴 CDN、網路、本機伺服器或擴充功能。
- TypeScript（strict）、Vue 3（`<script setup>`）、Pinia、Vue Router（hash 模式）、Reka UI、TanStack Virtual。
- Vite 搭配 `vite-plugin-singlefile`。IndexedDB 透過 Dexie 存取。
- 測試：Vitest、`fake-indexeddb`、Vue Test Utils、Playwright（Edge 與 Chromium）。
- Node 24 與 npm。`package-lock.json` 納入版控。
- CP932 解碼、gzip、SHA-256 使用瀏覽器內建 API。只有技術設計允許時才加入相依套件。

### Repo 版面

```
docs/specs/        需求規格、技術設計、參考頁面
app/               npm 專案根
  src/core/        領域模型與規則（純函式）
  src/ce-import/   CE 匯出檔解碼、解析與匯入流程
  src/storage/     Dexie 資料庫、備份、檢查點
  src/ui/          Vue 元件、頁面、Pinia store
  tests/acceptance/  依需求規格情境代號前綴分組的驗收測試
  tests/e2e/       對建置出的單檔執行 Playwright 測試
  tests/fixtures/  人工產生的 CE 範例檔
  tests/local/     讀 .references/ 的測試，資料夾不存在時略過
```

### 模組邊界

- `src/core/` 不得引用 Vue、Dexie、DOM API 或其他 `src` 模組。
- 在專案模組中，`src/ce-import/` 與 `src/storage/` 只能引用 `src/core/`。
- 任何模組都不得引用 `src/ui/`。
- 以 ESLint `no-restricted-imports` 強制上述規則。

### 作業命令

在 `app/` 執行：

- `npm ci`：依 lockfile 安裝。
- `npm run dev`：開發伺服器，只在開發時使用。
- `npm run build`：型別檢查後建置 `dist/WPStudBook.html`。
- `npm test`：單元與驗收測試。
- `npm run test:e2e`：建置後執行 Playwright。
- `npm run lint`：ESLint 與 Prettier 檢查。
- `npm run typecheck`：`vue-tsc`。

### 慣例

- 單元測試與原始檔放在一起，命名為 `*.test.ts`。
- 驗收測試的名稱以需求規格第 15 章的情境代號開頭，例如 `LINE-14`。
- 不得提交真實 CE 匯出檔或使用者試算表。這些檔案放在 `.references/`，測試使用人工範例檔。
- 不得提交建置或測試產物：`app/dist/`、`app/node_modules/`、Playwright 報告。
- 介面文字使用繁體中文；遊戲欄位、系統名與馬名保留日文。
- 規則變更時，在同一次變更中更新 `docs/specs/需求規格.md`；配對或血統規則變更時，一併更新 `docs/specs/八系巡迴圖.html`。
