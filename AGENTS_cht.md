# WPStudBook

> 本文件是 `AGENTS.md` 的繁體中文參考版，不是 Agent 指引入口。`AGENTS.md` 為正式規則，兩者衝突時以 `AGENTS.md` 為準並回報不一致。只在雙語維護或不一致檢查時讀取本文件，修改時兩個檔案須在同一次變更中同步更新。

## CodeLab 治理 Bootstrap

CodeLab-Governance: optional

本專案支援 CodeLab-managed mode 與 standalone mode。

當 `../../AGENTS.md` 含有獨立成行且完全相符的 `CodeLab-Workspace-Root: v1`，且必要的 Governance Anchor Files 可用時，使用 CodeLab-managed mode。進行專案工作前，先讀取 `../../AGENTS.md` 與 `../../governance_eng.md`。Claude Code / Cowork 另外讀取 `../../CLAUDE.md`。只有在中文請求、雙語維護或不一致檢查時，才讀取 `../../governance_cht.md`。

否則不得到其他位置尋找替代檔案，改用 standalone mode 與專案本地規則。未經使用者授權，不得讀寫專案目錄以外的位置。互動工作與非互動輸出都必須回報模式及原因。

若 managed mode 驗證失敗時必須阻止專案工作，將標記改為 `CodeLab-Governance: required`。

## 專案

- Repository：https://github.com/AxeenWang/WPStudBook
- 預設分支：`main`
- Agent 暫存區 `.codex-tmp/` 與 `.claude-tmp/` 已被 Git 忽略，絕不可 commit。

## Repository 版面

- Repository 根目錄只放專案規則（`AGENTS.md`、`AGENTS_cht.md`、`CLAUDE.md`）、`.gitignore`、`.github/`（GitHub 規定必須放在根目錄）、`docs/`、`.references/` 與 Agent 暫存區。
- 所有程式碼、工具設定、依賴與建置或測試產出都放在 `app/`，包括 `package.json`、lockfile、工具設定檔、`src/`、`tests/`、`scripts/`、`node_modules/`、`dist/`、`test-results/` 與 `playwright-report/`。
- npm、建置、程式檢查與測試指令都在 `app/` 內執行。絕不可在根目錄執行 `npm install` 或建立工具設定。
- 未經使用者明確同意，不得新增根目錄檔案或資料夾。
- 資料夾名稱不得重複上層資料夾的意思，例如 `source/src` 或 `app/src/app`。目錄細節與模組分層見 `docs/設計決策.md` 第 4 節。

## 參考資料（`.references/`）

- `.references/` 存放使用者手動加入、供 Agent 參考的資料，例如遊戲匯出樣本、試算表與截圖。
- 內容可能在未通知的情況下變動。使用者隨時可能新增或刪除檔案，因此依賴某個檔案前須先確認它仍存在，也不得把先前讀到的內容視為現況。
- Agent 將此目錄視為唯讀，不得在其中新增、修改、重新命名或整理檔案。只有使用者明確要求時才能刪除檔案。
- 此目錄不是暫存區。Agent 的暫存內容放在該 Agent 自己的暫存區。
- 此目錄已被 Git 忽略，絕不可 stage 或 commit。Repository 是公開的，未經使用者明確同意，不得把原始內容複製到文件、測試、fixture 或原始碼等受版本控制的檔案。在受版本控制的文件中描述格式或觀察結果則沒有問題。
