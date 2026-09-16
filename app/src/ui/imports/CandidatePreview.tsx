import { useMemo, useState } from 'react';
import type { PreviewOutcome } from '../../domain/import-batch.ts';
import type { CandidateRow } from '../../services/candidate-import.ts';
import { horseNumberText } from '../../services/mares.ts';
import { SelectField, type SelectOption } from '../fields.tsx';
import { formatVitality } from '../mares/labels.ts';
import { OUTCOME_LABELS } from './labels.ts';

const PAGE_SIZE = 24;

const OUTCOME_OPTIONS: readonly SelectOption<PreviewOutcome>[] = (
  ['apply', 'skip', 'review', 'warn', 'error'] as const
).map((value) => ({ value, label: OUTCOME_LABELS[value] }));

function matchesSearch(row: CandidateRow, search: string): boolean {
  if (search === '') {
    return true;
  }
  const keyword = search.trim().toLowerCase();
  return [row.values.fullName, row.values.sireName, row.values.damName, row.values.sireSubsystem]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.toLowerCase().includes(keyword));
}

interface CandidatePreviewProps {
  readonly rows: readonly CandidateRow[];
  readonly selected: ReadonlySet<number>;
  readonly onToggle: (lineNumber: number, checked: boolean) => void;
  readonly onToggleShown: (lineNumbers: readonly number[], checked: boolean) => void;
}

/** 候選 TXT 預覽（需求規格 11.7、CAND-01）：分頁、搜尋、篩選與勾選。 */
export function CandidatePreview(props: CandidatePreviewProps) {
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState<PreviewOutcome>();
  const [page, setPage] = useState(0);

  const filtered = useMemo(
    () =>
      props.rows.filter(
        (row) => matchesSearch(row, search) && (outcome === undefined || row.outcome === outcome),
      ),
    [props.rows, search, outcome],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const shown = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const selectable = shown.filter((row) => row.outcome === 'apply');

  return (
    <div className="candidate-preview">
      <div className="field-row">
        <div className="field">
          <label htmlFor="candidate-search">搜尋馬名、父馬、母馬或父系</label>
          <input
            id="candidate-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <SelectField
          label="只看分類"
          value={outcome}
          options={OUTCOME_OPTIONS}
          emptyLabel="全部"
          onChange={(value) => {
            setOutcome(value);
            setPage(0);
          }}
        />
      </div>

      <p role="status">
        符合 {filtered.length} 筆，第 {current + 1} / {pageCount} 頁；已勾選 {props.selected.size}{' '}
        筆
      </p>

      <table data-testid="candidate-preview-table">
        <caption>候選母馬預覽</caption>
        <thead>
          <tr>
            <th scope="col">
              <button
                type="button"
                onClick={() => {
                  props.onToggleShown(
                    selectable.map((row) => row.lineNumber),
                    !selectable.every((row) => props.selected.has(row.lineNumber)),
                  );
                }}
                disabled={selectable.length === 0}
              >
                本頁全選／全不選
              </button>
            </th>
            <th scope="col">馬名</th>
            <th scope="col">年齡</th>
            <th scope="col">SP</th>
            <th scope="col">ST</th>
            <th scope="col">仔出</th>
            <th scope="col">活力</th>
            <th scope="col">父馬</th>
            <th scope="col">母馬</th>
            <th scope="col">父系</th>
            <th scope="col">牝系</th>
            <th scope="col">能力番号</th>
            <th scope="col">分類</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.lineNumber} data-testid={`candidate-row-${String(row.lineNumber)}`}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`勾選 ${row.label}`}
                  checked={props.selected.has(row.lineNumber)}
                  disabled={row.outcome !== 'apply'}
                  onChange={(event) => {
                    props.onToggle(row.lineNumber, event.target.checked);
                  }}
                />
              </td>
              <th scope="row">{row.label}</th>
              <td>{row.values.age ?? '—'}</td>
              <td>{row.values.sp ?? '—'}</td>
              <td>{row.values.st ?? '—'}</td>
              <td>{row.values.kodashi ?? '—'}</td>
              <td>
                {row.values.vitality === undefined
                  ? '—'
                  : formatVitality(row.values.vitality, undefined)}
              </td>
              <td>{row.values.sireName ?? '—'}</td>
              <td>{row.values.damName ?? '—'}</td>
              <td>{row.values.sireSubsystem ?? '—'}</td>
              <td>{row.values.femaleLine ?? '未取得'}</td>
              <td>
                {row.values.abilityNo === undefined ? '—' : horseNumberText(row.values.abilityNo)}
              </td>
              <td>
                {OUTCOME_LABELS[row.outcome]}
                {row.issues.length > 0 && <span>：{row.issues[0]?.message}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pager">
        <button
          type="button"
          onClick={() => {
            setPage(current - 1);
          }}
          disabled={current === 0}
        >
          上一頁
        </button>
        <button
          type="button"
          onClick={() => {
            setPage(current + 1);
          }}
          disabled={current >= pageCount - 1}
        >
          下一頁
        </button>
      </div>
    </div>
  );
}
