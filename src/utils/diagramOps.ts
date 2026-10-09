import type { Diagram, DiagramOp } from '../types';
import { childIds, cloneDiagram, edgesWithout, findNode, newId, reaches } from './graph';

export interface ApplyResult {
  diagram: Diagram;
  applied: number;
  skipped: number;
}

/**
 * 把 AI 给出的操作列表应用到图上。
 *
 * 任何一条非法操作（节点不存在、会连成环、重复的边……）都会被跳过而不是抛错 ——
 * 模型偶尔会编 id，不能让一次幻觉把整张图带崩。
 */
export function applyOps(diagram: Diagram, ops: DiagramOp[]): ApplyResult {
  const next = cloneDiagram(diagram);
  let applied = 0;
  let skipped = 0;

  for (const op of ops) {
    if (applyOne(next, op)) applied += 1;
    else skipped += 1;
  }

  if (applied > 0) next.updatedAt = Date.now();
  return { diagram: next, applied, skipped };
}

function hasEdge(diagram: Diagram, from: string, to: string): boolean {
  return diagram.edges.some((edge) => edge.from === from && edge.to === to);
}

function applyOne(diagram: Diagram, op: DiagramOp): boolean {
  if (op.op === 'title') {
    const title = op.title?.trim();
    if (!title) return false;
    diagram.title = title;
    return true;
  }

  if (op.op === 'add') {
    const label = op.label?.trim();
    if (!label) return false;

    // 指定了父节点就必须真实存在，否则这条操作作废
    const parentId = op.parentId?.trim();
    if (parentId && !findNode(diagram, parentId)) return false;

    const id = newId();
    diagram.nodes.push({
      id,
      label,
      detail: op.detail?.trim() || undefined,
      group: op.group?.trim() || undefined,
    });

    if (parentId && !hasEdge(diagram, parentId, id)) {
      diagram.edges.push({ from: parentId, to: id });
    }
    return true;
  }

  if (op.op === 'update') {
    const label = op.label?.trim();
    const detail = op.detail?.trim();
    const group = op.group?.trim();
    if (!label && detail === undefined && group === undefined) return false;

    const node = findNode(diagram, op.id);
    if (!node) return false;

    if (label) node.label = label;
    if (detail !== undefined) node.detail = detail || undefined;
    if (group !== undefined) node.group = group || undefined;
    return true;
  }

  if (op.op === 'remove') {
    if (!findNode(diagram, op.id)) return false;
    diagram.nodes = diagram.nodes.filter((node) => node.id !== op.id);
    diagram.edges = edgesWithout(diagram, new Set([op.id]));
    return true;
  }

  if (op.op === 'link') {
    const from = op.from?.trim();
    const to = op.to?.trim();
    if (!from || !to || from === to) return false;
    if (!findNode(diagram, from) || !findNode(diagram, to)) return false;
    if (hasEdge(diagram, from, to)) return false;
    // to 已经能走回 from 的话，再加这条边就成环了
    if (reaches(diagram, to, from)) return false;

    diagram.edges.push({ from, to, label: op.label?.trim() || undefined });
    return true;
  }

  if (op.op === 'unlink') {
    const before = diagram.edges.length;
    diagram.edges = diagram.edges.filter(
      (edge) => !(edge.from === op.from && edge.to === op.to),
    );
    return diagram.edges.length < before;
  }

  // move：摘掉所有指向它的旧边，挂到新父节点下面
  if (!findNode(diagram, op.id)) return false;
  const parentId = op.parentId?.trim();
  if (!parentId || parentId === op.id) return false;
  if (!findNode(diagram, parentId)) return false;
  // 新父节点如果本来就在它下面，这次移动会成环
  if (childIds(diagram, op.id).includes(parentId) || reaches(diagram, op.id, parentId)) {
    return false;
  }

  diagram.edges = diagram.edges.filter((edge) => edge.to !== op.id);
  diagram.edges.push({ from: parentId, to: op.id });
  return true;
}


