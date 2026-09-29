/** 由 Vite 的 define 注入，值是 package.json 的 version（vite.config.ts） */
declare const __APP_VERSION__: string

/** 管理器的應用版本：寫入遊戲局與備份檔（需求規格 12.1、12.2） */
export const APP_VERSION: string = __APP_VERSION__
