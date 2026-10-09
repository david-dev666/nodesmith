import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { motion } from '../theme';
import type { LayoutResult } from '../utils/layout';
import { DiagramCanvas } from './DiagramCanvas';

/** 缩放档位：捏合是连续的，按钮走档位，两头都顺手 */
const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.7, 0.85, 1, 1.2, 1.5, 2, 2.5];
const MIN_SCALE = ZOOM_STEPS[0];
const MAX_SCALE = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** 手指移动超过这么多像素，就算「拖」而不是「点」 */
const TAP_SLOP = 6;
/** 内容离视口边界至少留这么多像素，免得图被拖出去找不回来 */
const KEEP_VISIBLE = 72;
/** 重排后内容上下左右的留白 */
const GUTTER = 20;

export interface ViewportHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset: () => void;
  /** 选中某个方块时，若它被挡住或在屏幕外，就平滑地把它挪进可视区 */
  focusNode: (nodeId: string) => void;
}

interface DiagramViewportProps {
  layout: LayoutResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 换图时重新定位：通常传 diagram.id */
  resetKey: string;
  onScaleChange?: (scale: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 画布的视口 —— 平移、缩放、点击命中都在这里。
 *
 * 为什么不用 ScrollView：内容小于屏幕时滚动条根本不给拖，嵌套两个方向还会
 * 在 Android 上互相抢手势，结果就是「动不了」。这里自己管偏移量：
 * 单指拖 = 平移（任意方向、可以拖到「图外面」的空白），双指 = 缩放，
 * 手指几乎没动就抬起 = 点方块。平移走 Animated，不触发重渲染。
 */
export const DiagramViewport = forwardRef<ViewportHandle, DiagramViewportProps>(
  function DiagramViewport({ layout, selectedId, onSelect, resetKey, onScaleChange }, ref) {
    const [scale, setScale] = useState(1);

    const sizeRef = useRef({ width: 0, height: 0 });
    const offsetRef = useRef({ x: 0, y: 0 });
    const scaleRef = useRef(1);
    const startRef = useRef({ x: 0, y: 0 });
    const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
    const movedRef = useRef(false);

    const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

    /** 手势回调是在创建时闭包住的，最新值一律走 ref */
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const selectedRef = useRef(selectedId);
    selectedRef.current = selectedId;
    const selectRef = useRef(onSelect);
    selectRef.current = onSelect;
    const scaleListener = useRef(onScaleChange);
    scaleListener.current = onScaleChange;

    const apply = useCallback(
      (x: number, y: number) => {
        offsetRef.current = { x, y };
        translate.setValue({ x, y });
      },
      [translate],
    );

    /** 把偏移收回「内容不会整个跑出视口」的范围 */
    const clampAxis = useCallback((value: number, viewport: number, content: number) => {
      const low = KEEP_VISIBLE - content;
      const high = viewport - KEEP_VISIBLE;
      return clamp(value, Math.min(low, high), Math.max(low, high));
    }, []);

    const applyClamped = useCallback(
      (x: number, y: number) => {
        const { width, height } = sizeRef.current;
        const contentW = layoutRef.current.width * scaleRef.current;
        const contentH = layoutRef.current.height * scaleRef.current;
        apply(clampAxis(x, width, contentW), clampAxis(y, height, contentH));
      },
      [apply, clampAxis],
    );

    /** 换个比例，并让视口中心这个点保持不动 */
    const scaleAround = useCallback(
      (next: number) => {
        const value = clamp(next, MIN_SCALE, MAX_SCALE);
        const previous = scaleRef.current;
        if (Math.abs(value - previous) < 0.001) return;

        const { width, height } = sizeRef.current;
        const ratio = value / previous;
        const offset = offsetRef.current;

        scaleRef.current = value;
        setScale(value);
        scaleListener.current?.(value);

        applyClamped(
          width / 2 - (width / 2 - offset.x) * ratio,
          height / 2 - (height / 2 - offset.y) * ratio,
        );
      },
      [applyClamped],
    );

    /** 复位到「刚好看得清」的位置：小图居中，大图从左上角起 */
    const resetView = useCallback(
      (nextScale: number) => {
        const { width, height } = sizeRef.current;
        const target = clamp(nextScale, MIN_SCALE, MAX_SCALE);

        scaleRef.current = target;
        setScale(target);
        scaleListener.current?.(target);

        const contentW = layoutRef.current.width * target;
        const contentH = layoutRef.current.height * target;

        apply(
          contentW + GUTTER * 2 < width ? (width - contentW) / 2 : GUTTER,
          contentH + GUTTER * 2 < height ? (height - contentH) / 2 : GUTTER,
        );
      },
      [apply],
    );

    const fit = useCallback(() => {
      const { width, height } = sizeRef.current;
      const content = layoutRef.current;
      if (!width || !height || !content.width || !content.height) return;

      const ratio = Math.min(
        (width - GUTTER * 2) / content.width,
        (height - GUTTER * 2) / content.height,
      );
      resetView(clamp(ratio, MIN_SCALE, 1.4));
    }, [resetView]);

    /** 平滑移动到某个偏移（拖动是跟手的，这里只用于「自动归位」） */
    const animateTo = useCallback(
      (x: number, y: number) => {
        offsetRef.current = { x, y };
        Animated.timing(translate, {
          toValue: { x, y },
          duration: motion.slow,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      },
      [translate],
    );

    /**
     * 把某个方块挪进可视区。
     *
     * 只在「它已经看不见了」的时候才动 —— 点一个已经看得清的方块，
     * 图不该自己跳一下。底部多留一截，是因为详情卡浮在那儿。
     */
    const focusNode = useCallback(
      (nodeId: string) => {
        const node = layoutRef.current.nodes.find((item) => item.id === nodeId);
        if (!node) return;

        const { width, height } = sizeRef.current;
        const current = scaleRef.current;
        const offset = offsetRef.current;

        const screenX = offset.x + node.cx * current;
        const screenY = offset.y + node.cy * current;
        const marginX = 36;
        const topLimit = 96;
        const bottomLimit = Math.max(topLimit + 40, height - Math.min(height * 0.34, 210));

        let x = offset.x;
        let y = offset.y;

        if (screenX < marginX) x = offset.x + (marginX - screenX);
        else if (screenX > width - marginX) x = offset.x - (screenX - (width - marginX));

        if (screenY < topLimit) y = offset.y + (topLimit - screenY);
        else if (screenY > bottomLimit) y = offset.y - (screenY - bottomLimit);

        if (x === offset.x && y === offset.y) return;
        animateTo(x, y);
      },
      [animateTo],
    );

    /** 点方块：把屏幕坐标换算回图坐标，再判断落在哪个框里 */
    const handleTap = useCallback((event: GestureResponderEvent) => {
      const { locationX, locationY } = event.nativeEvent;
      const offset = offsetRef.current;
      const current = scaleRef.current;
      const x = (locationX - offset.x) / current;
      const y = (locationY - offset.y) / current;

      const hit = layoutRef.current.nodes.find(
        (node) =>
          Math.abs(x - node.cx) <= node.width / 2 && Math.abs(y - node.cy) <= node.height / 2,
      );

      if (!hit) {
        selectRef.current(null);
        return;
      }
      selectRef.current(hit.id === selectedRef.current ? null : hit.id);
    }, []);

    const handlers = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: () => {
          /**
           * 手指一落下就打断可能正在跑的「自动归位」动画，
           * 并以它当下的位置作为起点 —— 否则拖起来会先跳一下。
           */
          startRef.current = { ...offsetRef.current };
          pinchRef.current = null;
          movedRef.current = false;

          translate.stopAnimation((value) => {
            const point = value as unknown as { x?: number; y?: number } | undefined;
            if (point && typeof point.x === 'number' && typeof point.y === 'number') {
              offsetRef.current = { x: point.x, y: point.y };
              startRef.current = { x: point.x, y: point.y };
            }
          });
        },

        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;

          // 两根手指：按距离比例缩放
          if (touches.length >= 2) {
            const [a, b] = touches;
            const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            if (!pinchRef.current) {
              pinchRef.current = { distance, scale: scaleRef.current };
              movedRef.current = true;
              return;
            }
            if (pinchRef.current.distance > 0) {
              movedRef.current = true;
              scaleAround((pinchRef.current.scale * distance) / pinchRef.current.distance);
            }
            return;
          }

          // 一根手指：平移
          if (Math.abs(gesture.dx) > TAP_SLOP || Math.abs(gesture.dy) > TAP_SLOP) {
            movedRef.current = true;
          }
          if (movedRef.current) {
            applyClamped(startRef.current.x + gesture.dx, startRef.current.y + gesture.dy);
          }
        },

        onPanResponderRelease: (event) => {
          pinchRef.current = null;
          if (!movedRef.current) handleTap(event);
          startRef.current = { ...offsetRef.current };
        },

        onPanResponderTerminate: () => {
          pinchRef.current = null;
          startRef.current = { ...offsetRef.current };
        },
      }),
    ).current;

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => {
          const next = ZOOM_STEPS.find((step) => step > scaleRef.current + 0.001);
          if (next) scaleAround(next);
        },
        zoomOut: () => {
          const next = [...ZOOM_STEPS].reverse().find((step) => step < scaleRef.current - 0.001);
          if (next) scaleAround(next);
        },
        fit,
        reset: () => resetView(1),
        focusNode,
      }),
      [fit, resetView, scaleAround, focusNode],
    );

    // 换一张图就重新定位，免得看到的是上一张图留下的偏移
    useEffect(() => {
      resetView(1);
    }, [resetKey, resetView]);

    const onLayout = useCallback(
      (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        const previous = sizeRef.current;
        const first = !previous.width || !previous.height;
        sizeRef.current = { width, height };

        if (first) {
          resetView(scaleRef.current);
          return;
        }

        /**
         * 对话面板展开/收起是逐帧改高度的，这里是逐帧回调 ——
         * 小变化先放过（免得动画期间反复重排），只有键盘弹起、旋转这种
         * 明显变化才把位置收回合法范围。
         */
        if (Math.abs(width - previous.width) < 28 && Math.abs(height - previous.height) < 28) {
          return;
        }
        applyClamped(offsetRef.current.x, offsetRef.current.y);
      },
      [applyClamped, resetView],
    );

    return (
      <View style={styles.root} onLayout={onLayout} {...handlers.panHandlers}>
        <Animated.View
          style={[
            styles.content,
            { transform: [{ translateX: translate.x }, { translateY: translate.y }] },
          ]}
        >
          <DiagramCanvas layout={layout} scale={scale} selectedId={selectedId} />
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  content: { position: 'absolute', left: 0, top: 0 },
});
