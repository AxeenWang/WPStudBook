import { useCallback, useState } from 'react';
import { Button } from 'react-aria-components';
import type { PedigreeNode, PedigreeStatus } from '../../domain/pedigree.ts';
import type { ServiceContext } from '../../services/context.ts';
import { PEDIGREE_DEFAULT_GENERATIONS, loadPedigree } from '../../services/pedigree.ts';
import { SEX_LABELS } from '../foals/labels.ts';
import { useServiceQuery } from '../ServicesContext.tsx';

const STATUS_LABELS: Readonly<Record<PedigreeStatus, string>> = {
  sold: '已售出',
  retired: '已引退',
  replaced: '已被取代',
  outOfService: '退出生產行列',
};

function nodeText(node: PedigreeNode): string {
  switch (node.kind) {
    case 'horse':
      return node.name;
    case 'external':
      return node.name;
    case 'missing':
      return '資料不足';
  }
}

function PedigreeItem({ node, role }: { readonly node: PedigreeNode; readonly role: string }) {
  const label = `${role}：${nodeText(node)}`;
  return (
    <li aria-label={label}>
      <span className="pedigree-role">{role}</span> <strong>{nodeText(node)}</strong>
      {node.kind === 'horse' && (
        <>
          {node.birthYear !== undefined && <span>（{node.birthYear} 年生）</span>}
          {node.statuses.map((status) => (
            <span key={status} className="badge">
              {STATUS_LABELS[status]}
            </span>
          ))}
          {node.duplicate && <span className="badge">重複祖先</span>}
          {(node.sire !== undefined || node.dam !== undefined) && (
            <ul className="pedigree">
              {node.sire !== undefined && <PedigreeItem node={node.sire} role="父" />}
              {node.dam !== undefined && <PedigreeItem node={node.dam} role="母" />}
            </ul>
          )}
        </>
      )}
      {node.kind === 'external' && <span className="badge">尚未連結內部馬匹</span>}
      {node.kind === 'missing' && <span className="notice">（{SEX_LABELS[node.sex]}）</span>}
    </li>
  );
}

/**
 * 血緣表（需求規格 10.4、PED-09）：依內部識別向上展開，預設到曾祖父母，可再展開一代。
 * 已售出、引退、被取代者照常列出並標示；外部參考、重複祖先與資料不足另外標示。
 */
export function PedigreeView({ horseId }: { readonly horseId: string }) {
  const [generations, setGenerations] = useState(PEDIGREE_DEFAULT_GENERATIONS);
  const load = useCallback(
    (serviceContext: ServiceContext) => loadPedigree(serviceContext, horseId, generations),
    [horseId, generations],
  );
  const { data, error } = useServiceQuery(load);
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  const { root } = data;
  return (
    <section aria-label="血緣表" className="pedigree-view">
      <p>
        {`顯示 ${String(data.generations)} 代。`}
        已售出、引退或被取代的祖先照常列出；只有匯入名稱的父母標示「尚未連結內部馬匹」。
      </p>
      {error !== undefined && <p role="alert">{error}</p>}
      <ul className="pedigree pedigree-root">
        <PedigreeItem node={root} role="本馬" />
      </ul>
      {data.canExpand && (
        <Button
          onPress={() => {
            setGenerations(data.generations + 1);
          }}
        >
          再展開一代
        </Button>
      )}
    </section>
  );
}
