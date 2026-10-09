import { useMemo } from 'react';
import Svg, { Circle, Defs, G, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';

import { groupColor } from '../constants';
import { useTheme } from '../hooks/useTheme';
import type { LayoutResult } from '../utils/layout';

interface DiagramCanvasProps {
  layout: LayoutResult;
  scale: number;
  selectedId: string | null;
}

const LABEL_SIZE = 14.5;
const LABEL_LINE = 18;
const LABEL_PER_LINE = 8;
const DETAIL_SIZE = 10.5;
const DETAIL_LINE = 13;
const DETAIL_PER_LINE = 11;

/** 点阵的格子边长（viewBox 单位，会跟着缩放一起变） */
const GRID = 22;
/** 左侧色条的宽度与上下留白 */
const BAR_WIDTH = 3;
const BAR_INSET = 6;
const BAR_VERTICAL = 11;
/** 文字整体右移一点，给色条让位，看起来才是居中 */
const TEXT_SHIFT = 3;

/**
 * SVG 的 Text 以「基线」定位，不是以「框」定位。
 * react-native-svg 在各端对 dominant-baseline 的支持并不一致（类型里也没有这个属性），
 * 所以干脆自己往下挪一点点，让文字看起来是垂直居中的。
 */
function baselineOffset(fontSize: number): number {
  return fontSize * 0.34;
}

/** SVG 的 Text 不会自己换行，只能按字数切开 */
function wrapText(text: string, perLine: number, maxLines: number): string[] {
  const chars = [...text];
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(''));
  }
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.slice(0, Math.max(1, perLine - 1))}…`;
  return kept;
}

/**
 * 把布局结果画出来。
 *
 * 只负责「画」：坐标怎么算是 layout.ts 的事，平移缩放是 DiagramViewport 的事。
 *
 * 视觉上做三件事让图不显得「干」：
 *   1. 底下铺一层点阵，空白处也有空间感（跟随图一起缩放）
 *   2. 方块做成卡片：深色底 + 极淡描边 + 左边缘的分组色条，而不是整圈彩边
 *   3. 选中时换成强调色底 + 一圈淡淡的光晕，一眼能认出「现在说的是它」
 */
export function DiagramCanvas({ layout, scale, selectedId }: DiagramCanvasProps) {
  const { colors } = useTheme();

  const width = Math.max(layout.width, 1) * scale;
  const height = Math.max(layout.height, 1) * scale;

  const edgeColor = useMemo(() => 'rgba(235, 235, 245, 0.20)', []);
  const dotColor = useMemo(() => 'rgba(235, 235, 245, 0.07)', []);
  const barTrack = useMemo(() => 'rgba(255, 255, 255, 0.06)', []);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
      {/* ---- 点阵底 ---- */}
      <Defs>
        <Pattern id="ns-dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <Circle cx={GRID / 2} cy={GRID / 2} r={1} fill={dotColor} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={layout.width} height={layout.height} fill="url(#ns-dots)" />

      {/* ---- 连线画在方块下面 ---- */}
      {layout.edges.map((edge) => (
        <G key={`${edge.from}->${edge.to}`}>
          <Path d={edge.path} stroke={edgeColor} strokeWidth={1.3} fill="none" strokeLinecap="round" />
          {edge.label ? (
            <SvgText
              x={edge.midX}
              y={edge.midY + baselineOffset(10)}
              fill={colors.textMuted}
              fontSize={10}
              textAnchor="middle"
            >
              {edge.label}
            </SvgText>
          ) : null}
        </G>
      ))}

      {/* ---- 方块 ---- */}
      {layout.nodes.map((node) => {
        const color = groupColor(node.group);
        const selected = node.id === selectedId;

        const left = node.cx - node.width / 2;
        const top = node.cy - node.height / 2;

        const labelLines = wrapText(node.label, LABEL_PER_LINE, 2);
        const detailLines = node.detail ? wrapText(node.detail, DETAIL_PER_LINE, 2) : [];

        const labelBlock = labelLines.length * LABEL_LINE;
        const detailBlock = detailLines.length * DETAIL_LINE;
        const gap = detailLines.length ? 4 : 0;
        const startY = node.cy - (labelBlock + gap + detailBlock) / 2;

        return (
          <G key={node.id}>
            {/* 选中时的光晕 */}
            {selected ? (
              <Rect
                x={left - 3}
                y={top - 3}
                width={node.width + 6}
                height={node.height + 6}
                rx={17}
                fill="none"
                stroke={colors.accent}
                strokeOpacity={0.28}
                strokeWidth={2}
              />
            ) : null}

            <Rect
              x={left}
              y={top}
              width={node.width}
              height={node.height}
              rx={14}
              fill={selected ? colors.accentSoft : colors.card}
              stroke={selected ? colors.accent : colors.border}
              strokeWidth={selected ? 1.6 : 1}
            />

            {/* 左边缘：先铺一条很淡的轨道，再盖上分组色 */}
            <Rect
              x={left + BAR_INSET}
              y={top + BAR_VERTICAL}
              width={BAR_WIDTH}
              height={Math.max(8, node.height - BAR_VERTICAL * 2)}
              rx={BAR_WIDTH / 2}
              fill={barTrack}
            />
            <Rect
              x={left + BAR_INSET}
              y={top + BAR_VERTICAL}
              width={BAR_WIDTH}
              height={Math.max(8, node.height - BAR_VERTICAL * 2)}
              rx={BAR_WIDTH / 2}
              fill={color}
              opacity={selected ? 1 : 0.9}
            />

            {labelLines.map((line, index) => (
              <SvgText
                key={`l${index}`}
                x={node.cx + TEXT_SHIFT}
                y={startY + index * LABEL_LINE + LABEL_LINE / 2 + baselineOffset(LABEL_SIZE)}
                fill={colors.text}
                fontSize={LABEL_SIZE}
                fontWeight="600"
                textAnchor="middle"
              >
                {line}
              </SvgText>
            ))}

            {detailLines.map((line, index) => (
              <SvgText
                key={`d${index}`}
                x={node.cx + TEXT_SHIFT}
                y={
                  startY +
                  labelBlock +
                  gap +
                  index * DETAIL_LINE +
                  DETAIL_LINE / 2 +
                  baselineOffset(DETAIL_SIZE)
                }
                fill={colors.textSub}
                fontSize={DETAIL_SIZE}
                textAnchor="middle"
              >
                {line}
              </SvgText>
            ))}
          </G>
        );
      })}
    </Svg>
  );
}
