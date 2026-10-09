import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { font, motion, radius, space } from '../theme';

/**
 * 一句轻提示（「已应用到图上」「已撤销」）。
 *
 * 不做成系统弹窗：那是「需要你决策」的语气；这种一秒钟的确认，
 * 飘一下就够，不该打断手上的动作。
 */
export function Toast({ message }: { message: string | null }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  /** 淡出期间还要留着上一句文案，所以自己记一份 */
  const [text, setText] = useState<string | null>(message);

  useEffect(() => {
    if (message) {
      setText(message);
      Animated.timing(anim, {
        toValue: 1,
        duration: motion.base,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(anim, { toValue: 0, duration: motion.fast, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) setText(null);
      },
    );
  }, [message, anim]);

  if (!text) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
          ],
        },
      ]}
    >
      <View style={[styles.pill, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <Text style={[styles.text, { color: colors.text }]}>{text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: space.md,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    paddingHorizontal: space.lg,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  text: { fontFamily: font.medium, fontSize: 13 },
});
