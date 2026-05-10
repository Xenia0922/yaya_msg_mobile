import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import QRCode from 'qrcode';
import { WebView } from 'react-native-webview';
import { useSettingsStore } from '../store';
import { saveSettings } from '../services/settings';
import pocketApi from '../api/pocket48';
import bilibiliApi from '../api/bilibili';
import { errorMessage } from '../utils/data';

function buildBilibiliCookieFromUrl(rawUrl = ''): string {
  try {
    const url = new URL(rawUrl);
    const params = new URLSearchParams(url.search);
    if (url.hash) {
      const hash = url.hash.replace(/^#/, '');
      const hashParams = new URLSearchParams(hash.includes('?') ? hash.split('?').pop() : hash);
      hashParams.forEach((value, key) => params.set(key, value));
    }
    const keys = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];
    return keys
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

export default function LoginScreen() {
  const navigation = useNavigation();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const isDark = settings.theme === 'dark';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [manualToken, setManualToken] = useState(settings.p48Token || '');
  const [qrKey, setQrKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [qrHtml, setQrHtml] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [renameCountText, setRenameCountText] = useState('');

  const savePocketToken = async (token: string, message: string) => {
    const clean = token.trim();
    setSettings({ p48Token: clean });
    await saveSettings({ p48Token: clean });
    setManualToken(clean);
    setStatus(message);
  };

  const handleSendSms = async () => {
    if (!phone.trim()) {
      setStatus('请输入手机号');
      return;
    }
    setLoading(true);
    setStatus('正在获取验证码...');
    try {
      const res: any = await pocketApi.loginSendSms(phone.trim());
      setStatus(res?.success ? '验证码已发送' : (res?.msg || res?.message || '验证码发送失败'));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!phone.trim() || !code.trim()) {
      setStatus('请输入手机号和短信验证码');
      return;
    }
    setLoading(true);
    setStatus('正在登录...');
    try {
      const res = await pocketApi.loginByCode(phone.trim(), code.trim());
      const token = extractPocketToken(res);
      if (token) {
        await savePocketToken(token, '登录成功');
        setTimeout(() => navigation.goBack(), 700);
      } else {
        const msg = res?.message || res?.msg || res?.content?.message || JSON.stringify(res).slice(0, 180);
        setStatus(`登录失败：接口未返回 token${msg ? `。返回：${msg}` : ''}`);
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveManualToken = async () => {
    const token = manualToken.trim();
    if (!token) {
      setStatus('请先粘贴 token');
      return;
    }
    await savePocketToken(token, 'Token 已保存');
  };

  const handleCheckToken = async () => {
    const token = manualToken.trim() || settings.p48Token;
    if (token && token !== settings.p48Token) {
      setSettings({ p48Token: token });
      await saveSettings({ p48Token: token });
    }
    setLoading(true);
    setStatus('正在检查 Token...');
    try {
      const res = await pocketApi.loginCheckToken();
      const ok = res?.success !== false && (res?.status === 200 || res?.success || res?.content || res?.data);
      setStatus(ok ? 'Token 有效' : `Token 无效：${res?.msg || res?.message || JSON.stringify(res).slice(0, 160)}`);
    } catch (error) {
      setStatus(`Token 检查失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const pollBiliLogin = async (key: string) => {
    for (let i = 0; i < 30; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (qrKey && key !== qrKey) return;
      try {
        const res = await bilibiliApi.pollQrCode(key);
        if (res.data.code === 0) {
          const cookie = buildBilibiliCookieFromUrl(res.data?.url || '');
          if (!cookie.includes('SESSDATA')) {
            setStatus('B站已确认，但没有拿到 Cookie');
            return;
          }
          const nav = await bilibiliApi.checkLoginStatus(cookie);
          const userInfo = nav?.code === 0 && nav?.data?.isLogin
            ? { mid: String(nav.data.mid || ''), uname: String(nav.data.uname || ''), face: String(nav.data.face || '') }
            : null;
          setSettings({ bilibiliCookie: cookie, bilibiliUserInfo: userInfo });
          await saveSettings({ bilibiliCookie: cookie, bilibiliUserInfo: userInfo });
          setStatus('B站登录成功');
          return;
        }
        if (res.data.code === 86038) {
          setStatus('二维码已过期，请重新获取');
          return;
        }
      } catch {}
    }
    setStatus('B站登录超时');
  };

  const handleBiliQr = async () => {
    setLoading(true);
    setStatus('正在获取 B站二维码...');
    try {
      const res = await bilibiliApi.generateQrCode();
      if (res.code === 0 && res.data) {
        const key = res.data.qrcode_key;
        const svg = await QRCode.toString(res.data.url, { type: 'svg', margin: 2, width: 220 });
        setQrKey(key);
        setQrHtml(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;">${svg}</body></html>`);
        setStatus('请用 B站 App 扫码');
        pollBiliLogin(key);
      } else {
        setStatus(res?.message || 'B站二维码获取失败');
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadProfile = async () => {
    setLoading(true);
    setStatus('\u6b63\u5728\u8bfb\u53d6\u53e3\u888b\u8d44\u6599...');
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
        setRenameCountText(`免费修改：${freeCount ?? '--'} · 鸡腿修改：${chickenCount ?? '--'}`);
      }
      setStatus('\u8d44\u6599\u5df2\u8bfb\u53d6');
    } catch (error) {
      setStatus(`\u8d44\u6599\u8bfb\u53d6\u5931\u8d25\uff1a${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEditProfile = async () => {
    if (!profileName.trim() && !profileAvatar.trim()) {
      setStatus('\u5148\u586b\u6635\u79f0\u6216\u5934\u50cf URL');
      return;
    }
    setLoading(true);
    setStatus('\u6b63\u5728\u63d0\u4ea4\u8d44\u6599\u4fee\u6539...');
    try {
      await pocketApi.editUserInfo({ nickName: profileName.trim(), avatar: profileAvatar.trim() });
      setStatus('\u8d44\u6599\u4fee\u6539\u63a5\u53e3\u5df2\u8fd4\u56de\u6210\u529f');
    } catch (error) {
      setStatus(`\u8d44\u6599\u4fee\u6539\u5931\u8d25\uff1a${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    setLoading(true);
    setStatus('正在选择并上传头像...');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setStatus('没有相册权限，无法选择头像');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled) {
        setStatus('已取消选择头像');
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error('图片选择器没有返回文件');
      const upload = await pocketApi.uploadUserAvatar({
        uri: asset.uri,
        fileName: asset.fileName || `avatar-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });
      setProfileAvatar(upload.path);
      await pocketApi.editUserInfo({ key: 'avatar', value: upload.path });
      setStatus('头像已上传并保存');
    } catch (error) {
      setStatus(`头像上传失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textDark]}>账号设置</Text>
      </View>

      <View style={[styles.section, isDark && styles.sectionDark]}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>口袋48 验证码登录</Text>
        <TextInput style={[styles.input, isDark && styles.inputDark]} placeholder="手机号" placeholderTextColor="#5a5a5a" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        <TextInput style={[styles.input, isDark && styles.inputDark]} placeholder="短信验证码" placeholderTextColor="#5a5a5a" keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={8} />
        <View style={styles.btnRow}>
          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleSendSms} disabled={loading}>
            <Text style={styles.btnText}>获取验证码</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnPrimary, loading && styles.btnDisabled]} onPress={handleLogin} disabled={loading}>
            <Text style={styles.btnText}>登录</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.section, isDark && styles.sectionDark]}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>口袋48 Token 登录</Text>
        <TextInput
          style={[styles.input, styles.tokenInput, isDark && styles.inputDark]}
          placeholder="粘贴口袋 token"
          placeholderTextColor="#5a5a5a"
          value={manualToken}
          onChangeText={setManualToken}
          multiline
        />
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btnPrimary} onPress={handleSaveManualToken}>
            <Text style={styles.btnText}>保存 Token</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={handleCheckToken}>
            <Text style={styles.btnText}>检查 Token</Text>
          </TouchableOpacity>
        </View>
        {settings.p48Token ? <Text style={styles.tokenInfo}>已保存 Token：{settings.p48Token.slice(0, 24)}...</Text> : null}
      </View>

      <View style={[styles.section, isDark && styles.sectionDark]}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>B站登录</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={handleBiliQr}>
          <Text style={styles.btnText}>获取 B站登录二维码</Text>
        </TouchableOpacity>
        {qrHtml ? <WebView source={{ html: qrHtml }} style={styles.qr} originWhitelist={['*']} scrollEnabled={false} /> : null}
        {settings.bilibiliCookie ? <Text style={styles.tokenInfo}>B站已登录</Text> : null}
      </View>

      <View style={[styles.section, isDark && styles.sectionDark]}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>{'\u53e3\u888b\u8d44\u6599'}</Text>
        {renameCountText ? <Text style={[styles.metaLine, isDark && styles.textSubDark]}>{renameCountText}</Text> : null}
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder={'\u6635\u79f0'}
          placeholderTextColor="#5a5a5a"
          value={profileName}
          onChangeText={setProfileName}
        />
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder={'\u5934\u50cf URL'}
          placeholderTextColor="#5a5a5a"
          value={profileAvatar}
          onChangeText={setProfileAvatar}
          autoCapitalize="none"
        />
        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled, { marginBottom: 10 }]} onPress={handlePickAvatar} disabled={loading}>
          <Text style={styles.btnText}>选择本地图片更换头像</Text>
        </TouchableOpacity>
        <View style={styles.btnRow}>
          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleLoadProfile} disabled={loading}>
            <Text style={styles.btnText}>{'\u8bfb\u53d6\u8d44\u6599'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnPrimary, loading && styles.btnDisabled]} onPress={handleEditProfile} disabled={loading}>
            <Text style={styles.btnText}>{'\u4fdd\u5b58\u4fee\u6539'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.section, isDark && styles.sectionDark]}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>鸡腿充值</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={() => (navigation as any).navigate('RechargeScreen')}>
          <Text style={styles.btnText}>打开官方充值页</Text>
        </TouchableOpacity>
      </View>

      {status ? <Text style={[styles.status, isDark && styles.textSubDark]}>{status}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  content: { paddingBottom: 32 },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#ff6f91' },
  section: { padding: 16, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 16, marginTop: 16, borderRadius: 18 },
  sectionDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 12 },
  input: { padding: 12, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)', backgroundColor: 'rgba(255,255,255,0.50)', color: '#333', marginBottom: 10, fontSize: 14 },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#eee' },
  tokenInput: { minHeight: 86, textAlignVertical: 'top' },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, padding: 12, borderRadius: 18, backgroundColor: '#4a4a4a', alignItems: 'center' },
  btnPrimary: { flex: 1, padding: 12, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center' },
  btnDisabled: { opacity: 0.55 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  status: { margin: 16, fontSize: 13, color: '#444', textAlign: 'center', lineHeight: 20 },
  tokenInfo: { marginTop: 10, fontSize: 12, color: '#4caf50' },
  metaLine: { marginTop: -4, marginBottom: 10, fontSize: 12, color: '#4a4a4a' },
  qr: { width: 220, height: 220, alignSelf: 'center', marginTop: 12 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
