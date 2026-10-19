/**
 * AppDialog · 全局自绘确认框（替代原生 Alert）
 *
 * 为什么不用 Alert：Android 原生 Alert 样式割裂（系统字体/直角/蓝字按钮），
 * 与液态玻璃 UI 完全不搭；且原生 Alert 在部分 ROM 上只显示前 3 个按钮。
 *
 * 用法（签名与 Alert.alert 兼容，方便替换）：
 *   showDialog('删除消息', '撤回并删除这条你发送的消息？', [
 *     { text: '取消', style: 'cancel' },
 *     { text: '删除', style: 'destructive', onPress: () => {...} },
 *   ])
 *
 * 宿主：<AppDialogHost /> 挂在导航根节点一次即可（自动浮在所有页面之上）。
 */
import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePalette } from '../theme';
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

/** 打开对话框（签名与 Alert.alert 一致：title, message?, buttons?） */
export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  current = {
    title: String(title || ''),
    message: message ? String(message) : undefined,
    buttons: buttons && buttons.length ? buttons : [{ text: '好的', style: 'cancel' }],
  };
  notify();
}

/** 关闭当前对话框（不触发任何按钮回调） */
export function hideDialog() {
  current = null;
  notify();
}

/** 必须在导航根节点挂一次 */
export function AppDialogHost() {
  const palette = usePalette();
  const { t } = useI18n();
  const [state, setState] = React.useState<DialogState | null>(current);

  React.useEffect(() => {
    const l = () => setState(current);
    listeners.add(l);
    // 挂载前若已有待显示内容，补一次
    if (current) setState(current);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const close = (btn?: DialogButton) => {
    hideDialog();
    if (btn?.onPress) {
      try {
        void Promise.resolve(btn.onPress());
      } catch {
        /* 回调异常不影响关闭 */
      }
    }
  };

  const buttons = state?.buttons || [];

  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => close()}>
      <View style={styles.shade}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => close()} />
        {state ? (
          <View style={styles.center} pointerEvents="box-none">
            {/* 实底面板：Modal 是独立窗口，BlurView 取不到背后的模糊目标，玻璃会渲染成透明/闪烁 */}
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: palette.name === 'dark' ? 'rgba(30,30,34,0.98)' : 'rgba(255,255,255,0.98)',
                  borderColor: palette.hairline,
                },
              ]}
            >
              <View style={styles.body}>
                <Text style={[styles.title, { color: palette.label }]} numberOfLines={2}>
                  {state.title}
                </Text>
                {state.message ? (
                  <Text style={[styles.message, { color: palette.labelSecondary }]}>{state.message}</Text>
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
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
                      ]}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.btnText,
                          { color: danger ? palette.danger : cancel ? palette.labelSecondary : palette.tint },
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
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' },
  center: { width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  panel: { width: '100%', maxWidth: 360, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  title: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  message: { marginTop: 8, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  actions: { borderTopWidth: StyleSheet.hairlineWidth },
  btn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
  btnTextStrong: { fontWeight: '800' },
});
