# WPStudBook

《Winning Post 10 2026》「八系」繁殖計畫管理器。

八系計畫原本靠 Excel 人工推算。本專案把系與代數、兩兩互換配對、母馬群、後繼與血緣轉成可驗證、能防錯的管理流程；每年只需匯入 Cheat Engine（CE）匯出的年度檔案，就能維持繁殖圈、產駒與受胎結果的正確狀態。

## 現況

需求規格與技術設計已完成，尚未開始實作。實作第一步是技術驗證（見技術設計第 7 節）。

## 成品目標

- 單一 HTML 檔，在 Windows 最新版 Edge／Chrome 以 `file://` 離線使用。
- 資料存於瀏覽器 IndexedDB，以 JSON／JSON.GZ 備份與還原。
- 不依賴 CDN、網路或本機伺服器；與 CE 只透過匯出檔單向橋接，不讀寫遊戲記憶體。

## 文件

- [需求規格](docs/specs/需求規格.md)
- [技術設計](docs/specs/技術設計.md)：技術選型、架構、目錄結構與測試方式
- [八系巡迴圖](docs/specs/八系巡迴圖.html)：建系與循環配對、血統推算的參考頁面

## 專案規則

- [AGENTS.md](AGENTS.md)：正式規則（英文）
- [AGENTS_cht.md](AGENTS_cht.md)：繁體中文參考版
- [CLAUDE.md](CLAUDE.md)：Claude Code 入口
