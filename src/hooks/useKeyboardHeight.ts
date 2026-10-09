import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * 键盘挡住屏幕底部多高（px）；没有键盘时是 0。
 *
 * 为什么不用 KeyboardAvoidingView：Expo 57 起 Android 默认 edge-to-edge，
 * 窗口不再随键盘缩小，KAV 那套「把内容往上顶」的假设就不成立了。
 * 自己读键盘高度、自己给底部留出空间，两端行为一致，也好排查。
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS 用 will* 事件：跟着键盘动画一起挪，不会先卡一下再弹上去
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
