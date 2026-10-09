import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';

import type { ChatStore } from '../hooks/useChat';
import type { DiagramsStore } from '../hooks/useDiagrams';
import { useTheme } from '../hooks/useTheme';
import { font, motion, radius, space, type ThemeColors } from '../theme';
import type { AgentStep } from '../types';
import { tapFeedback, warnFeedback } from '../utils/feedback';
import { FadeInView } from './FadeInView';

const QUICK_PROMPTS = [
  '画一下我的个人画像，分成职业、生活、价值观三条',
  '把「职业」再展开一层，每层两三个就够',
  '给每个方块补一句小字说明',
  '同一层里挤在一起的合并一下',
];

/** 展开时最多占屏幕的多高 —— 再高就看不清图了 */
const MAX_PANEL_RATIO = 0.5;
/** 会话条 + 输入区的高度，用来反推消息列表能有多少空间 */
const CHROME_HEIGHT = 108;
/** 距底部这么近就算「贴着底」，新消息才自动滚下来 */
const STICKY_BOTTOM = 90;

interface ChatPanelProps {
  diagrams: DiagramsStore;
  chat: ChatStore;
  draft: string;
  onChangeDraft: (value: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenSettings: () => void;
  /** 面板高度上限（键盘弹起时会变小，免得把图挤没） */
  maxHeight: number;
  /** 画布上选中的方块：发给 agent 时带上它，「这个」才有指代 */
  focusNodeId: string | null;
  /** 一句话提示：应用、撤销这类「已经做了」的反馈 */
  onNotify: (message: string) => void;
}

/**
 * 贴在画布下面的对话区。
 *
 * 它和画布是同一屏的两半：上面看结果，下面说话。
 * 会话按图分开 —— 换一张图就是换一条主线，所以这里不显示「当前是哪张图」，
 * 只显示这张图下有几条会话、现在在哪条。
 */
export function ChatPanel({
  diagrams,
  chat,
  draft,
  onChangeDraft,
  expanded,
  onToggleExpand,
  onOpenSettings,
  maxHeight,
  focusNodeId,
  onNotify,
}: ChatPanelProps) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => createStyles(colors, shadow), [colors, shadow]);
  const { height: windowHeight } = useWindowDimensions();

  const listRef = useRef<ScrollView>(null);
  const [focused, setFocused] = useState(false);
  /** 用户翻到上面看历史时，别硬把他拽回底部 */
  const stickToBottom = useRef(true);

  const { turns, proposals, running, liveSteps, error, threads, threadIndex } = chat;

  /** 消息列表的可视高度：展开/收起都做成平滑过渡，而不是「啪」一下 */
  const listHeight = Math.max(60, Math.min(Math.round(windowHeight * MAX_PANEL_RATIO), maxHeight) - CHROME_HEIGHT);
  const listAnim = useRef(new Animated.Value(expanded ? listHeight : 0)).current;

  useEffect(() => {
    Animated.timing(listAnim, {
      toValue: expanded ? listHeight : 0,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, listHeight, listAnim]);

  const send = () => {
    const text = draft.trim();
    if (!text || running) return;
    onChangeDraft('');
    tapFeedback();
    stickToBottom.current = true;
    void chat.send(text, focusNodeId);
  };

  const confirmDeleteThread = (index: number) => {
    if (threads.length <= 1) return;
    warnFeedback();
    Alert.alert('删除这条会话', '只删对话记录，图不受影响。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          chat.deleteThread(index);
          onNotify('已删除这条会话');
        },
      },
    ]);
  };

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    stickToBottom.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - STICKY_BOTTOM;
  }, []);

  return (
    <View style={styles.panel}>
      {/* ---- 会话条：一张图下的多条会话 ---- */}
      <View style={styles.threadBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.threadChips}
          keyboardShouldPersistTaps="handled"
        >
          {threads.map((thread, index) => {
            const isActive = index === threadIndex;
            return (
              <Pressable
                key={thread.id}
                onPress={() => {
                  chat.selectThread(index);
                  tapFeedback();
                }}
                onLongPress={() => confirmDeleteThread(index)}
                style={({ pressed }) => [
                  styles.threadChip,
                  isActive && styles.threadChipActive,
                  pressed && styles.pressSoft,
                ]}
              >
                <Text
                  style={[styles.threadText, isActive && styles.threadTextActive]}
                  numberOfLines={1}
                >
                  {thread.title ?? `新对话 ${index + 1}`}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => {
              chat.newThread();
              stickToBottom.current = true;
              tapFeedback();
            }}
            style={({ pressed }) => [styles.threadChip, styles.threadAdd, pressed && styles.pressSoft]}
          >
            <Text style={styles.threadAddText}>＋ 新对话</Text>
          </Pressable>
        </ScrollView>

        <Pressable
          onPress={onToggleExpand}
          hitSlop={8}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressSoft]}
        >
          <Text style={styles.toggleText}>{expanded ? '收起' : '展开'}</Text>
          <Text style={styles.toggleChevron}>{expanded ? '⌄' : '⌃'}</Text>
        </Pressable>
      </View>

      {/* ---- 消息流 ---- */}
      <Animated.View style={[styles.listWrap, { height: listAnim }]}>
        <ScrollView
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          scrollEventThrottle={16}
          onScroll={onScroll}
          onContentSizeChange={() => {
            if (stickToBottom.current) listRef.current?.scrollToEnd({ animated: true });
          }}
        >
          {turns.length === 0 ? (
            <FadeInView>
              <View style={styles.intro}>
                <Text style={styles.introTitle}>这张图还没有对话，试试这样说</Text>
                {QUICK_PROMPTS.map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => onChangeDraft(item)}
                    style={({ pressed }) => [styles.chipRow, pressed && styles.pressSoft]}
                  >
                    <Text style={styles.chipText}>{item}</Text>
                    <Text style={styles.chipArrow}>›</Text>
                  </Pressable>
                ))}
              </View>
            </FadeInView>
          ) : null}

          {turns.map((turn) => {
            const proposal = proposals[turn.id];
            return (
              <FadeInView key={turn.id}>
                <View style={styles.userBubbleWrap}>
                  <View style={styles.userBubble}>
                    <Text style={styles.userText}>{turn.prompt}</Text>
                  </View>
                </View>

                <View style={styles.aiCard}>
                  {turn.steps.length ? <StepList steps={turn.steps} styles={styles} /> : null}

                  {turn.reply ? <Text style={styles.aiText}>{turn.reply}</Text> : null}

                  {proposal ? (
                    <View style={styles.proposal}>
                      <Text style={styles.proposalLabel}>这次动了</Text>
                      <Text style={styles.proposalDiff}>{proposal.diff.summary}</Text>
                      <View style={styles.actions}>
                        <Pressable
                          onPress={() => {
                            chat.applyTurn(turn.id);
                            onNotify('已应用到图上');
                          }}
                          style={({ pressed }) => [styles.applyBtn, pressed && styles.pressSoft]}
                        >
                          <Text style={styles.applyText}>应用到图上</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            chat.discardTurn(turn.id);
                            onNotify('已丢弃这次改动');
                          }}
                          style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressSoft]}
                        >
                          <Text style={styles.ghostText}>丢弃</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {turn.applied ? (
                    <View style={styles.appliedRow}>
                      <View style={styles.appliedDot} />
                      <Text style={styles.appliedHint}>已应用到图上</Text>
                    </View>
                  ) : null}
                </View>
              </FadeInView>
            );
          })}

          {running ? (
            <FadeInView>
              <View style={styles.aiCard}>
                <StepList steps={liveSteps} styles={styles} pending />
              </View>
            </FadeInView>
          ) : null}

          {error ? (
            <FadeInView>
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
                <View style={styles.actions}>
                  <Pressable
                    onPress={onOpenSettings}
                    style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressSoft]}
                  >
                    <Text style={styles.ghostText}>去设置</Text>
                  </Pressable>
                  <Pressable
                    onPress={chat.clearError}
                    style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressSoft]}
                  >
                    <Text style={styles.ghostText}>知道了</Text>
                  </Pressable>
                </View>
              </View>
            </FadeInView>
          ) : null}

          {diagrams.canUndo && !running ? (
            <Pressable
              onPress={() => {
                diagrams.undo();
                warnFeedback();
                onNotify('已撤销上一步');
              }}
              style={({ pressed }) => [styles.undoRow, pressed && styles.pressSoft]}
            >
              <Text style={styles.undoText}>撤销上一步改动</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </Animated.View>

      {/* ---- 输入区 ---- */}
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          onFocus={() => {
            setFocused(true);
            if (!expanded) onToggleExpand();
          }}
          onBlur={() => setFocused(false)}
          placeholder="说说想怎么改这张图…"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, focused && styles.inputFocused]}
          multiline
          maxLength={600}
          editable={!running}
        />
        <Pressable
          onPress={send}
          disabled={running || !draft.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            !draft.trim() && !running && styles.sendIdle,
            pressed && draft.trim() && styles.pressSoft,
          ]}
        >
          {running ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={[styles.sendText, !draft.trim() && styles.sendTextIdle]}>发送</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** agent 干了什么 —— 每一步都摊开给用户看，而不是只给一个结论 */
function StepList({
  steps,
  styles,
  pending,
}: {
  steps: AgentStep[];
  styles: ReturnType<typeof createStyles>;
  pending?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.stepList}>
      {steps.map((step, index) => (
        <View key={`${step.name}-${index}`} style={styles.stepRow}>
          <View
            style={[
              styles.stepDot,
              { backgroundColor: step.ok ? colors.accent : colors.danger },
            ]}
          />
          <Text style={[styles.stepText, !step.ok && styles.stepTextBad]} numberOfLines={2}>
            {step.label}
          </Text>
        </View>
      ))}

      {pending ? (
        <View style={styles.stepRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.stepPending}>
            {steps.length ? '继续处理…' : '正在读这张图…'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors, shadow: ViewStyle) {
  return StyleSheet.create({
    panel: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
      backgroundColor: colors.bg,
    },

    threadBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: space.lg,
      paddingRight: space.md,
      paddingTop: space.sm,
      paddingBottom: space.sm,
      gap: space.sm,
    },
    threadChips: { gap: space.sm, alignItems: 'center' },
    threadChip: {
      maxWidth: 150,
      paddingHorizontal: space.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    threadChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    threadText: { fontFamily: font.medium, fontSize: 12.5, color: colors.textSub },
    threadTextActive: { color: colors.text, fontFamily: font.semibold },
    threadAdd: {
      backgroundColor: 'transparent',
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
    },
    threadAddText: { fontFamily: font.medium, fontSize: 12.5, color: colors.textSub },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: space.sm, paddingVertical: 6 },
    toggleText: { fontFamily: font.medium, fontSize: 12.5, color: colors.textSub },
    toggleChevron: { fontFamily: font.regular, fontSize: 12, color: colors.textMuted },
    pressSoft: { opacity: 0.72, transform: [{ scale: 0.97 }] },

    listWrap: { overflow: 'hidden' },
    list: { flex: 1 },
    listContent: { paddingHorizontal: space.lg, paddingBottom: space.lg },

    intro: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      overflow: 'hidden',
      ...shadow,
    },
    introTitle: {
      fontFamily: font.semibold,
      fontSize: 12.5,
      color: colors.textSub,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.sm,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: space.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    chipText: { flex: 1, fontFamily: font.regular, fontSize: 13.5, color: colors.text },
    chipArrow: { fontFamily: font.regular, fontSize: 18, color: colors.textMuted },

    userBubbleWrap: { alignItems: 'flex-end', marginBottom: space.md },
    userBubble: {
      maxWidth: '86%',
      backgroundColor: colors.accent,
      borderRadius: radius.lg,
      borderBottomRightRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: space.lg,
    },
    userText: { fontFamily: font.regular, fontSize: 14, color: colors.onAccent, lineHeight: 20 },

    aiCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderTopLeftRadius: 6,
      padding: space.lg,
      marginBottom: space.md,
      ...shadow,
    },
    aiText: { fontFamily: font.regular, fontSize: 14, color: colors.text, lineHeight: 21 },

    stepList: { gap: 8, marginBottom: space.md },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    stepDot: { width: 5, height: 5, borderRadius: 2.5 },
    stepText: {
      flex: 1,
      fontFamily: font.regular,
      fontSize: 12.5,
      color: colors.textSub,
      lineHeight: 17,
    },
    stepTextBad: { color: colors.danger },
    stepPending: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted },

    proposal: {
      marginTop: space.md,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: colors.cardAlt,
      gap: 4,
    },
    proposalLabel: { fontFamily: font.medium, fontSize: 11.5, color: colors.textMuted },
    proposalDiff: { fontFamily: font.semibold, fontSize: 13.5, color: colors.text },

    actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
    applyBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: 10,
      paddingHorizontal: space.lg,
    },
    applyText: { fontFamily: font.semibold, fontSize: 13.5, color: colors.onAccent },
    ghostBtn: { paddingVertical: 10, paddingHorizontal: space.md },
    ghostText: { fontFamily: font.regular, fontSize: 13.5, color: colors.textSub },

    appliedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
    appliedDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent },
    appliedHint: { fontFamily: font.regular, fontSize: 11.5, color: colors.textMuted },

    errorCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 69, 58, 0.35)',
      padding: space.lg,
      marginBottom: space.md,
    },
    errorText: { fontFamily: font.regular, fontSize: 13.5, color: colors.danger, lineHeight: 20 },

    undoRow: { alignItems: 'center', paddingVertical: 12 },
    undoText: { fontFamily: font.regular, fontSize: 13, color: colors.textSub },

    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 108,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: space.lg,
      paddingTop: 12,
      paddingBottom: 12,
      fontFamily: font.regular,
      fontSize: 14.5,
      color: colors.text,
    },
    inputFocused: { borderColor: colors.accent, backgroundColor: colors.cardAlt },
    sendBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      minWidth: 66,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendIdle: { backgroundColor: colors.accentSoft },
    sendText: { fontFamily: font.semibold, fontSize: 14, color: colors.onAccent },
    sendTextIdle: { color: colors.textMuted },
  });
}
