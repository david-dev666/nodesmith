import type { Diagram, DiagramEdge, DiagramNode } from '../types';

export function newId(prefix = 'n'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function cloneDiagram(diagram: Diagram): Diagram {
  return JSON.parse(JSON.stringify(diagram)) as Diagram;
}

export function findNode(diagram: Diagram, id: string): DiagramNode | undefined {
  return diagram.nodes.find((node) => node.id === id);
}

/** 出边：从这个节点指出去的边 */
export function outgoing(diagram: Diagram): Map<string, DiagramEdge[]> {
  const map = new Map<string, DiagramEdge[]>();
  for (const edge of diagram.edges) {
    const list = map.get(edge.from) ?? [];
    list.push(edge);
    map.set(edge.from, list);
  }
  return map;
}

/** 入边：指向这个节点的边 */
export function incoming(diagram: Diagram): Map<string, DiagramEdge[]> {
  const map = new Map<string, DiagramEdge[]>();
  for (const edge of diagram.edges) {
    const list = map.get(edge.to) ?? [];
    list.push(edge);
    map.set(edge.to, list);
  }
  return map;
}

export function childIds(diagram: Diagram, id: string): string[] {
  return diagram.edges.filter((edge) => edge.from === id).map((edge) => edge.to);
}

/** 删掉节点时，把挂在它身上的边一起摘掉 */
export function edgesWithout(diagram: Diagram, removedIds: Set<string>): DiagramEdge[] {
  return diagram.edges.filter((edge) => !removedIds.has(edge.from) && !removedIds.has(edge.to));
}

/** to 是否已经能走回 from —— 用来阻止成环 */
export function reaches(diagram: Diagram, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of childIds(diagram, current)) {
      if (child === to) return true;
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return false;
}

/**
 * 给每个节点算一个「层」。
 *
 * 用最长路径松弛：没有任何入边的节点在第 0 层，其余节点比自己所有父节点都低一层。
 * 有环时松弛不会自然收敛，所以迭代次数上限卡在节点数 —— 保证一定能停下来。
 */
export function assignLayers(diagram: Diagram): Record<string, number> {
  const layer: Record<string, number> = {};
  for (const node of diagram.nodes) layer[node.id] = 0;

  for (let round = 0; round < diagram.nodes.length; round += 1) {
    let changed = false;
    for (const edge of diagram.edges) {
      if (layer[edge.from] === undefined || layer[edge.to] === undefined) continue;
      if (layer[edge.to] < layer[edge.from] + 1) {
        layer[edge.to] = layer[edge.from] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return layer;
}

/**
 * 把图压成给模型看的缩进文本。
 * 树形结构用缩进表达，跨枝的连线（多父节点）单独列在末尾。
 */
export function diagramToText(diagram: Diagram): string {
  const lines: string[] = [diagram.title ? `标题：${diagram.title}` : '（还没有标题）', '', '节点与连线：'];

  const outgoingMap = outgoing(diagram);
  const inDegrees = incoming(diagram);
  const roots = diagram.nodes.filter((node) => !(inDegrees.get(node.id)?.length));
  const visited = new Set<string>();
  /** 已经被缩进树「认领」过的父子边，末尾就不用再列一遍 */
  const treeEdges = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = findNode(diagram, id);
    if (!node) return;

    const parts = [`[${node.id}] ${node.label}`];
    if (node.detail) parts.push(`—— ${node.detail}`);
    if (node.group) parts.push(`(${node.group})`);
    lines.push(`${'  '.repeat(depth)}- ${parts.join(' ')}`);

    for (const edge of outgoingMap.get(id) ?? []) {
      treeEdges.add(`${edge.from}->${edge.to}`);
      walk(edge.to, depth + 1);
    }
  };

  roots.forEach((node) => walk(node.id, 0));
  // 环或者互相指的节点：上面走不到，兜底补一遍
  diagram.nodes.forEach((node) => walk(node.id, 0));

  const extra = diagram.edges.filter((edge) => !treeEdges.has(`${edge.from}->${edge.to}`));
  if (extra.length) {
    lines.push('', '额外的连线（不在上面的层级里）：');
    for (const edge of extra) {
      const label = edge.label ? `（${edge.label}）` : '';
      lines.push(`- [${edge.from}] -> [${edge.to}]${label}`);
    }
  }

  return lines.join('\n');
}

