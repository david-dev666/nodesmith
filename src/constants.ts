/**
 * 分组色板。
 * 节点可以带一个 group（职业、兴趣、价值观……），同组共用一个颜色，
 * 图上看过去就是一片一片的，比给每个节点单独配色清楚得多。
 */
export const GROUP_COLORS = [
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#F97316',
  '#22C55E',
  '#14B8A6',
  '#F59E0B',
  '#0EA5E9',
  '#EF4444',
  '#6366F1',
  '#84CC16',
  '#A855F7',
];

/** 没分组时的默认色 */
export const DEFAULT_NODE_COLOR = '#8B5CF6';

/** 把分组名稳定地映射到一个颜色：同一个名字永远同一个色，重启也不会变 */
export function groupColor(group?: string): string {
  if (!group) return DEFAULT_NODE_COLOR;
  let hash = 0;
  for (let i = 0; i < group.length; i += 1) {
    hash = (hash * 31 + group.charCodeAt(i)) % 99991;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}


