import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatPanel } from '../components/ChatPanel';
import { DiagramViewport, type ViewportHandle } from '../components/DiagramViewport';
import { FadeInView } from '../components/FadeInView';
import { Toast } from '../components/Toast';
import { groupColor } from '../constants';
import type { ChatStore } from '../hooks/useChat';
import type { DiagramsStore } from '../hooks/useDiagrams';
import { useTheme } from '../hooks/useTheme';
import { font, radius, space, type ThemeColors } from '../theme';
import { successFeedback, tapFeedback } from '../utils/feedback';
import { layoutDiagram, type LayoutResult } from '../utils/layout';

const EMPTY_LAYOUT: LayoutResult = { nodes: [], edges: [], width: 0, height: 0, layerCount: 0 };

/** 底部标签栏连同它的外边距大约占这么高（键盘弹起时它会被收起） */
const TAB_BAR_SPACE = 92;
/** 标题 + 图切换条 + 至少露一条画布的高度 */
const HEADER_SPACE = 210;
/** 轻提示停留多久 */
const TOAST_MS = 1700;

interface DiagramScreenProps {
  diagrams: DiagramsStore;
  chat: ChatStore;
  /** 键盘占掉的高度：对话面板要据此让位 */
  keyboardHeight: number;
  onOpenSettings: () => void;
}

/**
 * 一张图一屏：上面是图，下面是这场对话。
 *
 * 以前「看图」和「说话」是两个页面，来回跳；现在它们是一屏的两半 ——
 * 因为这两件事本来就是同时发生的：说一句 → 抬头看图改得对不对 → 再说一句。
 * 换图就是换整个上下文（图 + 会话一起换）。
 */
export function DiagramScreen({
  diagrams,
  chat,
  keyboardHeight,
  onOpenSettings,
}: DiagramScreenProps) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => createStyles(colors, shadow), [colors, shadow]);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const viewport = useRef<ViewportHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [childLabel, setChildLabel] = useState('');
  /** 带 id 是为了让同一句话连着出现两次时也能重新飘一次 */
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const active = diagrams.active;
  const layout = useMemo(() => (active ? layoutDiagram(active) : EMPTY_LAYOUT), [active]);
  const selected = active?.nodes.find((node) => node.id === selectedId) ?? null;

  const notify = (text: string) => setToast({ id: Date.now(), text });

  /** 点方块：顺手把它挪进可视区，免得详情卡正好盖在它身上 */
  const handleSelect = (id: string | null) => {
    setSelectedId(id);
    if (id) viewport.current?.focusNode(id);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * 对话面板最多占这么高。
   *
   * 只要面板不超预算，剩下的空间自然全归画布 —— 键盘弹起时预算一起缩，
   * 这样输入框永远在键盘上方，画布也还留着一条能看的缝。
   */
  const chromeHeight = keyboardHeight > 0 ? 0 : insets.bottom + TAB_BAR_SPACE;
  const available =
    windowHeight - insets.top - Math.max(insets.bottom, keyboardHeight) - chromeHeight;
  const panelMax = Math.max(170, available - HEADER_SPACE);

  const handleAddChild = () => {
    const label = childLabel.trim();
    if (!label || !selected) return;
    if (diagrams.addNode(label, selected.id)) {
      setChildLabel('');
      successFeedback();
      notify(`已在「${selected.label}」下面加了一个方块`);
    } else {
      Alert.alert('没加上', '这个名字不太行，换一个试试。');
    }
  };

  const handleRemoveSelected = () => {
    if (!selected) return;
    const node = selected;
    const kids = active?.edges.filter((edge) => edge.from === node.id).length ?? 0;
    Alert.alert(
      `删除「${node.label}」`,
      kids ? `它下面还连着 ${kids} 个方块，那些方块会保留，但和它的连线会断掉。` : '这个操作可以撤销。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            diagrams.removeNode(node.id);
            setSelectedId(null);
            notify('已删除，可用下面的「撤销上一步改动」找回');
          },
        },
      ],
    );
  };

  const handleCreate = () => {
    diagrams.createDiagram('未命名');
    setSelectedId(null);
    setDraft('');
    setExpanded(true);
    tapFeedback();
    notify('新建了一张空图');
  };

  const askAboutSelected = () => {
    if (!selected) return;
    setDraft(`围绕「${selected.label}」这个方块，`);
    setExpanded(true);
  };

  if (!active) return <View style={styles.root} />;

  const empty = active.nodes.length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTexts}>
          <Text style={styles.title} numberOfLines={1}>
            {active.title}
          </Text>
          <Text style={styles.meta}>
            {diagrams.stats.nodeCount} 个方块 · {layout.layerCount} 层 · 第 {chat.threadIndex + 1}{' '}
            条会话
          </Text>
        </View>

        <View style={styles.zoomBar}>
          <Pressable
            onPress={() => viewport.current?.zoomOut()}
            hitSlop={6}
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.pressed]}
          >
            <Text style={styles.zoomText}>−</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              viewport.current?.fit();
              tapFeedback();
            }}
            hitSlop={6}
            style={({ pressed }) => [styles.zoomValue, pressed && styles.pressed]}
          >
            <Text style={styles.zoomPercent}>{Math.round(zoom * 100)}%</Text>
          </Pressable>
          <Pressable
            onPress={() => viewport.current?.zoomIn()}
            hitSlop={6}
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.pressed]}
          >
            <Text style={styles.zoomText}>+</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipsBar}
        keyboardShouldPersistTaps="handled"
      >
        {diagrams.diagrams.map((item) => {
          const isActive = item.id === active.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                diagrams.selectDiagram(item.id);
                setSelectedId(null);
                tapFeedback();
              }}
              style={({ pressed }) => [
                styles.chip,
                isActive && styles.chipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={handleCreate}
          style={({ pressed }) => [styles.chip, styles.chipAdd, pressed && styles.pressed]}
        >
          <Text style={styles.chipAddText}>＋ 新图</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.canvasWrap}>
        <DiagramViewport
          ref={viewport}
          layout={layout}
          selectedId={selectedId}
          onSelect={handleSelect}
          resetKey={active.id}
          onScaleChange={setZoom}
        />

        {empty ? (
          <View style={styles.emptyOverlay} pointerEvents="box-none">
            <FadeInView style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>这张图还是空的</Text>
              <Text style={styles.emptyText}>
                在下面的输入框说一句，比如「画一下我的个人画像，分成职业、生活、价值观三条」。
              </Text>
              <Pressable
                onPress={() => {
                  setDraft('画一下我的个人画像，分成职业、生活、价值观三条');
                  setExpanded(true);
                  tapFeedback();
                }}
                style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}
              >
                <Text style={styles.emptyBtnText}>填一句试试</Text>
              </Pressable>
            </FadeInView>
          </View>
        ) : null}

        {selected ? (
          <FadeInView style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleRow}>
                <View style={[styles.groupDot, { backgroundColor: groupColor(selected.group) }]} />
                <Text style={styles.detailTitle} numberOfLines={1}>
                  {selected.label}
                </Text>
                {selected.group ? (
                  <Text style={[styles.groupTag, { color: groupColor(selected.group) }]}>
                    {selected.group}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => setSelectedId(null)}
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={styles.closeText}>收起</Text>
              </Pressable>
            </View>

            {selected.detail ? <Text style={styles.detailText}>{selected.detail}</Text> : null}

            <View style={styles.detailActions}>
              <TextInput
                value={childLabel}
                onChangeText={setChildLabel}
                placeholder="在它下面加一个方块…"
                placeholderTextColor={colors.textMuted}
                style={styles.detailInput}
                maxLength={20}
                onSubmitEditing={handleAddChild}
                returnKeyType="done"
              />
              <Pressable
                onPress={handleAddChild}
                disabled={!childLabel.trim()}
                style={({ pressed }) => [
                  styles.addChildBtn,
                  !childLabel.trim() && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.addChildText}>＋</Text>
              </Pressable>
            </View>

            <View style={styles.detailFooter}>
              <Pressable
                onPress={askAboutSelected}
                style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
              >
                <Text style={styles.ghostText}>让 AI 改它</Text>
              </Pressable>
              <Pressable
                onPress={handleRemoveSelected}
                style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
              >
                <Text style={styles.deleteText}>删除</Text>
              </Pressable>
            </View>
          </FadeInView>
        ) : null}
      </View>

      <ChatPanel
        diagrams={diagrams}
        chat={chat}
        draft={draft}
        onChangeDraft={setDraft}
        expanded={expanded}
        onToggleExpand={() => setExpanded((prev) => !prev)}
        onOpenSettings={onOpenSettings}
        maxHeight={panelMax}
        focusNodeId={selectedId}
        onNotify={notify}
      />

      <Toast key={toast?.id ?? 'none'} message={toast?.text ?? null} />
    </View>
  );
}

function createStyles(colors: ThemeColors, shadow: ViewStyle) {
  return StyleSheet.create({
    root: { flex: 1 },

    header: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      gap: space.md,
    },
    headerTexts: { flex: 1 },
    title: {
      fontFamily: font.bold,
      fontSize: 25,
      color: colors.text,
      letterSpacing: -0.9,
    },
    meta: {
      fontFamily: font.regular,
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 4,
      letterSpacing: 0.1,
    },

    zoomBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 3,
    },
    zoomBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    zoomText: { fontFamily: font.medium, fontSize: 18, color: colors.textSub },
    zoomValue: { paddingHorizontal: 5, paddingVertical: 5 },
    zoomPercent: {
      fontFamily: font.semibold,
      fontSize: 11.5,
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    pressed: { opacity: 0.6, transform: [{ scale: 0.97 }] },

    chipsBar: { flexGrow: 0, flexShrink: 0, marginTop: space.md },
    chips: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center' },
    chip: {
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: space.lg,
      paddingVertical: 8,
      maxWidth: 180,
    },
    chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    chipText: { fontFamily: font.medium, fontSize: 13, color: colors.textSub },
    chipTextActive: { color: colors.text, fontFamily: font.semibold },
    chipAdd: {
      backgroundColor: 'transparent',
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
    },
    chipAddText: { fontFamily: font.medium, fontSize: 13, color: colors.textSub },

    /** 画布做成一块卡片：和窗口底色分开，图的边界一眼看得见 */
    canvasWrap: {
      flex: 1,
      marginTop: space.sm,
      marginHorizontal: space.md,
      marginBottom: space.sm,
      minHeight: 96,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },

    emptyOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.xl,
    },
    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: space.xl,
      alignItems: 'center',
      gap: space.sm,
      maxWidth: 340,
    },
    emptyTitle: { fontFamily: font.semibold, fontSize: 15.5, color: colors.text },
    emptyText: {
      fontFamily: font.regular,
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
    },
    emptyBtn: {
      marginTop: space.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingHorizontal: space.xl,
      paddingVertical: 11,
    },
    emptyBtnText: { fontFamily: font.semibold, fontSize: 14, color: colors.onAccent },

    detailCard: {
      position: 'absolute',
      left: space.md,
      right: space.md,
      bottom: space.md,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: space.lg,
      ...shadow,
    },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
    },
    detailTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    groupDot: { width: 7, height: 7, borderRadius: 3.5 },
    detailTitle: {
      fontFamily: font.semibold,
      fontSize: 16,
      color: colors.text,
      flexShrink: 1,
    },
    groupTag: {
      fontFamily: font.medium,
      fontSize: 11,
      lineHeight: 15,
      borderRadius: radius.pill,
      backgroundColor: colors.cardAlt,
      paddingHorizontal: 8,
      overflow: 'hidden',
    },
    closeText: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted },
    detailText: {
      fontFamily: font.regular,
      fontSize: 13,
      color: colors.textSub,
      lineHeight: 19,
      marginTop: space.sm,
    },

    detailActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    detailInput: {
      flex: 1,
      backgroundColor: colors.cardAlt,
      borderRadius: radius.sm,
      paddingHorizontal: space.md,
      paddingVertical: 9,
      fontFamily: font.regular,
      fontSize: 14,
      color: colors.text,
    },
    addChildBtn: {
      width: 44,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addChildText: { fontFamily: font.semibold, fontSize: 18, color: colors.onAccent },
    disabled: { opacity: 0.35 },

    detailFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: space.sm,
    },
    ghostBtn: { paddingVertical: 8, paddingHorizontal: 2 },
    ghostText: { fontFamily: font.medium, fontSize: 13, color: colors.accent },
    deleteText: { fontFamily: font.medium, fontSize: 13, color: colors.danger },
  });
}
