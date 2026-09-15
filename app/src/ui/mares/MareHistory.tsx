import type { MareHistoryItem } from '../../services/mares.ts';
import { formatDateTime } from '../format.ts';
import { describeHistoryItem } from './labels.ts';

/** 歷程頁籤：事件新到舊，只新增不改寫（需求規格 5.3）。 */
export function MareHistory({ items }: { readonly items: readonly MareHistoryItem[] }) {
  if (items.length === 0) {
    return <p>尚無歷程。</p>;
  }
  return (
    <ol className="history-list">
      {items.map((item) => (
        <li key={item.id}>
          {describeHistoryItem(item)}
          <span className="notice">（{formatDateTime(item.occurredAt)}）</span>
        </li>
      ))}
    </ol>
  );
}
