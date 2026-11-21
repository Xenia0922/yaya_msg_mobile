import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fontFamily, usePalette } from '../theme';
import { useI18n } from '../i18n';

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
  text: string;
  style?: DialogButtonStyle;
  onPress?: () => void | Promise<void>;
}

interface DialogState {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let current: DialogState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  current = {
    title: String(title || ''),
    message: message ? String(message) : undefined,
    buttons: buttons && buttons.length ? buttons : [{ text: '好的', style: 'cancel' }],
  };
  notify();
}

export function hideDialog() {
  current = null;
  notify();
}

export function AppDialogHost() {
  const palette = usePalette();
  const { t } = useI18n();
  const [state, setState] = React.useState<DialogState | null>(current);

  React.useEffect(() => {
    const l = () => setState(current);
    listeners.add(l);

    if (current) setState(current);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const close = (btn?: DialogButton) => {
    hideDialog();
    if (btn?.onPress) {
      try {
        void Promise.resolve(btn.onPress()).catch(() => {});
      } catch {}
    }
  };

  const buttons = state?.buttons || [];

  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => close()}>
      <View style={styles.shade}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => close()}
        />
        {state ? (
          <View style={styles.center} pointerEvents="box-none">
            <View
              style={[
                styles.panel,
                {
                  backgroundColor:
                    palette.name === 'dark' ? 'rgba(30,30,34,0.98)' : 'rgba(255,255,255,0.98)',
                  borderColor: palette.hairline,
                },
              ]}
            >
              <View style={styles.body}>
                <Text style={[styles.title, { color: palette.label }]} numberOfLines={2}>
                  {state.title}
                </Text>
                {state.message ? (
                  <Text style={[styles.message, { color: palette.labelSecondary }]}>
                    {state.message}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.actions, { borderTopColor: palette.hairline }]}>
                {buttons.map((btn, i) => {
                  const danger = btn.style === 'destructive';
                  const cancel = btn.style === 'cancel';
                  return (
                    <TouchableOpacity
                      key={`${btn.text}-${i}`}
                      activeOpacity={0.75}
                      onPress={() => close(btn)}
                      style={[
                        styles.btn,
                        i > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: palette.hairline,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={btn.text}
                    >
                      <Text
                        style={[
                          styles.btnText,
                          {
                            color: danger
                              ? palette.danger
                              : cancel
                                ? palette.labelSecondary
                                : palette.tint,
                          },
                          !cancel && !danger && styles.btnTextStrong,
                        ]}
                        numberOfLines={1}
                      >
                        {btn.text || t('好的')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  panel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  title: { fontSize: 16, fontFamily: fontFamily.system, fontWeight: '700', textAlign: 'center' },
  message: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: fontFamily.system,
    lineHeight: 19,
    textAlign: 'center',
  },
  actions: { borderTopWidth: StyleSheet.hairlineWidth },
  btn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontFamily: fontFamily.system, fontWeight: '600' },
  btnTextStrong: { fontWeight: '700' },
});
