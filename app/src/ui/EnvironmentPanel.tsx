import { useCallback, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import {
  runEnvironmentCheck,
  type EnvironmentCheckKey,
  type EnvironmentReport,
} from '../services/environment-check.ts';

const CHECK_LABELS = [
  ['secureContext', '安全環境（isSecureContext）'],
  ['randomUuid', 'crypto.randomUUID()'],
  ['sha256', 'SHA-256（crypto.subtle）'],
  ['compression', 'gzip（CompressionStream／DecompressionStream）'],
  ['shiftJis', 'CP932 嚴格解碼（TextDecoder shift_jis）'],
  ['indexedDb', 'IndexedDB 寫入與讀回'],
] as const satisfies ReadonlyArray<readonly [EnvironmentCheckKey, string]>;

export function EnvironmentPanel() {
  const [report, setReport] = useState<EnvironmentReport | undefined>(undefined);

  const check = useCallback(async () => {
    setReport(await runEnvironmentCheck());
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <section aria-labelledby="environment-heading">
      <h2 id="environment-heading">環境檢查</h2>
      {report === undefined ? (
        <p role="status">檢查中…</p>
      ) : (
        <table>
          <tbody>
            {CHECK_LABELS.map(([key, label]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td data-testid={`env-${key}`}>{report[key] ? '通過' : '失敗'}</td>
                <td data-testid={`env-${key}-reason`}>{report.failures[key] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button
        onPress={() => {
          void check();
        }}
      >
        重新檢查
      </Button>
    </section>
  );
}
