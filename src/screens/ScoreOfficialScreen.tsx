import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore, useUiStore } from '../store';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';
import { SkeletonList } from '../components/Skeleton';

export default function ScoreOfficialScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const showToast = useUiStore((state) => state.showToast);
  const settings = useSettingsStore((state) => state.settings);

  const [appToken, setAppToken] = useState(settings.p48Token || '');
  const [voteToken, setVoteToken] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-login if token exists
  useEffect(() => {
    if (settings.p48Token && !isLoggedIn) {
      setAppToken(settings.p48Token);
    }
  }, [settings.p48Token]);

  const [voteStatus, setVoteStatus] = useState<any>(null);
  const [actStatus, setActStatus] = useState<any>(null);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [treasures, setTreasures] = useState<any[]>([]);
  const [starList, setStarList] = useState<any[]>([]);
  const [voteHistory, setVoteHistory] = useState<any[]>([]);
  const [sgBindStatus, setSgBindStatus] = useState<any>(null);
  const [sgCode, setSgCode] = useState('');

  const buildPayload = useCallback(() => ({
    voteToken, appToken, token: appToken, pocketToken: appToken,
  }), [voteToken, appToken]);

  const handleLogin = async () => {
    if (!appToken.trim()) { setError('请先输入或设置 App Token'); return; }
    setLoading(true); setError('');
    try {
      const res = await pocketApi.loginElectionVote(buildPayload());
      const data = res?.content || res?.data || {};
      const token = data?.voteToken || data?.token || data?.authorization || '';
      if (token) {
        setVoteToken(token.replace(/^Bearer\s+/i, ''));
        setIsLoggedIn(true);
        showToast('计分登录成功');
      } else { setError('未获取到访问凭证'); }
    } catch (e: any) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  };

  const loadBundle = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const payload = buildPayload();
      const [vs, as_, ui, tr, sl, vh, sg] = await Promise.all([
        pocketApi.getElectionVoteStatus(payload).catch(() => null),
        pocketApi.getElectionActStatus(payload).catch(() => null),
        pocketApi.getElectionUserInfo(payload).catch(() => null),
        pocketApi.getPageantryRareTreasures().catch(() => null),
        pocketApi.getPageantryBuyStarList().catch(() => null),
        pocketApi.getElectionVoteHistory(payload).catch(() => null),
        pocketApi.getElectionSgBindStatus(payload).catch(() => null),
      ]);
      setVoteStatus(vs?.content || vs?.data || vs);
      setActStatus(as_?.content || as_?.data || as_);
      setUserInfo(ui?.content || ui?.data || ui);
      setTreasures(unwrapList(tr?.content || tr?.data || tr));
      setStarList(unwrapList(sl?.content || sl?.data || sl));
      setVoteHistory(unwrapList(vh?.content || vh?.data || vh));
      setSgBindStatus(sg?.content || sg?.data || sg);
    } catch (e: any) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, [buildPayload]);

  const handleBindSg = async () => {
    if (!sgCode.trim()) { Alert.alert('提示', '请输入激活码'); return; }
    setLoading(true);
    try {
      await pocketApi.bindElectionSg({ ...buildPayload(), code: sgCode });
      showToast('SG绑定成功');
      setSgCode('');
      await loadBundle();
    } catch (e: any) { Alert.alert('绑定失败', errorMessage(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (isLoggedIn) loadBundle(); }, [isLoggedIn, loadBundle]);

  if (!isLoggedIn) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <ScreenHeader title="官方计分" onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={styles.loginWrap}>
          <Text style={[styles.loginTitle, isDark && styles.textLight]}>计分系统登录</Text>
          <Text style={[styles.label, isDark && styles.textSubLight]}>App Token</Text>
          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            value={appToken}
            onChangeText={setAppToken}
            placeholder="粘贴口袋48 Token"
            placeholderTextColor={isDark ? '#888' : '#999'}
            autoCapitalize="none"
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.45 }]} onPress={handleLogin} disabled={loading}>
            <Text style={styles.submitText}>{loading ? '登录中...' : '登录计分系统'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="官方计分" onBack={() => navigation.goBack()} right={
        <TouchableOpacity onPress={loadBundle}>
          <Text style={styles.headerAction}>刷新</Text>
        </TouchableOpacity>
      } />
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading && <SkeletonList count={6} dark={isDark} />}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {userInfo ? (
          <FadeInView delay={40} duration={300}>
            <View style={[styles.section, isDark && styles.sectionDark]}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>用户信息</Text>
              <Text style={[styles.sectionText, isDark && styles.textSubLight]}>
                {userInfo?.nickName || userInfo?.nickname || ''} · ID: {userInfo?.userId || userInfo?.id || ''}
              </Text>
            </View>
          </FadeInView>
        ) : null}

        {voteStatus ? (
          <FadeInView delay={60} duration={300}>
            <View style={[styles.section, isDark && styles.sectionDark]}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>投票状态</Text>
              <Text style={[styles.sectionText, isDark && styles.textSubLight]} numberOfLines={6}>
                {typeof voteStatus === 'string' ? voteStatus : JSON.stringify(voteStatus, null, 2).slice(0, 400)}
              </Text>
            </View>
          </FadeInView>
        ) : null}

        {actStatus ? (
          <FadeInView delay={80} duration={300}>
            <View style={[styles.section, isDark && styles.sectionDark]}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>活动状态</Text>
              <Text style={[styles.sectionText, isDark && styles.textSubLight]} numberOfLines={4}>
                {typeof actStatus === 'string' ? actStatus : JSON.stringify(actStatus, null, 2).slice(0, 300)}
              </Text>
            </View>
          </FadeInView>
        ) : null}

        {treasures.length > 0 ? (
          <FadeInView delay={100} duration={300}>
            <View style={[styles.section, isDark && styles.sectionDark]}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>稀有宝物 ({treasures.length})</Text>
              {treasures.map((item: any, idx: number) => (
                <View key={idx} style={[styles.listRow, isDark && styles.listRowDark]}>
                  {item.icon ? <Image source={{ uri: String(item.icon) }} style={styles.itemIcon} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.listName, isDark && styles.textLight]}>{String(item.name || '')}</Text>
                    <Text style={[styles.listMeta, isDark && styles.textSubLight]} numberOfLines={2}>{String(item.description || '')}</Text>
                  </View>
                </View>
              ))}
            </View>
          </FadeInView>
        ) : null}

        {starList.length > 0 ? (
          <FadeInView delay={120} duration={300}>
            <View style={[styles.section, isDark && styles.sectionDark]}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>计分成员 ({starList.length})</Text>
              {starList.slice(0, 20).map((item: any, idx: number) => (
                <View key={idx} style={[styles.listRow, isDark && styles.listRowDark]}>
                  <Text style={[styles.listName, isDark && styles.textLight, { flex: 1 }]} numberOfLines={1}>
                    {String(item.starName || item.name || '')}
                  </Text>
                  <Text style={styles.scoreValue}>{String(item.score || item.points || item.totalScore || '0')}</Text>
                </View>
              ))}
            </View>
          </FadeInView>
        ) : null}

        {voteHistory.length > 0 ? (
          <FadeInView delay={140} duration={300}>
            <View style={[styles.section, isDark && styles.sectionDark]}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>投票记录 ({voteHistory.length})</Text>
              {voteHistory.slice(0, 20).map((item: any, idx: number) => (
                <View key={idx} style={[styles.listRow, isDark && styles.listRowDark]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.listName, isDark && styles.textLight]} numberOfLines={1}>
                      {String(item.desc || item.name || item.title || '')}
                    </Text>
                    <Text style={[styles.listMeta, isDark && styles.textSubLight]}>
                      {item.time ? new Date(Number(item.time)).toLocaleDateString() : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </FadeInView>
        ) : null}

        <FadeInView delay={160} duration={300}>
          <View style={[styles.section, isDark && styles.sectionDark]}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>SG 绑定</Text>
            {sgBindStatus ? (
              <Text style={[styles.sectionText, isDark && styles.textSubLight]} numberOfLines={3}>
                {typeof sgBindStatus === 'string' ? sgBindStatus : JSON.stringify(sgBindStatus).slice(0, 200)}
              </Text>
            ) : null}
            <TextInput
              style={[styles.input, isDark && styles.inputDark, { marginTop: 8 }]}
              value={sgCode}
              onChangeText={setSgCode}
              placeholder="输入激活码"
              placeholderTextColor={isDark ? '#888' : '#999'}
            />
            <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.45 }]} onPress={handleBindSg} disabled={loading}>
              <Text style={styles.submitText}>绑定 SG</Text>
            </TouchableOpacity>
          </View>
        </FadeInView>

        <TouchableOpacity style={styles.logoutBtn} onPress={() => { setIsLoggedIn(false); setVoteToken(''); }}>
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  loginWrap: { padding: 24, paddingTop: 20 },
  loginTitle: { fontSize: 20, fontWeight: '800', color: '#333333', marginBottom: 16, textAlign: 'center' },
  scroll: { padding: 12, paddingBottom: 60 },
  section: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
  },
  sectionDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.10)' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#333333', marginBottom: 8 },
  sectionText: { fontSize: 13, color: '#555555', lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#555555', marginBottom: 4, marginTop: 8 },
  input: {
    padding: 10, borderRadius: 16, fontSize: 14, color: '#333333',
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
  },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.68)', borderColor: 'rgba(255,255,255,0.14)', color: '#eeeeee' },
  submitBtn: { backgroundColor: '#ff6f91', borderRadius: 20, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.12)' },
  listRowDark: { borderBottomColor: 'rgba(255,255,255,0.08)' },
  listName: { fontSize: 14, fontWeight: '700', color: '#333333' },
  listMeta: { fontSize: 12, color: '#555555', marginTop: 2 },
  itemIcon: { width: 32, height: 32, borderRadius: 8, marginRight: 10, backgroundColor: 'rgba(128,128,128,0.10)' },
  scoreValue: { fontSize: 15, fontWeight: '800', color: '#ff6f91' },
  errorText: { color: '#ff6f91', fontSize: 13, marginBottom: 8 },
  logoutBtn: { alignSelf: 'center', paddingVertical: 20 },
  logoutText: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
