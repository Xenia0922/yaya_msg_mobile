/**
 * LoginScreen · 账号设置 v2.6 布局重做
 * - 登录方式用分段控件（短信验证码 / Token / B站二维码）：fill2 底 + 选中白胶囊
 * - 表单卡：输入框圆角 14 fill2 底 + 主按钮 Button filled 全宽
 * - 账号列表改行卡：头像、昵称、账号类型、「当前」徽标和切换按钮
 * - B站二维码卡：白卡圆角 16 + 二维码居中 + 过期刷新按钮
 * 业务逻辑 / API / 数据流 / 路由 / i18n 原文一律不动，仅重组布局。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useNavigation } from '@react-navigation/native';
import QRCode from 'qrcode';
import { WebView } from 'react-native-webview';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSettingsStore, useUiStore } from '../store';
import { FadeInView } from '../components/Motion';
import { ScalePressable } from '../components/Motion';
import ScreenHeader from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { NetworkImage } from '../components/NetworkImage';
import { saveSettings } from '../services/settings';
import { resetNimSession } from '../services/pocketNim/session';
import pocketApi from '../api/pocket48';
import bilibiliApi from '../api/bilibili';
import { errorMessage, normalizeUrl, pickText } from '../utils/data';
import { logWarn } from '../utils/runtimeLog';
import { usePalette, radii, radiiAlias, usePageBackground } from '../theme';
import { translate, useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from '../components/GlassSurface';
import { GlassSegmented } from '../components/GlassSegmented';
import IdentityDecorations from '../components/IdentityDecorations';
import { ALLOW_CUSTOM_IDENTITY_ROLES, ALLOW_CUSTOM_SENDER_PROFILE } from '../constants/identityFeatures';
import { getLiveUserAvatar, normalizeLiveAvatar } from '../services/liveAvatarCache';
import { encryptPocketPassword, validateRegistrationPassword } from '../utils/pocketRegistration';

function AccountSectionTitle({ icon, title, compact = false }: { icon: string; title: string; compact?: boolean }) {
  const palette = usePalette();
  return (
    <View style={[styles.titleRow, compact && { marginBottom: 0 }]}>
      <View style={[styles.titleIcon, { backgroundColor: palette.tintSoft }]}>
        <MaterialCommunityIcons name={icon} color={palette.tint} size={19} />
      </View>
      <Text style={[styles.cardTitle, { color: palette.label }]}>{title}</Text>
    </View>
  );
}

function AccountAvatar({ uri, userId }: { uri?: string; userId?: string }) {
  const palette = usePalette();
  const normalized = normalizeLiveAvatar(uri);
  const [resolved, setResolved] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { setResolved(''); setFailed(false); }, [normalized, userId]);
  useEffect(() => {
    let active = true;
    if ((!normalized || failed) && !resolved && userId && /^\d+$/.test(userId)) {
      void getLiveUserAvatar(userId).then((url) => {
        if (active && url && url !== normalized) { setResolved(url); setFailed(false); }
      });
    }
    return () => { active = false; };
  }, [normalized, userId, failed, resolved]);
  const url = resolved || normalized;
  return url && !failed ? (
    <NetworkImage source={{ uri: url }} style={styles.accountAvatar} resizeMode="cover" fallback={false} onError={() => setFailed(true)} />
  ) : (
    <View style={[styles.accountAvatar, { backgroundColor: palette.tintSoft }]}><MaterialCommunityIcons name="account-outline" color={palette.tint} size={24} /></View>
  );
}

const BILI_COOKIE_KEYS = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];

/** 从一段 search/hash 裸参数字符串里提取 B站 cookie（仅用 URLSearchParams，不依赖 Hermes 的 new URL） */
function biliCookiesFromSearch(search = ''): string {
  try {
    const params = new URLSearchParams(search);
    return BILI_COOKIE_KEYS
      .map((key) => {
        const value = params.get(key);
        return value ? `${key}=${value}` : '';
      })
      .filter(Boolean)
      .join('; ');
  } catch {
    return '';
  }
}

/**
 * 从扫码确认回调 url/参数串提取 B站 cookie，兼容几种 B站实测/历史形态：
 *  1) 完整 crossDomain URL：query 里带 cookie（https://passport.bilibili.com/x/passport-login/web/crossDomain?DedeUserID=..&SESSDATA=..）
 *  2) hash 里带参数：.../#SESSDATA=..&bili_jct=..
 *  3) 整个 URL 被 encodeURIComponent 嵌了一层（SESSDATA%3D..%26bili_jct%3D..）
 *  4) 裸 key=value 串（无协议无路径）
 */
function buildBilibiliCookieFromUrl(rawUrl = ''): string {
  const extract = (source: string): string => {
    let search = source;
    const q = source.indexOf('?');
    if (q >= 0) search = source.slice(q + 1);
    const parts = search.split('#');
    let query = parts[0] || '';
    const hash = parts.length > 1 ? parts[1] : '';
    if (hash) query = query ? `${query}&${hash}` : hash;
    return biliCookiesFromSearch(query);
  };

  let cookie = extract(rawUrl);
  if (cookie.includes('SESSDATA')) return cookie;

  // 嵌套编码：整串先 decode 一层再提取
  try {
    const decoded = decodeURIComponent(rawUrl);
    if (decoded !== rawUrl && decoded.includes('SESSDATA')) {
      const nested = extract(decoded);
      if (nested.includes('SESSDATA')) return nested;
    }
  } catch {
    /* 非法编码串，忽略 */
  }

  return cookie;
}

/** 从原生模块返回的 "k=v; k=v"（Set-Cookie 头拼串）里挑出 B站 常用键。
 *  注意与 url query 解析不同：cookie 串按 ';' 分段，值里不含 ';'。 */
function pickBiliCookies(raw = ''): string {
  const parts = String(raw)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return BILI_COOKIE_KEYS
    .map((key) => {
      const hit = parts.find((p) => p.startsWith(`${key}=`));
      return hit || '';
    })
    .filter(Boolean)
    .join('; ');
}

function extractPocketToken(value: any): string {
  const seen = new Set<any>();
  const walk = (node: any): string => {
    if (!node || typeof node !== 'object' || seen.has(node)) return '';
    seen.add(node);
    const direct = [
      node.token,
      node.accessToken,
      node.access_token,
      node.p48Token,
      node.sessionToken,
      node?.userInfo?.token,
      node?.userInfo?.accessToken,
      node?.content?.token,
      node?.content?.accessToken,
      node?.content?.userInfo?.token,
      node?.data?.token,
      node?.data?.accessToken,
    ].find((item) => typeof item === 'string' && item.trim().length > 10);
    if (direct) return direct.trim();
    for (const item of Object.values(node)) {
      const found = walk(item);
      if (found) return found;
    }
    return '';
  };
  return walk(value);
}

function accountId(user: any): string {
  return String(user?.userId || user?.id || user?.userInfo?.userId || user?.userInfo?.id || '');
}

function accountName(user: any): string {
  return String(user?.nickname || user?.nickName || user?.name || user?.userInfo?.nickname || user?.userInfo?.nickName || user?.userInfo?.name || translate('未命名账号'));
}

function accountAvatar(user: any): string {
  return pickText(user, ['avatar', 'userAvatar', 'avatarUrl', 'headImg', 'headUrl', 'baseUserInfo.avatar', 'baseUserInfo.userAvatar', 'userInfo.avatar', 'userInfo.userAvatar', 'userInfo.avatarUrl', 'userInfo.headImg', 'userInfo.headUrl']);
}

function accountRole(user: any, fallback: string): string {
  return String(user?.roleName || user?.typeName || user?.accountType || user?.userInfo?.roleName || fallback);
}

function parseAccountInfo(res: any) {
  const content = res?.content || res?.data || res || {};
  const current = content.userInfo || content.user || content;
  const bigSmallInfo = content.bigSmallInfo || content.bigSmall || content.userInfo?.bigSmallInfo || {};
  const bigUsers = [
    bigSmallInfo.bigUserInfo,
    bigSmallInfo.bigUser,
    bigSmallInfo.ownerUserInfo,
  ].filter(Boolean);
  const smallUsers = [
    ...(Array.isArray(bigSmallInfo.smallUserInfo) ? bigSmallInfo.smallUserInfo : []),
    ...(Array.isArray(bigSmallInfo.smallUserList) ? bigSmallInfo.smallUserList : []),
    ...(Array.isArray(bigSmallInfo.smallUsers) ? bigSmallInfo.smallUsers : []),
  ];
  const users = [...bigUsers, ...smallUsers].filter((user, index, list) => {
    const id = accountId(user);
    return id && list.findIndex((item) => accountId(item) === id) === index;
  });
  // 当前账号排最前（切换入口一眼可见），其余保持大号/小号顺序
  const currentId = accountId(current);
  if (currentId) {
    const idx = users.findIndex((u) => accountId(u) === currentId);
    if (idx > 0) {
      const [cur] = users.splice(idx, 1);
      users.unshift(cur);
    }
    if (idx < 0) users.unshift(current);
  }
  return { current, users };
}

type LoginMode = 'sms' | 'password' | 'token' | 'bilibili';

export default function LoginScreen() {
  const navigation = useNavigation();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const showToast = useUiStore((state) => state.showToast);
  const palette = usePalette();
  const { t } = useI18n();
  const pollingRef = useRef(true);
  useEffect(() => { return () => { pollingRef.current = false; }; }, []);
  // 账号设置页固定竖屏：避免从横屏播放器进入时内容被横向挤压（布局按竖屏设计）
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);
  const [mode, setMode] = useState<LoginMode>('sms');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('86');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [registration, setRegistration] = useState<{ mobile: string; area: string; code: string; phase: 'new' | 'registered' | 'uncertain'; encrypted: string } | null>(null);
  const registrationBusyRef = useRef(false);
  const smsIdentityRef = useRef('');
  useEffect(() => { setRegistration(null); setConfirmation(''); setAgreed(false); }, [phone, area, code]);
  const [manualToken, setManualToken] = useState(settings.p48Token || '');
  const [qrKey, setQrKey] = useState('');
  const activePollKeyRef = useRef(''); // Y3: 当前活跃轮询的二维码 key（刷新二维码时旧轮询据此退出）
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [biliStatus, setBiliStatus] = useState('');
  const [qrHtml, setQrHtml] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [renameCountText, setRenameCountText] = useState('');
  const [accountInfo, setAccountInfo] = useState<{ current: any; users: any[] }>({ current: null, users: [] });
  const accountRequestRef = useRef(0);
  const [switchingUserId, setSwitchingUserId] = useState('');
  useEffect(() => {
    const seq = ++accountRequestRef.current;
    setAccountInfo({ current: null, users: [] });
    setProfileAvatar('');
    if (!settings.p48Token) return;
    void pocketApi.loginCheckToken().then((res) => {
      if (seq === accountRequestRef.current && res?.success !== false && (res?.status === 200 || res?.success || res?.content || res?.data)) setAccountInfo(parseAccountInfo(res));
    }).catch(() => {});
    return () => { accountRequestRef.current += 1; };
  }, [settings.p48Token]);
  // 短信发送触发风控安全验证（status=2001）：展示问题与选项，选对后带 answer 重发
  const [verify, setVerify] = useState<{ question: string; options: string[]; phone: string; area: string } | null>(null);

  /** 个性装扮：只写本地设置，不改账号资料 */
  const saveSendIdentity = (patch: Record<string, string>) => {
    setSettings(patch);
    saveSettings(patch).catch(() => {});
  };


  const savePocketToken = async (token: string, message: string) => {
    const clean = token.trim();
    try {
      setSettings({ p48Token: clean });
      await saveSettings({ p48Token: clean });
      // 账号变了 → 立即重置云信会话（凭证/自身资料/QChat·聊天室登录态 + 原生连接）。
      // 否则切号后短时间内：弹幕与房间消息仍带旧号身份、且新旧 accid 不匹配导致连不上房间。
      resetNimSession('切换/保存口袋账号');
      setManualToken(clean);
      setStatus(message);
    } catch (error: any) {
      setStatus(t('保存失败：{msg}', { msg: error?.message || String(error) }));
    }
  };

  const handleSendSms = async (answer?: string) => {
    if (!phone.trim() && !verify) {
      setStatus(t('请输入手机号'));
      return;
    }
    setLoading(true);
    setStatus(t('正在获取验证码'));
    try {
      const areaCode = area.replace(/[^0-9]/g, '') || '86';
      const res: any = await pocketApi.loginSendSms(phone.trim() || verify!.phone, verify?.area || areaCode, answer);
      if (res?.needVerification) {
        setVerify({
          question: res.question || t('安全验证'),
          options: Array.isArray(res.options) ? res.options.map(String) : [],
          phone: phone.trim() || verify!.phone,
          area: verify?.area || areaCode,
        });
        setStatus(t('请完成安全验证后重新获取验证码'));
      } else {
        setStatus(res?.success ? t('验证码已发送') : t(res?.msg || res?.message || '验证码发送失败'));
        if (res?.success) {
          smsIdentityRef.current = `${phone.trim() || verify?.phone}:${verify?.area || areaCode}`;
          setVerify(null);
        }
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAnswer = (option: string) => {
    handleSendSms(option);
  };

  const handleLogin = async () => {
    if (!phone.trim() || !code.trim()) {
      setStatus(t('请输入手机号和短信验证码'));
      return;
    }
    const areaCode = area.replace(/[^0-9]/g, '') || '86';
    if (smsIdentityRef.current && smsIdentityRef.current !== `${phone.trim()}:${areaCode}`) {
      setStatus(t('手机号或区号已更改，请重新获取验证码'));
      return;
    }
    setLoading(true);
    setStatus(t('正在登录'));
    try {
      const res = await pocketApi.loginByCode(phone.trim(), code.trim(), verify?.area || areaCode);
      if (!pollingRef.current) return;
      if (Number(res?.status) === 10001) {
        setRegistration({ mobile: phone.trim(), code: code.trim(), area: verify?.area || areaCode, phase: 'new', encrypted: '' });
        setPassword(''); setConfirmation(''); setAgreed(false);
        setStatus(t('该手机号尚未注册，请设置密码并阅读协议'));
        return;
      }
      const token = Number(res?.status) === 200 && res?.success !== false ? extractPocketToken(res) : '';
      if (token) {
        await savePocketToken(token, t('登录成功'));
        setTimeout(() => navigation.goBack(), 700);
      } else {
        const msg = res?.message || res?.msg || res?.content?.message || '';
        const base = t('登录失败接口未返回token');
        setStatus(msg ? `${base}。${t('返回：{msg}', { msg: t(String(msg)) })}` : base);
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    const mobile = phone.trim();
    if (!/^\d{6,20}$/.test(mobile) || !password) { setStatus(t('请输入手机号和密码')); return; }
    setLoading(true); setStatus(t('正在登录'));
    try {
      const res = await pocketApi.loginByPassword(mobile, encryptPocketPassword(password));
      if (!pollingRef.current) return;
      const token = extractPocketToken(res);
      if (!token) throw new Error(t('登录失败，接口未返回登录信息'));
      setPassword('');
      await savePocketToken(token, t('登录成功'));
      setTimeout(() => navigation.goBack(), 700);
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    if (!registration || registrationBusyRef.current) return;
    let { encrypted } = registration;
    if (registration.phase === 'new') {
      const problem = validateRegistrationPassword(password, confirmation);
      if (problem) { setStatus(t(problem)); return; }
      if (!agreed) { setStatus(t('请先阅读并同意口袋48官方协议')); return; }
      if (!/^\d{6,20}$/.test(registration.mobile) || !/^[1-9]\d{0,3}$/.test(registration.area) || !/^\d{4,10}$/.test(registration.code)) {
        setStatus(t('手机号、区号或验证码格式不正确')); return;
      }
      try { encrypted = encryptPocketPassword(password); }
      catch { setStatus(t('密码处理失败，请重试')); return; }
    }
    registrationBusyRef.current = true;
    setLoading(true);
    try {
      if (registration.phase === 'new') {
        setStatus(t('正在注册'));
        let res: any;
        try { res = await pocketApi.registerByCode(registration.mobile, registration.code, registration.area, encrypted); }
        catch {
          if (!pollingRef.current) return;
          setRegistration({ ...registration, encrypted, phase: 'uncertain' });
          setPassword(''); setConfirmation('');
          throw new Error(t('注册结果未确认，请先尝试登录，避免重复注册'));
        }
        if (!pollingRef.current) return;
        if (Number(res?.status) !== 200 || res?.success === false) {
          if (!res?.status || (Number(res.status) >= 500 && Number(res.status) < 600)) {
            setRegistration({ ...registration, encrypted, phase: 'uncertain' });
            setPassword(''); setConfirmation('');
            throw new Error(t('注册结果未确认，请先尝试登录，避免重复注册'));
          }
          throw new Error(String(res?.message || res?.msg || t('注册失败')));
        }
        setRegistration({ ...registration, encrypted, phase: 'registered' });
        setPassword(''); setConfirmation('');
      }
      setStatus(t('正在登录'));
      const res = await pocketApi.loginByPassword(registration.mobile, encrypted);
      if (!pollingRef.current) return;
      const token = extractPocketToken(res);
      if (!token) throw new Error(t('自动登录失败，请重试登录'));
      setRegistration(null);
      await savePocketToken(token, t('登录成功'));
      setTimeout(() => navigation.goBack(), 700);
    } catch (error) { setStatus(errorMessage(error)); }
    finally { registrationBusyRef.current = false; setLoading(false); }
  };

  const handleSaveManualToken = async () => {
    const token = manualToken.trim();
    if (!token) {
      setStatus(t('请先粘贴token'));
      return;
    }
    setLoading(true);
    setStatus(t('正在保存...'));
    try {
      await savePocketToken(token, t('Token已保存'));
    } finally {
      setLoading(false);
    }
  };

  const refreshAccountInfo = async () => {
    const seq = ++accountRequestRef.current;
    const res = await pocketApi.loginCheckToken();
    const ok = res?.success !== false && (res?.status === 200 || res?.success || res?.content || res?.data);
    if (seq === accountRequestRef.current && ok) setAccountInfo(parseAccountInfo(res));
    return { res, ok };
  };

  const handleCheckToken = async () => {
    const token = manualToken.trim() || settings.p48Token;
    if (token && token !== settings.p48Token) {
      // 与登录/切号走同一条路径：改 token 必须同时重置云信会话
      // （否则弹幕与房间消息仍用旧号身份、且新旧 accid 不匹配会连不上房间）
      await savePocketToken(token, t('Token已保存'));
    }
    setLoading(true);
    setStatus(t('正在检查Token'));
    try {
      const { res, ok } = await refreshAccountInfo();
      setStatus(ok ? t('Token有效') : t('Token无效：{msg}', { msg: res?.msg || res?.message || JSON.stringify(res).slice(0, 160) }));
    } catch (error) {
      setStatus(t('Token无效：{msg}', { msg: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchPocketAccount = async (user: any) => {
    const targetUserId = accountId(user);
    if (!targetUserId) {
      setStatus(t('切换失败没有拿到目标账号ID'));
      return;
    }
    setLoading(true);
    setSwitchingUserId(targetUserId);
    setStatus(t('正在切换到{name}', { name: accountName(user) }));
    try {
      const res = await pocketApi.switchBigSmall(targetUserId);
      const token = pickText(res, ['content.token', 'data.token', 'token', 'content.accessToken', 'data.accessToken']) || extractPocketToken(res);
      if (!token) throw new Error(t('切换失败没有拿到目标账号ID'));
      const done = t('已切换到{name}', { name: accountName(user) });
      await savePocketToken(token, done);
      await refreshAccountInfo();
      showToast(done);
    } catch (error) {
      setStatus(t('切换账号失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      setSwitchingUserId('');
      setLoading(false);
    }
  };

  const pollBiliLogin = async (key: string) => {
    // Y3: 抢占——刷新二维码会带新 key 启动新轮询；旧轮询被抢占即退出（此前靠从未赋值的 qrKey，永不退出）
    activePollKeyRef.current = key;
    let pollWarned = false;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (!pollingRef.current) return; // abort if unmounted
      if (activePollKeyRef.current !== key) return; // 已被更新的二维码轮询抢占
      try {
        const res = await bilibiliApi.pollQrCode(key);
        if (res.data.code === 0) {
          const rawUrl = String(res.data?.url || '');
          let cookie = buildBilibiliCookieFromUrl(rawUrl);
          if (!cookie.includes('SESSDATA') && /ticket=|crossDomain/i.test(rawUrl)) {
            // B站 2024+ 新协议：poll 只回 ticket url，cookie 在 crossDomain 302 的 Set-Cookie 里
            // → 原生 BiliLoginModule（followRedirects=false 读首包）换 cookie
            try {
              cookie = pickBiliCookies(await bilibiliApi.exchangeTicket(rawUrl));
              logWarn(
                `[bili-login] ticket 换 cookie ${cookie.includes('SESSDATA') ? '成功' : '失败（无 SESSDATA）'}`,
                'login.pollBili',
              );
            } catch (e) {
              logWarn('[bili-login] ticket 换 cookie 异常', 'login.pollBili');
            }
          }
          if (!cookie.includes('SESSDATA')) {
            logWarn(
              `[bili-login] 扫码已确认但未解析出 SESSDATA，code=${res.data?.code}`,
              'login.pollBili',
            );
            setBiliStatus(t('B站已确认但没有拿到Cookie'));
            return;
          }
          const nav = await bilibiliApi.checkLoginStatus(cookie);
          const userInfo = nav?.code === 0 && nav?.data?.isLogin
            ? { mid: String(nav.data.mid || ''), uname: String(nav.data.uname || ''), face: String(nav.data.face || '') }
            : null;
          setSettings({ bilibiliCookie: cookie, bilibiliUserInfo: userInfo });
          await saveSettings({ bilibiliCookie: cookie, bilibiliUserInfo: userInfo });
          setBiliStatus(t('B站登录成功'));
          return;
        }
        if (res.data.code === 86038) {
          setBiliStatus(t('二维码已过期请刷新'));
          return;
        }
      } catch (e) {
        if (!pollWarned) {
          pollWarned = true;
          logWarn('B站二维码轮询失败: ' + errorMessage(e), 'login.pollBili');
        }
      }
    }
    setBiliStatus(t('B站登录超时'));
  };

  const handleBiliQr = async () => {
    setLoading(true);
    setBiliStatus(t('正在获取B站二维码'));
    try {
      const res = await bilibiliApi.generateQrCode();
      if (res.code === 0 && res.data) {
        const key = res.data.qrcode_key;
        const svg = await QRCode.toString(res.data.url, { type: 'svg', margin: 2, width: 220 });
        setQrKey(key);
        setQrHtml(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;">${svg}</body></html>`);
        setBiliStatus(t('请用B站App扫码'));
        pollBiliLogin(key);
      } else {
        setBiliStatus(res?.message || t('B站二维码获取失败'));
      }
    } catch (error) {
      setBiliStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadProfile = async () => {
    setLoading(true);
    setStatus(t('正在读取口袋资料'));
    try {
      const res = await pocketApi.getNimLoginInfo();
      const info = res?.content?.userInfo || res?.content?.user || res?.content || res?.data?.userInfo || res?.data || {};
      setProfileName(String(info.nickName || info.nickname || info.name || ''));
      setProfileAvatar(String(info.avatar || info.headImg || info.headUrl || ''));
      const renameRes = await pocketApi.getUserRenameCount().catch(() => null);
      const renameContent = renameRes?.content ?? renameRes?.data ?? renameRes;
      if (renameContent && typeof renameContent === 'object') {
        const freeCount = renameContent.count ?? renameContent.renameCount ?? renameContent.renameNum ?? renameContent.num ?? renameContent.leftCount ?? renameContent.remainCount;
        const chickenCount = renameContent.jtcount ?? renameContent.jtCount ?? renameContent.chickenCount ?? renameContent.payCount;
        setRenameCountText(t('免费修改：{free} · 鸡腿修改：{chicken}', {
          free: freeCount ?? '--',
          chicken: chickenCount ?? '--',
        }));
      }
      setStatus(t('资料已读取'));
    } catch (error) {
      setStatus(t('资料读取失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const handleEditProfile = async () => {
    const name = profileName.trim();
    if (!name) {
      setStatus(t('请输入新昵称'));
      return;
    }
    setLoading(true);
    setStatus(t('正在修改昵称'));
    try {
      await pocketApi.editUserInfo({ key: 'nickname', value: name });
      setStatus(t('昵称修改成功'));
      await handleLoadProfile();
    } catch (error) {
      setStatus(t('资料读取失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    setLoading(true);
    setStatus(t('正在选择并上传头像'));
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setStatus(t('没有相册权限无法选择头像'));
        setLoading(false);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled) {
        setStatus(t('已取消选择头像'));
        setLoading(false);
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error(t('图片选择器没有返回文件'));
      setStatus(t('正在上传到口袋服务器'));
      const upload = await pocketApi.uploadUserAvatar({
        uri: asset.uri,
        fileName: asset.fileName || `avatar-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });
      if (!upload.path) throw new Error(t('上传成功但没有返回路径'));
      setStatus(t('正在更新头像'));
      await pocketApi.editUserInfo({ key: 'avatar', value: upload.path });
      setProfileAvatar(upload.path);
      setStatus(t('头像已更新'));
    } catch (error) {
      setStatus(t('头像上传失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const SEGMENTS: { key: LoginMode; label: string; icon: string }[] = [
    { key: 'sms', label: t('验证码'), icon: 'message-text-outline' },
    { key: 'password', label: t('密码'), icon: 'lock-outline' },
    { key: 'token', label: t('Token'), icon: 'key-variant' },
    { key: 'bilibili', label: t('B站二维码'), icon: 'qrcode' },
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
    <ScrollView style={[styles.container, { backgroundColor: usePageBackground() }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={t('账号设置')} />

      <FadeInView delay={40} duration={280} distance={8}>
        {/* 口袋账号切换：账户行卡列表 */}
        <GlassSurface radius={20} role="card" style={styles.card}>
          <View style={styles.cardHead}>
            <AccountSectionTitle icon="account-switch-outline" title={t('口袋账号')} compact />
            <Button title={t('刷新')} variant="tinted" size="sm" onPress={handleCheckToken} disabled={loading} />
          </View>
          <Text style={[styles.accountSummary, { color: palette.labelSecondary }]}>
            {t('当前：{info}', { info: accountInfo.current ? `${accountName(accountInfo.current)} ${accountId(accountInfo.current) ? `(${accountId(accountInfo.current)})` : ''}` : t('先检查Token读取账号') })}
          </Text>
          {accountInfo.users.length ? accountInfo.users.map((user, index) => {
            const id = accountId(user);
            const isCurrent = !!id && id === accountId(accountInfo.current);
            return (
              <FadeInView key={id} delay={index < 12 ? 60 + index * 25 : 0} duration={300} distance={8}>
                <ScalePressable
                  style={[
                    styles.accountRow,
                    isCurrent ? { borderColor: palette.tint, backgroundColor: palette.tintSoft } : { backgroundColor: palette.fill3, borderColor: 'transparent' },
                  ]}
                  onPress={() => handleSwitchPocketAccount(user)}
                  disabled={loading || isCurrent}
                  activeOpacity={0.7}
                  pressedScale={0.985}
                >
                  <AccountAvatar uri={accountAvatar(user) || (isCurrent ? accountAvatar(accountInfo.current) : '')} userId={id} />
                  <View style={styles.accountTextWrap}>
                    <Text style={[styles.accountName, { color: palette.label }]} numberOfLines={1}>{accountName(user)}</Text>
                    <Text style={[styles.accountMeta, { color: palette.labelTertiary }]} numberOfLines={1}>
                      {accountRole(user, t('账号'))}
                    </Text>
                  </View>
                  {!isCurrent ? (
                    <Button
                      title={switchingUserId === id ? t('切换中') : t('切换')}
                      variant="filled"
                      size="sm"
                      onPress={() => handleSwitchPocketAccount(user)}
                      disabled={loading || switchingUserId === id}
                      loading={switchingUserId === id}
                    />
                  ) : (
                    <View style={[styles.currentBadge, { backgroundColor: palette.tint }]}>
                      <Text style={[styles.currentBadgeText, { color: palette.onTint }]}>{t('当前')}</Text>
                    </View>
                  )}
                </ScalePressable>
              </FadeInView>
            );
          }) : <Text style={[styles.accountEmpty, { color: palette.labelTertiary }]}>{t('登录后可刷新并切换账号')}</Text>}
        </GlassSurface>

      </FadeInView>

      <FadeInView delay={40} duration={280} distance={8}>
        <Text style={[styles.groupLabel, { color: palette.labelSecondary }]}>{t('登录方式')}</Text>
        {/* 登录方式分段控件：玻璃滑动选中（与全站一致） */}
        <GlassSegmented
          options={SEGMENTS.map((seg) => ({ key: String(seg.key), label: seg.label }))}
          value={String(mode)}
          onChange={(k) => { if (!loading) { setMode(k as typeof mode); setPassword(''); setStatus(''); } }}
          height={38}
          style={{ marginBottom: 12 }}
        />
      </FadeInView>

      <FadeInView delay={80} duration={300} distance={8}>
        {/* 短信验证码登录 */}
        {mode === 'sms' ? (
          <GlassSurface radius={20} role="card" style={styles.card}>
            <AccountSectionTitle icon="message-text-outline" title={t('口袋48验证码登录')} />
            <View style={styles.phoneRow}>
              <View style={[styles.field, styles.areaWrap, { backgroundColor: palette.fill2 }]}>
                <Text style={[styles.areaPlus, { color: palette.label }]}>+</Text>
                <TextInput
                  style={[styles.areaInput, { color: palette.label }]}
                  placeholder="86"
                  placeholderTextColor={palette.labelTertiary}
                  keyboardType="phone-pad"
                  maxLength={5}
                  value={area}
                  onChangeText={(v) => { setVerify(null); setArea(v.replace(/[^0-9]/g, '').slice(0, 5)); }}
                  editable={!loading}
                />
              </View>
              <TextInput style={[styles.field, styles.phoneInput, { backgroundColor: palette.fill2, color: palette.label }]} placeholder={t('手机号')} placeholderTextColor={palette.labelTertiary} keyboardType="phone-pad" value={phone} onChangeText={(value) => { setVerify(null); setPhone(value); }} editable={!loading} />
            </View>
            <TextInput style={[styles.field, { backgroundColor: palette.fill2, color: palette.label }]} placeholder={t('短信验证码')} placeholderTextColor={palette.labelTertiary} keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={10} editable={!loading} />
            {verify ? (
              <View style={[styles.verifyBox, { backgroundColor: palette.fill2, borderColor: palette.innerStroke }]}>
                <Text style={[styles.verifyQuestion, { color: palette.label }]}>{verify.question}</Text>
                <View style={styles.verifyOptions}>
                  {verify.options.map((option) => (
                    <ScalePressable
                      key={option}
                      onPress={() => handleVerifyAnswer(option)}
                      disabled={loading}
                      pressedScale={0.94}
                      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                    >
                      <GlassSurface
                        radius={20}
                        role="chip"
                        style={[styles.verifyOption, { borderColor: palette.innerStroke, borderWidth: StyleSheet.hairlineWidth }]}
                      >
                        <Text style={[styles.verifyOptionText, { color: palette.label }]}>{option}</Text>
                      </GlassSurface>
                    </ScalePressable>
                  ))}
                </View>
              </View>
            ) : null}
            {registration ? <View style={[styles.verifyBox, { backgroundColor: palette.fill2, borderColor: palette.innerStroke }]}>
              <Text style={[styles.verifyQuestion, { color: palette.label }]}>{t(registration.phase === 'new' ? '注册口袋48账号' : '尝试登录')}</Text>
              {registration.phase === 'new' ? <>
                <TextInput style={[styles.field, { backgroundColor: palette.surface, color: palette.label }]} placeholder={t('设置密码（至少 6 位）')} placeholderTextColor={palette.labelTertiary} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" editable={!loading} maxLength={1024} />
                <TextInput style={[styles.field, { backgroundColor: palette.surface, color: palette.label }]} placeholder={t('确认密码')} placeholderTextColor={palette.labelTertiary} value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" editable={!loading} maxLength={1024} />
                <ScalePressable onPress={() => setAgreed(!agreed)} disabled={loading} style={styles.agreementRow} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
                  <MaterialCommunityIcons name={agreed ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} color={palette.tint} />
                  <Text style={[styles.agreementText, { color: palette.label }]}>{t('我已阅读并同意口袋48官方协议')}</Text>
                </ScalePressable>
                <View style={styles.agreementLinks}>
                  {[
                    ['用户协议', 'https://h5.48.cn/pocket_agreement/privacy/home/service.html'],
                    ['隐私政策', 'https://h5.48.cn/pocket_agreement/privacy/home/privacy.html'],
                    ['未成年人保护指引', 'https://h5.48.cn/pocket_agreement/privacy/home/children.html'],
                  ].map(([label, url]) => <Text key={url} onPress={() => { void Linking.openURL(url).catch(() => setStatus(t('无法打开协议链接'))); }} style={{ color: palette.tint, fontSize: 12 }}>{t(label)}</Text>)}
                </View>
              </> : <Text style={[styles.status, { color: palette.labelSecondary }]}>{t(registration.phase === 'uncertain' ? '注册结果未确认，请先尝试登录。' : '注册成功，请重试登录。')}</Text>}
              <View style={styles.btnCol}><Button title={t(registration.phase === 'new' ? '注册并登录' : '重试登录')} variant="filled" size="md" onPress={handleRegister} disabled={loading} loading={loading} fullWidth /></View>
            </View> : <View style={styles.btnCol}>
              <Button title={t('获取验证码')} variant="tinted" size="md" onPress={() => handleSendSms()} disabled={loading} fullWidth />
              <Button title={t('登录')} variant="filled" size="md" onPress={handleLogin} disabled={loading} fullWidth />
            </View>}
            {status && mode === 'sms' ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{status}</Text> : null}
          </GlassSurface>
        ) : null}

        {mode === 'password' ? (
          <GlassSurface radius={20} role="card" style={styles.card}>
            <AccountSectionTitle icon="lock-outline" title={t('口袋48密码登录')} />
            <TextInput style={[styles.field, { backgroundColor: palette.fill2, color: palette.label }]} placeholder={t('手机号')} placeholderTextColor={palette.labelTertiary} keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!loading} />
            <TextInput style={[styles.field, { backgroundColor: palette.fill2, color: palette.label }]} placeholder={t('密码')} placeholderTextColor={palette.labelTertiary} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" editable={!loading} maxLength={1024} />
            <Button title={t('登录')} variant="filled" size="md" onPress={handlePasswordLogin} disabled={loading} loading={loading} fullWidth />
            {status ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{status}</Text> : null}
          </GlassSurface>
        ) : null}

        {/* Token 登录 */}
        {mode === 'token' ? (
          <GlassSurface radius={20} role="card" style={styles.card}>
            <AccountSectionTitle icon="key-variant" title={t('口袋48Token登录')} />
            <TextInput
              style={[styles.field, styles.tokenInput, { backgroundColor: palette.fill2, color: palette.label }]}
              placeholder={t('粘贴口袋token')}
              placeholderTextColor={palette.labelTertiary}
              value={manualToken}
              onChangeText={setManualToken}
              autoCapitalize="none"
              autoCorrect={false}
              numberOfLines={1}
            />
            <View style={styles.btnCol}>
              <Button title={t('检查Token')} variant="tinted" size="md" onPress={handleCheckToken} disabled={loading} fullWidth />
              <Button title={t('保存Token')} variant="filled" size="md" onPress={handleSaveManualToken} disabled={loading} loading={loading} fullWidth />
            </View>
            {/* 已保存 Token + Token 状态：卡片内普通段落（紧贴按钮列），无独立块背景，
                避免被误认为\"卡片外独立横条\" */}
            {settings.p48Token ? (
              <View style={styles.copyTokenRow}>
                <Text style={[styles.copyTokenLabel, { color: palette.labelSecondary }]}>{t('已保存当前账号 Token')}</Text>
                <Button title={t('复制 Token')} variant="tinted" size="sm" onPress={() => { Clipboard.setString(settings.p48Token); showToast(t('Token 已复制')); }} />
              </View>
            ) : null}
            {status && mode === 'token' ? (
              <Text style={[styles.status, status.startsWith(t('Token有效')) ? { color: palette.tint, fontWeight: '700' } : { color: palette.danger, fontWeight: '700' }]} numberOfLines={2}>
                {status}
              </Text>
            ) : null}
          </GlassSurface>
        ) : null}

        {/* B站二维码 */}
        {mode === 'bilibili' ? (
          <GlassSurface radius={20} role="card" style={styles.card}>
            <AccountSectionTitle icon="qrcode" title={t('B站登录')} />
            {qrHtml ? (
              <View style={styles.qrCard}>
                <WebView source={{ html: qrHtml }} style={styles.qr} originWhitelist={['*']} scrollEnabled={false} />
              </View>
            ) : (
              <View style={styles.qrPlaceholder}>
                <MaterialCommunityIcons name="qrcode" color={palette.labelTertiary} size={56} />
              </View>
            )}
            {biliStatus ? <Text style={[styles.biliStatus, { color: palette.labelSecondary }]}>{biliStatus}</Text> : null}
            <View style={styles.btnCol}>
              <Button
                title={qrHtml ? t('刷新B站二维码') : t('获取B站登录二维码')}
                variant="filled"
                size="md"
                onPress={handleBiliQr}
                disabled={loading}
                loading={loading}
                fullWidth
              />
            </View>
            {/过期|超时|失败/.test(biliStatus) ? (
              <ScalePressable onPress={handleBiliQr} pressedScale={0.96} style={styles.qrRetry} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="refresh" color={palette.tint} size={16} />
                <Text style={[styles.qrRetryText, { color: palette.tint }]}>{t('二维码已过期，点击刷新')}</Text>
              </ScalePressable>
            ) : null}
            {settings.bilibiliCookie ? <Text style={[styles.tokenInfo, { color: palette.success }]}>{t('B站已登录')}</Text> : null}
            {status && mode === 'bilibili' ? <Text style={[styles.status, { color: palette.labelSecondary }]}>{status}</Text> : null}
          </GlassSurface>
        ) : null}

        {/* 口袋资料 */}
        <GlassSurface radius={20} role="card" style={styles.card}>
          <AccountSectionTitle icon="account-edit-outline" title={t('口袋资料')} />
          {renameCountText ? <Text style={[styles.metaLine, { color: palette.labelSecondary }]}>{renameCountText}</Text> : null}
          <TextInput
            style={[styles.field, { backgroundColor: palette.fill2, color: palette.label }]}
            placeholder={t('昵称')}
            placeholderTextColor={palette.labelTertiary}
            value={profileName}
            onChangeText={setProfileName}
          />
          <View style={styles.buttonRow}>
            <View style={styles.buttonCell}><Button title={t('读取资料')} variant="tinted" size="md" onPress={handleLoadProfile} disabled={loading} fullWidth /></View>
            <View style={styles.buttonCell}><Button title={t('修改昵称')} variant="filled" size="md" onPress={handleEditProfile} disabled={loading} fullWidth /></View>
          </View>
          <View style={[styles.profileAvatarRow, { backgroundColor: palette.fill2 }]}>
            <AccountAvatar uri={profileAvatar || accountAvatar(accountInfo.current)} userId={accountId(accountInfo.current)} />
            <View style={styles.accountTextWrap}>
              <Text style={[styles.profileAvatarTitle, { color: palette.label }]}>{t('账号头像')}</Text>
              <Text style={[styles.accountMeta, { color: palette.labelTertiary }]}>{t('选择图片后上传')}</Text>
            </View>
            <Button title={t('更换')} variant="tinted" size="sm" onPress={handlePickAvatar} disabled={loading} />
          </View>
        </GlassSurface>

        {/* 个性装扮：头像框 / 勋章（账号装饰，只影响消息展示，不改账号资料） */}
        <GlassSurface radius={20} role="card" style={styles.card}>
          <AccountSectionTitle icon="auto-fix" title={t('个性装扮')} />
          <IdentityDecorations accountKey={settings.p48Token || ''} frame={settings.yaya_send_pfurl || ''} teamLogo={settings.yaya_send_teamlogo || ''} badges={settings.yaya_send_badge || ''} bubbleId={settings.yaya_send_bubble_id || '0'} onChange={saveSendIdentity} />
        </GlassSurface>
        {/* 鸡腿充值 */}
        <GlassSurface radius={20} role="card" style={styles.card}>
          <AccountSectionTitle icon="wallet-outline" title={t('鸡腿充值')} />
          <Button title={t('打开官方充值页')} variant="filled" size="md" onPress={() => (navigation as any).navigate('RechargeScreen')} fullWidth />
        </GlassSurface>
      </FadeInView>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 32, paddingHorizontal: 16 },
  groupLabel: { fontSize: 13, fontWeight: '700', marginLeft: 4, marginBottom: 8, marginTop: 3 },
  cardMargin: { marginHorizontal: 16, marginTop: 16 },
  // 分段控件
  segment: {
    flexDirection: 'row',
    borderRadius: radii.md,
    padding: 4,
    gap: 4,
    marginBottom: 16,
    marginTop: 8,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: { fontSize: 14, fontWeight: '700' },
  // 卡片
  card: {
    borderRadius: radii.md,
    padding: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, marginBottom: 14 },
  titleIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  field: { height: 42, paddingHorizontal: 12, borderRadius: radiiAlias.input, marginBottom: 10, fontSize: 14 },
  tokenInput: { minHeight: 46, textAlignVertical: 'center', paddingVertical: 8 },
  btnCol: { gap: 10, marginTop: 4 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  buttonCell: { flex: 1, minWidth: 0 },
  phoneRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  areaWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 10 },
  areaPlus: { fontWeight: '700', fontSize: 15, marginRight: 2 },
  areaInput: { minWidth: 44, paddingVertical: 12, paddingHorizontal: 0, fontSize: 14 },
  phoneInput: { flex: 1 },
  profileAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 10, marginTop: 14 },
  profileAvatarTitle: { fontSize: 13, fontWeight: '600' },
  biliStatus: { marginTop: 10, fontSize: 12, textAlign: 'center', lineHeight: 18, flexShrink: 0, marginBottom: 4 },
  qrCard: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  qr: { width: 220, height: 220 },
  qrPlaceholder: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  qrRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
  },
  qrRetryText: { fontSize: 13, fontWeight: '700' },
  tokenInfo: { fontSize: 12, lineHeight: 18, flexShrink: 0, minHeight: 18, marginTop: 12 },
  copyTokenRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 },
  copyTokenLabel: { flex: 1, fontSize: 12, lineHeight: 18 },
  status: { fontSize: 12, lineHeight: 18, flexShrink: 0, marginTop: 6 },
  metaLine: { marginTop: 8, marginBottom: 10, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  accountSummary: { fontSize: 12, lineHeight: 18 },
  accountEmpty: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  // 账号行卡
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    gap: 12,
  },
  accountAvatar: { width: 48, height: 48, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  accountTextWrap: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  accountMeta: { marginTop: 3, fontSize: 11, flexShrink: 1 },
  currentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  currentBadgeText: { fontSize: 11, fontWeight: '800' },
  verifyBox: { padding: 12, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  verifyQuestion: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  verifyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  verifyOption: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.pill },
  verifyOptionText: { fontSize: 13, fontWeight: '600' },
  agreementRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agreementText: { fontSize: 12, flex: 1 },
  agreementLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, marginBottom: 8 },
});
