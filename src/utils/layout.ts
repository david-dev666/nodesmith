import type { Diagram } from '../types';
import { assignLayers, childIds, incoming } from './graph';

/**
 * 方块尺寸。
 * 带 detail 的方块要装下两行字，所以更高。宽度统一 ——
 * 宽度不一会让「父节点居中」的计算立刻变得很难看，收益却很小。
 */
export const NODE_WIDTH = 140;
export const NODE_HEIGHT = 52;
export const NODE_HEIGHT_WIDE = 70;

/** 横向间距（两个方块之间的空档） */
const H_GAP = 28;
/** 纵向间距（上下两层之间的空档） */
const V_GAP = 56;
/** 画布四周留白 */
const PADDING = 32;
/** 同一层里两个方块至少隔这么远，避免自底向上算出来的位置叠在一起 */
const MIN_SLOT_GAP = NODE_WIDTH + H_GAP;
/** 折线拐角处的圆角半径（会被竖段/横段长度进一步限制） */
const CORNER_RADIUS = 10;

export interface PlacedNode {
  id: string;
  label: string;
  detail?: string;
  group?: string;
  /** 方块中心坐标 */
  cx: number;
  cy: number;
  width: number;
  height: number;
  layer: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  label?: string;
  /** 正交折线的 SVG path，已包含起点 */
  path: string;
  /** 连线中点，用来摆线上文字 */
  midX: number;
  midY: number;
}

export interface LayoutResult {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  /** 从上到下一共多少层 */
  layerCount: number;
}

const EMPTY: LayoutResult = { nodes: [], edges: [], width: 0, height: 0, layerCount: 0 };

/**
 * 把一张图排成 PPT 里那种「组织架构图」。
 *
 * 两趟：
 *   1. 自底向上：叶子按从左到右占槽位，父节点落在自己子节点的正中间
 *   2. 同层从左到右推开，保证不重叠
 *
 * 然后每层的 y 由层号决定，连线一律走直角折线。
 */
export function layoutDiagram(diagram: Diagram): LayoutResult {
  if (!diagram.nodes.length) return EMPTY;

  const layers = assignLayers(diagram);
  const layerCount = Math.max(...Object.values(layers)) + 1;
  const parentsOf = incoming(diagram);

  /* ---- 1. 自底向上定横向槽位 ---- */
  const slot: Record<string, number> = {};
  let cursor = 0;

  const visit = (id: string, depth: number, seen: Set<string>): number => {
    if (slot[id] !== undefined) return slot[id];
    seen.add(id);

    // 只认「下一层」的子节点：既避开环，也避免把跨层连线当成父子关系
    const next = childIds(diagram, id).filter(
      (child) => layers[child] === depth + 1 && !seen.has(child),
    );

    if (!next.length) {
      slot[id] = cursor;
      cursor += 1;
      return slot[id];
    }

    const xs = next.map((child) => visit(child, depth + 1, seen));
    slot[id] = (xs[0] + xs[xs.length - 1]) / 2;
    return slot[id];
  };

  // 先从没有入边的节点开始，画出来最自然
  const roots = diagram.nodes.filter((node) => !(parentsOf.get(node.id)?.length));
  for (const node of roots) visit(node.id, layers[node.id], new Set());
  // 剩下的是环上的节点，或者只被环连着的节点
  for (const node of diagram.nodes) visit(node.id, layers[node.id], new Set());

  /* ---- 2. 同层从左到右推开 ---- */
  const order = [...diagram.nodes].sort((a, b) => (slot[a.id] ?? 0) - (slot[b.id] ?? 0));
  const lastCx = new Map<number, number>();
  const cx: Record<string, number> = {};

  for (const node of order) {
    const layer = layers[node.id];
    const ideal = PADDING + (slot[node.id] ?? 0) * MIN_SLOT_GAP + NODE_WIDTH / 2;
    const previous = lastCx.get(layer);
    const placed = previous === undefined ? ideal : Math.max(ideal, previous + MIN_SLOT_GAP);
    cx[node.id] = placed;
    lastCx.set(layer, placed);
  }

  /* ---- 3. 落成坐标 ---- */
  const nodes: PlacedNode[] = diagram.nodes.map((node) => {
    const height = node.detail ? NODE_HEIGHT_WIDE : NODE_HEIGHT;
    const layer = layers[node.id];
    return {
      id: node.id,
      label: node.label,
      detail: node.detail,
      group: node.group,
      cx: cx[node.id],
      cy: PADDING + layer * (NODE_HEIGHT_WIDE + V_GAP) + height / 2,
      width: NODE_WIDTH,
      height,
      layer,
    };
  });

  const placed = new Map(nodes.map((node) => [node.id, node]));

  const edges: PlacedEdge[] = [];
  for (const edge of diagram.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;

    const fx = from.cx;
    const fy = from.cy + from.height / 2;
    const tx = to.cx;
    const ty = to.cy - to.height / 2;

    let path: string;
    let midY: number;
    if (Math.abs(fx - tx) < 1) {
      path = `M ${fx} ${fy} L ${tx} ${ty}`;
      midY = (fy + ty) / 2;
    } else {
      /**
       * 还是「下去 → 横过去 → 再下到底」那套，只是拐角处加一小段圆角。
       * 半径要同时受限于竖段与横段的长度，否则小图上会鼓出一个奇怪的包。
       */
      midY = (fy + ty) / 2;
      const r = Math.max(0, Math.min(CORNER_RADIUS, (midY - fy) / 2, Math.abs(tx - fx) / 2));
      const dir = tx > fx ? 1 : -1;
      path = [
        `M ${fx} ${fy}`,
        `L ${fx} ${midY - r}`,
        r > 0 ? `Q ${fx} ${midY} ${fx + dir * r} ${midY}` : `L ${fx} ${midY}`,
        `L ${tx - dir * r} ${midY}`,
        r > 0 ? `Q ${tx} ${midY} ${tx} ${midY + r}` : `L ${tx} ${midY}`,
        `L ${tx} ${ty}`,
      ].join(' ');
    }

    edges.push({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      path,
      midX: (fx + tx) / 2,
      midY: midY - 2,
    });
  }

  const width = Math.max(...nodes.map((node) => node.cx + node.width / 2)) + PADDING;
  const height = Math.max(...nodes.map((node) => node.cy + node.height / 2)) + PADDING;

  return { nodes, edges, width, height, layerCount };
}
