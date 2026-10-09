import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { font, radius, space, type ThemeColors } from '../theme';

export type TabKey = 'diagram' | 'settings';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'diagram', label: '结构图', icon: '▦' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

interface TabBarProps {
  value: TabKey;
  onChange: (key: TabKey) => void;
}

/**
 * 底部导航。
 *
 * 只有两项，所以不做成通栏 —— 一颗悬浮药丸，让内容区看起来更大，
 * 也让「现在在哪一页」这件事只靠一块浅紫底就交代清楚。
 */
export function TabBar({ value, onChange }: TabBarProps) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => createStyles(colors, shadow), [colors, shadow]);

  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [
              styles.item,
              active && styles.itemActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.icon, { color: active ? colors.accent : colors.textMuted }]}>
              {tab.icon}
            </Text>
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors, shadow: ReturnType<typeof useTheme>['shadow']) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      marginHorizontal: space.lg,
      marginTop: space.sm,
      marginBottom: space.sm,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 5,
      ...shadow,
    },
    item: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: radius.pill,
      gap: 6,
    },
    itemActive: { backgroundColor: colors.accentSoft },
    pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
    icon: { fontSize: 14 },
    label: {
      fontFamily: font.medium,
      fontSize: 13.5,
      color: colors.textMuted,
      letterSpacing: -0.1,
    },
    labelActive: { fontFamily: font.semibold, color: colors.text },
  });
}
