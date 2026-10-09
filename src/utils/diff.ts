import type { Diagram } from '../types';

export interface DiagramDiff {
  added: number;
  updated: number;
  removed: number;
  linked: number;
  unlinked: number;
  renamed: boolean;
  /** 一共动了多少处，用来写进编辑历史 */
  total: number;
  /** 有没有任何改动 */
  changed: boolean;
  /** 一句话摘要，比如「+3 方块 · ~1 修改 · →2 连线」 */
  summary: string;
}

const edgeKey = (edge: { from: string; to: string }): string => `${edge.from}->${edge.to}`;

/**
 * 比较沙盒结果和原图，算出到底动了什么。
 *
 * agent 的改动不再是「一串操作」，而是「一张改完的图」——
 * 所以确认界面上的差异要靠比对前后两张图算出来，而不是数操作个数。
 */
export function diffDiagrams(before: Diagram, after: Diagram): DiagramDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));

  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id);
    if (!previous) {
      added += 1;
      continue;
    }
    if (
      previous.label !== node.label ||
      previous.detail !== node.detail ||
      previous.group !== node.group
    ) {
      updated += 1;
    }
  }
  for (const node of before.nodes) {
    if (!afterNodes.has(node.id)) removed += 1;
  }

  const beforeEdges = new Set(before.edges.map(edgeKey));
  const afterEdges = new Set(after.edges.map(edgeKey));
  let linked = 0;
  let unlinked = 0;
  for (const key of afterEdges) if (!beforeEdges.has(key)) linked += 1;
  for (const key of beforeEdges) if (!afterEdges.has(key)) unlinked += 1;

  const renamed = before.title !== after.title;

  const parts: string[] = [];
  if (added) parts.push(`+${added} 方块`);
  if (updated) parts.push(`~${updated} 修改`);
  if (removed) parts.push(`−${removed} 删除`);
  if (linked) parts.push(`→${linked} 连线`);
  if (unlinked) parts.push(`✂${unlinked} 断开`);
  if (renamed) parts.push('改标题');

  return {
    added,
    updated,
    removed,
    linked,
    unlinked,
    renamed,
    total: added + updated + removed + linked + unlinked + (renamed ? 1 : 0),
    changed: parts.length > 0,
    summary: parts.join(' · '),
  };
}
