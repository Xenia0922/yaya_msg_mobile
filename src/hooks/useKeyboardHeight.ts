import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform } from 'react-native';

/**
 * 键盘高度（px，含导航栏）。
 *
 * 背景：本项目 Android 侧 `edgeToEdgeEnabled: true`。edge-to-edge 下系统忽略
 * `windowSoftInputMode="adjustResize"`（窗口不随键盘缩放），因此聊天页必须**手动**
 * 把承载「消息列表 + 输入框」的容器底部抬起，才能实现「整页随键盘上移、最新消息一起
 * 顶上去」（像微信等原生聊天软件），而不是只把输入框单独顶起来。
 *
 * 用法：`const kb = useKeyboardHeight();` 然后给聊天页根容器 `paddingBottom: kb`。
 * iOS 用 willShow（跟手），Android 用 didShow（实际生效时机）。
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      setHeight(Math.max(0, Math.round(e?.endCoordinates?.height ?? 0)));
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export default useKeyboardHeight;
