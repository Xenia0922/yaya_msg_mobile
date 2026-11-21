import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardEvent, Platform } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';

export function useKeyboardHeight(enabled = true): number {
  const [height, setHeight] = useState(0);
  const kcHeightRef = useRef(0);
  const rnHeightRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      kcHeightRef.current = 0;
      rnHeightRef.current = 0;
      setHeight(0);
      return;
    }

    const syncHeight = () => {
      const next = Math.max(kcHeightRef.current, rnHeightRef.current);
      setHeight((prev) => (prev === next ? prev : next));
    };

    const subs: Array<{ remove: () => void }> = [];

    try {
      const kcWillShow = KeyboardEvents.addListener('keyboardWillShow', (e) => {
        const next = Math.max(0, Math.round(e?.height ?? 0));
        if (next > 0) {
          kcHeightRef.current = next;
          syncHeight();
        }
      });
      const kcDidShow = KeyboardEvents.addListener('keyboardDidShow', (e) => {
        kcHeightRef.current = Math.max(0, Math.round(e?.height ?? 0));
        syncHeight();
      });
      const kcWillHide = KeyboardEvents.addListener('keyboardWillHide', () => {
        kcHeightRef.current = 0;
        rnHeightRef.current = 0;
        setHeight(0);
      });
      const kcDidHide = KeyboardEvents.addListener('keyboardDidHide', () => {
        kcHeightRef.current = 0;
        rnHeightRef.current = 0;
        setHeight(0);
      });
      subs.push(kcWillShow, kcDidShow, kcWillHide, kcDidHide);
    } catch {}

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      rnHeightRef.current = Math.max(0, Math.round(e?.endCoordinates?.height ?? 0));
      syncHeight();
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      kcHeightRef.current = 0;
      rnHeightRef.current = 0;
      setHeight(0);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        kcHeightRef.current = 0;
        rnHeightRef.current = 0;
        setHeight(0);
      }
    });
    subs.push(show, hide, appState);

    return () => {
      subs.forEach((s) => {
        try {
          s.remove();
        } catch {}
      });
    };
  }, [enabled]);
  return height;
}

export default useKeyboardHeight;
