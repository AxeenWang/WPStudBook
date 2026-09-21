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

專案專屬規則（技術棧、repo 版面、作業命令、慣例）尚未定義。加入應用程式碼前，須在設計階段明確決定 repo 版面並記錄於此。
