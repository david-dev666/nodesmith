import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, type TabKey } from './src/components/TabBar';
import { useAiSettings } from './src/hooks/useAiSettings';
import { useChat } from './src/hooks/useChat';
import { useDiagrams } from './src/hooks/useDiagrams';
import { useKeyboardHeight } from './src/hooks/useKeyboardHeight';
import { ThemeProvider, useTheme } from './src/hooks/useTheme';
import { DiagramScreen } from './src/screens/DiagramScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

// 字体没就绪前先别撤掉启动屏，否则会闪一下系统字体
SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const [tab, setTab] = useState<TabKey>('diagram');

  const diagrams = useDiagrams();
  const ai = useAiSettings();
  const chat = useChat({ diagrams, ai });

  const ready = diagrams.diagramsReady && ai.aiReady && chat.chatReady;

  /**
   * 键盘挡住多少，页面底部就留多少。
   *
   * 这里不用 KeyboardAvoidingView：Android 走 edge-to-edge 之后窗口不再随键盘缩小，
   * 那套「把内容往上顶」的算法会算错，输入框照样被盖住。自己量与键盘等高的内边距，
   * 两个平台表现一致；键盘弹起时顺手把底部标签栏藏了，正好给它让位。
   */
  const bottomPad = keyboard > 0 ? keyboard : insets.bottom;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: bottomPad }]}>
      <StatusBar style="light" />
      {ready ? (
        <>
          {/**
           * 两个页面都留在树上，只切换显示。
           * 这样切回来时：输入了一半的句子、画布的视角、展开的对话、选中的方块都还在 ——
           * 去设置里看一眼 Key 再回来，不用从头把话再说一遍。
           */}
          <View style={styles.content}>
            <View style={[styles.page, tab !== 'diagram' && styles.hidden]}>
              <DiagramScreen
                diagrams={diagrams}
                chat={chat}
                keyboardHeight={keyboard}
                onOpenSettings={() => setTab('settings')}
              />
            </View>
            <View style={[styles.page, tab !== 'settings' && styles.hidden]}>
              <SettingsScreen diagrams={diagrams} ai={ai} chat={chat} />
            </View>
          </View>
          {keyboard > 0 ? null : <TabBar value={tab} onChange={setTab} />}
        </>
      ) : null}
    </View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require('./assets/fonts/Inter_400Regular.ttf'),
    Inter_500Medium: require('./assets/fonts/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('./assets/fonts/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('./assets/fonts/Inter_700Bold.ttf'),
  });

  // 字体加载失败也要放行，避免启动屏卡住
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <Shell />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  page: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  hidden: { display: 'none' },
});
