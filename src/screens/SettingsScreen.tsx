import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../hooks/useTheme';
import type { AiSettings } from '../hooks/useAiSettings';
import type { ChatStore } from '../hooks/useChat';
import type { DiagramsStore } from '../hooks/useDiagrams';
import { font, radius, space, type ThemeColors } from '../theme';
import { DEEPSEEK_MODELS, checkApiKey } from '../agent/chat';
import { exportBackup, pickBackup } from '../utils/backup';
import { formatRelative } from '../utils/date';
import { successFeedback, tapFeedback, warnFeedback } from '../utils/feedback';

interface SettingsScreenProps {
  diagrams: DiagramsStore;
  ai: AiSettings;
  chat: ChatStore;
}

export function SettingsScreen({ diagrams, ai, chat }: SettingsScreenProps) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => createStyles(colors, shadow), [colors, shadow]);

  const [keyVisible, setKeyVisible] = useState(false);
  const [keyDraft, setKeyDraft] = useState(ai.apiKey);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = diagrams.active;

  const saveKey = () => {
    ai.setApiKey(keyDraft);
    tapFeedback();
    Alert.alert('已保存', 'API Key 只存在这台手机上，不会上传到任何地方，也不会进代码仓库。');
  };

  const testKey = async () => {
    const key = keyDraft.trim();
    if (!key || testing) return;
    setTesting(true);
    try {
      await checkApiKey(key);
      ai.setApiKey(key);
      successFeedback();
      Alert.alert('连接正常', '这个 Key 可以用。');
    } catch (error) {
      warnFeedback();
      Alert.alert('连不上', error instanceof Error ? error.message : '请检查网络后再试');
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteDiagram = (id: string, title: string, count: number) => {
    Alert.alert(
      `删除「${title}」`,
      `这张图上的 ${count} 个方块会一起消失，无法撤销。确定吗？`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => diagrams.deleteDiagram(id) },
      ],
    );
  };

  const handleResetSession = () => {
    const diagram = diagrams.active;
    if (!diagram) return;
    Alert.alert(
      '清空对话记忆',
      `将清掉「${diagram.title}」的全部会话（每条会话的上下文和摘要）。图本身不会变。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '清空', style: 'destructive', onPress: () => chat.resetSession(diagram.id) },
      ],
    );
  };

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await exportBackup(diagrams.store, diagrams.history, chat.sessions);
      tapFeedback();
    } catch (error) {
      Alert.alert('导出失败', error instanceof Error ? error.message : '请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await pickBackup();
      if (!payload) return;

      const sessionCount = Object.values(payload.sessions ?? {}).reduce(
        (sum, list) => sum + list.length,
        0,
      );

      Alert.alert(
        '确认导入',
        `备份里有 ${payload.store.diagrams.length} 张图、${sessionCount} 份对话记忆。\n\n导入会整体替换当前所有图（现在有 ${diagrams.diagrams.length} 张），确定吗？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '导入',
            onPress: () => {
              diagrams.importStore(payload.store);
              chat.importSessions(payload.sessions ?? {});
              tapFeedback();
            },
          },
        ],
      );
    } catch (error) {
      Alert.alert('导入失败', error instanceof Error ? error.message : '文件可能已损坏或格式不对');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    Alert.alert(
      '重置为种子图',
      '将丢弃所有改动，回到 src/config/seed.local.ts 里的内容。编辑历史也会一起清空。',
      [
        { text: '取消', style: 'cancel' },
        { text: '重置', style: 'destructive', onPress: () => diagrams.resetToSeed() },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>设置</Text>

        {/* ---------- DeepSeek ---------- */}
        <Text style={styles.sectionTitle}>DeepSeek</Text>
        <View style={styles.list}>
          <View style={styles.field}>
            <View style={styles.fieldHeader}>
              <Text style={styles.rowLabel}>API Key</Text>
              <Pressable
                hitSlop={8}
                onPress={() => setKeyVisible((prev) => !prev)}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                <Text style={styles.linkText}>{keyVisible ? '隐藏' : '显示'}</Text>
              </Pressable>
            </View>
            <TextInput
              value={keyDraft}
              onChangeText={setKeyDraft}
              onBlur={() => ai.setApiKey(keyDraft)}
              placeholder="sk-..."
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!keyVisible}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={styles.input}
            />
            <View style={styles.fieldActions}>
              <Pressable
                onPress={saveKey}
                style={({ pressed }) => [
                  styles.smallBtn,
                  styles.smallBtnPrimary,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.smallBtnText, styles.smallBtnTextPrimary]}>保存</Text>
              </Pressable>
              <Pressable
                onPress={testKey}
                disabled={testing}
                style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]}
              >
                {testing ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={styles.smallBtnText}>测试连接</Text>
                )}
              </Pressable>
            </View>
          </View>

          {DEEPSEEK_MODELS.map((item) => (
            <Pressable
              key={item}
              onPress={() => ai.setModel(item)}
              style={({ pressed }) => [styles.row, styles.divider, pressed && styles.pressed]}
            >
              <View style={styles.rowTexts}>
                <Text style={styles.rowLabel}>{item}</Text>
                <Text style={styles.rowHint}>
                  {item === 'deepseek-chat' ? '快、便宜，够用' : '推理更强，更慢也更贵'}
                </Text>
              </View>
              {ai.model === item ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionHint}>
          Key 只保存在这台手机上（AsyncStorage），不会写进代码、不会进仓库、不会打包进 APK。
          除非你自己把 Key 填进 src/config/ai.local.ts 再编译，那种方式才会随包分发。
        </Text>

        {/* ---------- 我的图 ---------- */}
        <Text style={[styles.sectionTitle, styles.sectionSpaced]}>我的图</Text>
        <View style={styles.list}>
          {diagrams.diagrams.map((item, index) => {
            const isActive = item.id === active?.id;
            return (
              <View key={item.id} style={[styles.graphRow, index > 0 && styles.divider]}>
                <View
                  style={[
                    styles.graphDot,
                    { backgroundColor: isActive ? colors.accent : colors.line },
                  ]}
                />
                <TextInput
                  defaultValue={item.title}
                  onEndEditing={(event) => diagrams.renameDiagram(item.id, event.nativeEvent.text)}
                  style={styles.graphTitle}
                  maxLength={20}
                  returnKeyType="done"
                />
                <Text style={styles.graphCount}>{item.nodes.length} 块</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => handleDeleteDiagram(item.id, item.title, item.nodes.length)}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Text style={styles.graphDelete}>删除</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Text style={styles.sectionHint}>
          点标题可以直接改名字，改完点一下别处即可。删除一张图会连带它的所有内容。
        </Text>

        {/* ---------- 对话记忆 ---------- */}
        <Text style={[styles.sectionTitle, styles.sectionSpaced]}>对话记忆</Text>
        <View style={styles.list}>
          <View style={styles.row}>
            <View style={styles.rowTexts}>
              <Text style={styles.rowLabel}>当前这张图的对话</Text>
              <Text style={styles.rowHint}>
                {chat.threads.length} 条会话 · 当前这条 {chat.turnCount} 轮
                {chat.session.compactedCount
                  ? ` · 更早的 ${chat.session.compactedCount} 条已收进摘要`
                  : ''}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={handleResetSession}
            style={({ pressed }) => [styles.row, styles.divider, pressed && styles.pressed]}
          >
            <View style={styles.rowTexts}>
              <Text style={styles.rowLabel}>清空对话记忆</Text>
              <Text style={styles.rowHint}>让 agent 忘掉这张图的来龙去脉，图本身不受影响</Text>
            </View>
            <Text style={styles.rowArrow}>›</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionHint}>
          会话是 agent 理解「你之前想干什么」的全部依据：聊得越久它越顺，清空之后它会从零开始。
          一张图可以开多条会话，各聊各的，互不干扰。
        </Text>

        {/* ---------- 数据 ---------- */}
        <Text style={[styles.sectionTitle, styles.sectionSpaced]}>数据</Text>
        <View style={styles.list}>
          <Pressable
            onPress={handleExport}
            disabled={busy}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowTexts}>
              <Text style={styles.rowLabel}>导出备份</Text>
              <Text style={styles.rowHint}>
                {diagrams.diagrams.length} 张图 + 对话记忆 + 最近 10 次编辑记录
              </Text>
            </View>
            <Text style={styles.rowArrow}>›</Text>
          </Pressable>
          <Pressable
            onPress={handleImport}
            disabled={busy}
            style={({ pressed }) => [styles.row, styles.divider, pressed && styles.pressed]}
          >
            <View style={styles.rowTexts}>
              <Text style={styles.rowLabel}>从备份恢复</Text>
              <Text style={styles.rowHint}>选择之前导出的 JSON 文件</Text>
            </View>
            <Text style={styles.rowArrow}>›</Text>
          </Pressable>
          <View style={[styles.row, styles.divider]}>
            <Text style={styles.rowLabel}>当前这张图</Text>
            <Text style={styles.rowValue}>
              {diagrams.stats.nodeCount} 块 · {diagrams.stats.edgeCount} 线
            </Text>
          </View>
        </View>

        {/* ---------- 历史 ---------- */}
        <Text style={[styles.sectionTitle, styles.sectionSpaced]}>编辑历史</Text>
        {diagrams.history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>还没有改动过。去「结构图」页说一句话试试。</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {diagrams.history.map((version, index) => (
              <Pressable
                key={version.id}
                onPress={() =>
                  Alert.alert(
                    '回滚',
                    `将把「${version.diagramTitle}」还原到「${version.prompt}」之前，并丢弃之后的所有改动。`,
                    [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '回滚',
                        style: 'destructive',
                        onPress: () => diagrams.rollbackTo(version.id),
                      },
                    ],
                  )
                }
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.divider,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowTexts}>
                  <Text style={styles.rowLabel} numberOfLines={2}>
                    {version.prompt}
                  </Text>
                  <Text style={styles.rowHint}>
                    {version.diagramTitle} · {formatRelative(version.at)} · {version.opCount} 处改动
                  </Text>
                </View>
                <Text style={styles.rowArrow}>›</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          onPress={handleReset}
          style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}
        >
          <Text style={styles.dangerText}>重置为种子图</Text>
        </Pressable>

        <Text style={styles.footnote}>
          所有图、编辑历史、API Key 都只存在本机，卸载 App 会一并清除 —— 建议偶尔「导出备份」。
          仓库里只有一份公开的示例种子，你自己的图放在 src/config/seed.local.ts，不会进 git。
        </Text>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors, shadow: ViewStyle) {
  return StyleSheet.create({
    root: { flex: 1 },
    content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl },

    title: {
      fontFamily: font.bold,
      fontSize: 28,
      color: colors.text,
      letterSpacing: -1,
      marginBottom: space.xl,
    },

    sectionTitle: {
      fontFamily: font.semibold,
      fontSize: 12.5,
      color: colors.textSub,
      marginLeft: 2,
      marginBottom: space.md,
      letterSpacing: -0.1,
    },
    sectionSpaced: { marginTop: space.xl + space.xs },
    sectionHint: {
      fontFamily: font.regular,
      fontSize: 11.5,
      color: colors.textMuted,
      marginLeft: 2,
      marginTop: space.md,
      lineHeight: 17,
    },

    list: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      ...shadow,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      minHeight: 50,
      paddingHorizontal: space.lg,
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    pressed: { opacity: 0.55 },
    rowTexts: { flex: 1 },
    rowLabel: { fontFamily: font.regular, fontSize: 15, color: colors.text },
    rowHint: {
      fontFamily: font.regular,
      fontSize: 11.5,
      color: colors.textMuted,
      marginTop: 3,
      lineHeight: 16,
    },
    rowValue: {
      fontFamily: font.regular,
      fontSize: 13.5,
      color: colors.textSub,
      fontVariant: ['tabular-nums'],
    },
    rowArrow: { fontFamily: font.regular, fontSize: 18, color: colors.textMuted },
    check: { fontFamily: font.semibold, fontSize: 15, color: colors.accent },

    field: { paddingVertical: 14, paddingHorizontal: space.lg },
    fieldHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: space.sm,
    },
    linkText: { fontFamily: font.medium, fontSize: 12.5, color: colors.accent },
    input: {
      backgroundColor: colors.cardAlt,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      fontFamily: font.regular,
      fontSize: 14,
      color: colors.text,
    },
    fieldActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    smallBtn: {
      backgroundColor: colors.cardAlt,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: space.lg,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** 主要动作（保存）用浅紫底，次要动作用灰底 —— 一眼分得清该点哪个 */
    smallBtnPrimary: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    smallBtnText: { fontFamily: font.medium, fontSize: 13, color: colors.textSub },
    smallBtnTextPrimary: { color: colors.text },

    graphRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingVertical: 10,
      paddingHorizontal: space.lg,
      minHeight: 52,
    },
    graphDot: { width: 8, height: 8, borderRadius: 4 },
    graphTitle: {
      flex: 1,
      fontFamily: font.regular,
      fontSize: 15,
      color: colors.text,
      paddingVertical: 6,
    },
    graphCount: {
      fontFamily: font.regular,
      fontSize: 11.5,
      color: colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    graphDelete: { fontFamily: font.regular, fontSize: 12.5, color: colors.danger },

    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      paddingVertical: space.xxl,
      alignItems: 'center',
      ...shadow,
    },
    emptyText: {
      fontFamily: font.regular,
      fontSize: 13,
      color: colors.textMuted,
      paddingHorizontal: space.lg,
      textAlign: 'center',
      lineHeight: 19,
    },

    dangerBtn: {
      marginTop: space.xl,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      paddingVertical: 15,
      alignItems: 'center',
      ...shadow,
    },
    dangerText: { fontFamily: font.medium, fontSize: 14.5, color: colors.danger },

    footnote: {
      fontFamily: font.regular,
      fontSize: 11,
      color: colors.textMuted,
      lineHeight: 17,
      marginTop: space.xl,
      marginHorizontal: 2,
    },
  });
}
