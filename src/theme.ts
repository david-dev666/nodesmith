import { StyleSheet, type ViewStyle } from 'react-native';

/**
 * 语义色板 —— App 只提供深色一套。
 *
 * 深色界面最容易犯的错是「一片纯黑 + 一样亮的灰」，层次全丢了。
 * 所以这里把「底」和「面」拆成三层：bg（最底）→ surface（画布、次级容器）
 * → card / cardAlt（卡片、内嵌块），每一层只比上一层亮一点点。
 * 分隔一律靠 hairline 描边，不靠阴影 —— 深色下阴影本来就看不见。
 */
export interface ThemeColors {
  bg: string;
  /** 比 bg 略亮的底色：画布、次级容器 */
  surface: string;
  card: string;
  cardAlt: string;
  text: string;
  textSub: string;
  textMuted: string;
  /** 分隔线（列表行、栏位之间） */
  line: string;
  /** 卡片描边 */
  border: string;
  /** 需要被强调的描边（聚焦、按下） */
  borderStrong: string;
  overlay: string;
  danger: string;
  /** 强调色：选中态、主按钮 */
  accent: string;
  /** 强调色的浅底：选中项背景、标签 */
  accentSoft: string;
  accentPressed: string;
  /** 强调色上的文字 */
  onAccent: string;
}

export const appColors: ThemeColors = {
  bg: '#08080A',
  surface: '#101014',
  card: '#17171C',
  cardAlt: '#201F26',
  text: '#F5F5F7',
  textSub: 'rgba(235, 235, 245, 0.62)',
  textMuted: 'rgba(235, 235, 245, 0.34)',
  line: 'rgba(84, 84, 88, 0.50)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',
  overlay: 'rgba(0, 0, 0, 0.60)',
  danger: '#FF453A',
  accent: '#8B5CF6',
  accentSoft: 'rgba(139, 92, 246, 0.16)',
  accentPressed: '#7A4DE0',
  onAccent: '#FFFFFF',
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/**
 * Apple 风格的字体栈。
 * Inter 是 SF Pro 最接近的开源替代，中文会自动回落到系统字体。
 */
export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** 动效节奏：全站共用三档，快的不拖沓、慢的不突兀 */
export const motion = {
  /** 按压、颜色变化 */
  fast: 140,
  /** 进场、展开 */
  base: 240,
  /** 较大的位移 */
  slow: 340,
} as const;

/** 卡片描边（深色下的分层方式；阴影在深色里几乎看不见，所以靠描边分层） */
export const cardShadow: ViewStyle = {
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: appColors.border,
};
