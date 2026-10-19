import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import { usePalette, radiiAlias } from '../theme';
import { APP_VERSION } from '../constants';
import {
  cancelApkDownload,
  canInstallApk,
  downloadApk,
  getDeviceAbi,
  installDownloadedApk,
  onApkProgress,
  openInstallPermissionSettings,
} from '../native/ApkUpdater';
import { buildApkAsset, findSelfHostedUrl } from '../utils/appUpdate';

type Phase = 'checking' | 'ready' | 'perm' | 'downloading' | 'installing' | 'error';

/**
 * 应用内更新弹窗：下载对应 ABI 的 APK → 拉起系统安装器。
 *
 * 流程上的两个坑（都在这里兜住）：
 * 1. Android 8+ 安装 APK 需要「安装未知应用」授权。未授权时先跳系统设置，
 *    回到 App 后用 AppState 复查权限，再继续安装（**不重新下载 66MB**）。
 * 2. 下载失败（GitHub 404 / 网络中断）给出重试与「打开下载页」两条退路。
 */
export default function UpdateInstaller({
  visible,
  version,
  onClose,
}: {
  visible: boolean;
  version: string;
  onClose: () => void;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('checking');
  const [percent, setPercent] = useState(0);
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [granted, setGranted] = useState(false);
  const apkPathRef = useRef('');
  const abiRef = useRef('');
  const unsubRef = useRef<(() => void) | null>(null);

  const asset = buildApkAsset(version, abiRef.current);

  const cleanup = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  // 打开时准备：设备 ABI + 安装权限
  useEffect(() => {
    if (!visible) {
      // 注意：这里不取消下载 —— 「后台下载」按钮会把弹窗收起、下载继续；
      // 真正的取消走「取消下载」按钮（cancelApkDownload）。
      cleanup();
      return;
    }
    let alive = true;
    setPhase('checking');
    setPercent(0);
    setReceived(0);
    setTotal(0);
    setError('');
    apkPathRef.current = '';
    (async () => {
      const abi = await getDeviceAbi();
      const ok = await canInstallApk();
      if (!alive) return;
      abiRef.current = abi;
      setGranted(ok);
      setPhase('ready');
    })();
    return () => {
      alive = false;
    };
  }, [visible, cleanup]);

  // 从「安装未知应用」设置页返回：复查权限，若已授权且包已下载则直接安装
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const ok = await canInstallApk();
      setGranted(ok);
      if (ok && apkPathRef.current) {
        try {
          await installDownloadedApk(apkPathRef.current);
          setPhase('installing');
        } catch (e: any) {
          setError(e?.message || String(e));
          setPhase('error');
        }
      } else if (ok && phase === 'perm') {
        setPhase('ready');
      }
    });
    return () => sub.remove();
  }, [visible, phase]);

  const startDownload = useCallback(async () => {
    const a = buildApkAsset(version, abiRef.current);
    // 境内直连 GitHub 的下载链路经常不通：自建源（gnz48.tech）有同名包就优先，GitHub 兜底
    let primary = a.primaryUrl;
    let fallback = a.fallbackUrl;
    const selfUrl = await findSelfHostedUrl(a.assetName);
    if (selfUrl) {
      fallback = primary;
      primary = selfUrl;
    }
    setPhase('downloading');
    setPercent(0);
    setReceived(0);
    setTotal(0);
    cleanup();
    unsubRef.current = onApkProgress((p) => {
      const tot = Number(p?.total) || 0;
      const rec = Number(p?.received) || 0;
      setReceived(rec);
      setTotal(tot);
      setPercent(tot > 0 ? Math.min(100, Math.round((rec / tot) * 100)) : 0);
    });
    try {
      const path = await downloadApk(primary, fallback, a.fileName);
      apkPathRef.current = path;
      cleanup();
      setPhase('installing');
      try {
        await installDownloadedApk(path);
      } catch (e: any) {
        if (e?.code === 'NEED_PERMISSION' || /NEED_PERMISSION/.test(String(e?.message))) {
          setGranted(false);
          setPhase('perm');
          return;
        }
        throw e;
      }
    } catch (e: any) {
      cleanup();
      if (e?.code === 'ECANCEL') {
        setPhase('ready');
        return;
      }
      setError(e?.message || t('下载失败'));
      setPhase('error');
    }
  }, [version, cleanup, t]);

  const onPrimary = useCallback(async () => {
    if (phase === 'downloading') {
      cancelApkDownload();
      return;
    }
    if (phase === 'perm' || (phase === 'ready' && !granted)) {
      if (phase === 'perm' && granted && apkPathRef.current) {
        try {
          await installDownloadedApk(apkPathRef.current);
          setPhase('installing');
        } catch (e: any) {
          setError(e?.message || String(e));
          setPhase('error');
        }
        return;
      }
      openInstallPermissionSettings();
      setPhase('perm');
      return;
    }
    void startDownload();
  }, [phase, granted, startDownload]);

  const primaryLabel =
    phase === 'downloading'
      ? t('取消下载')
      : phase === 'perm'
        ? granted
          ? t('继续安装')
          : t('去授权')
        : phase === 'ready' && !granted
          ? t('去授权')
          : phase === 'error'
            ? t('重试')
            : t('立即更新');

  const busy = phase === 'downloading' || phase === 'installing' || phase === 'checking';
  const sizeText = total > 0
    ? `${(received / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`
    : received > 0
      ? `${(received / 1024 / 1024).toFixed(1)} MB`
      : '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: palette.surfaceElevated, borderColor: palette.hairline }]}>
          <View style={styles.head}>
            <View style={[styles.iconWrap, { backgroundColor: palette.tintSoft }]}>
              <MaterialCommunityIcons name="cellphone-arrow-down" size={22} color={palette.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: palette.label }]} numberOfLines={1}>
                {t('发现新版本 {v}', { v: version })}
              </Text>
              <Text style={[styles.sub, { color: palette.labelSecondary }]} numberOfLines={1}>
                {t('当前 v{v} · {abi}', { v: APP_VERSION, abi: asset.abiTag === 'v8a' ? 'arm64-v8a' : asset.abiTag })}
              </Text>
            </View>
          </View>

          {/* 进度 */}
          <View style={[styles.track, { backgroundColor: palette.fill2 }]}>
            <View style={[styles.fill, { backgroundColor: palette.tint, width: `${phase === 'downloading' ? Math.max(percent, 2) : phase === 'installing' ? 100 : 0}%` }]} />
          </View>
          <Text style={[styles.meta, { color: palette.labelTertiary }]} numberOfLines={1}>
            {phase === 'downloading'
              ? `${t('下载中')}${percent > 0 ? ` · ${percent}%` : ''}${sizeText ? ` · ${sizeText}` : ''}`
              : phase === 'installing'
                ? t('已下载完成，请在系统弹窗里点「安装」')
                : phase === 'perm'
                  ? t('需要「安装未知应用」权限才能安装')
                  : phase === 'error'
                    ? error && `${t('下载失败')}：${error}`
                    : t('APK 会安装到当前应用，数据不会丢失')}
          </Text>

          {phase === 'perm' && !granted ? (
            <Text style={[styles.tip, { color: palette.labelSecondary }]}>
              {t('在系统设置里打开「允许来自此来源的应用」后返回本页，会自动继续。')}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: palette.fill2 }]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={[styles.btnText, { color: palette.label }]}>
                {phase === 'downloading' ? t('后台下载') : phase === 'installing' ? t('完成') : t('稍后')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { backgroundColor: palette.tint }]}
              onPress={onPrimary}
              activeOpacity={0.85}
              disabled={phase === 'checking' || phase === 'installing'}
            >
              {phase === 'checking' ? (
                <ActivityIndicator size="small" color={palette.onTint} />
              ) : (
                <Text style={[styles.btnText, { color: palette.onTint }]}>{primaryLabel}</Text>
              )}
            </TouchableOpacity>
          </View>

          {phase === 'installing' ? (
            <Text style={[styles.footnote, { color: palette.labelTertiary }]}>{t('安装包已交给系统，安装完成后重新打开应用即可')}</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 420, borderRadius: radiiAlias.card, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconWrap: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 3 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  meta: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  tip: { fontSize: 12, marginTop: 8, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, height: 44, borderRadius: radiiAlias.button, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { flex: 1.25 },
  btnText: { fontSize: 14, fontWeight: '700' },
  footnote: { fontSize: 11, marginTop: 12, textAlign: 'center' },
});
