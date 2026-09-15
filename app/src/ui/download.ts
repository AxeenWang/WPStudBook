import type { DownloadFile } from '../services/backup.ts';

/** 以 <a download> 下載，不使用檔案系統 API（BLD-04）。 */
export function downloadFile(file: DownloadFile): void {
  const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mediaType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
