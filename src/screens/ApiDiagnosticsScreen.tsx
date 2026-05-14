import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import MemberPicker from '../components/MemberPicker';
import { RootStackParamList } from '../navigation/types';
import ScreenHeader from '../components/ScreenHeader';
import pocketApi from '../api/pocket48';
import { useMemberStore, useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import { Member } from '../types';
import { errorMessage, unwrapList } from '../utils/data';
import { checkNetworkStatus } from '../utils/network';
import { isWasmReady, getWasmError } from '../auth';

type Nav = StackNavigationProp<RootStackParamList, 'ApiDiagnosticsScreen'>;

type Row = {
  key: string;
  title: string;
  ok: boolean;
  detail: string;
};

function contentCount(res: any, keys: string[]) {
  return unwrapList(res, keys).length;
}

function statusOf(res: any) {
  return `status=${res?.status ?? res?.code ?? 'n/a'} success=${String(res?.success ?? 'n/a')}`;
}

async function runCase(title: string, fn: () => Promise<string>): Promise<Row> {
  try {
    const detail = await fn();
    return { key: title, title, ok: true, detail };
  } catch (error) {
    return { key: title, title, ok: false, detail: errorMessage(error) };
  }
}

export default function ApiDiagnosticsScreen() {
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const token = useSettingsStore((state) => state.settings.p48Token);
  const members = useMemberStore((state) => state.members);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const memberSummary = useMemo(() => {
    const withChannel = members.filter((item) => item.channelId).length;
    const withServer = members.filter((item) => item.serverId).length;
    return `members=${members.length} channelId=${withChannel} serverId=${withServer}`;
  }, [members]);

  const runDiagnostics = async () => {
    setRunning(true);
    setRows([]);
    const member = selectedMember;
    const output: Row[] = [];

    output.push({
      key: 'local',
      title: 'Local state',
      ok: members.length > 0,
      detail: `${memberSummary}\ntoken=${token ? 'saved' : 'missing'} signer=${isWasmReady() ? 'ready' : getWasmError() || 'not ready'}`,
    });

    output.push(await runCase('Network probe', async () => {
      const report = await checkNetworkStatus();
      return report.results.map((item) => `${item.name}: ${item.message}`).join('\n');
    }));

    output.push(await runCase('Official video list', async () => {
      const res = await pocketApi.getOfficialVideoList({ ctime: 0, typeId: 0, groupId: 0, limit: 5 });
      return `${statusOf(res)} count=${contentCount(res, ['content.data', 'content.list', 'list'])}`;
    }));

    output.push(await runCase('Official music list', async () => {
      const res = await pocketApi.getOfficialMusicList({ ctime: 0, limit: 5 });
      return `${statusOf(res)} count=${contentCount(res, ['content.data', 'content.list', 'list'])}`;
    }));

    output.push(await runCase('Official talk list', async () => {
      const res = await pocketApi.getOfficialTalkList({ ctime: 0, groupId: 0, limit: 5 });
      return `${statusOf(res)} count=${contentCount(res, ['content.data', 'content.list', 'list'])}`;
    }));

    if (member) {
      output.push(await runCase('Room messages all', async () => {
        const res = await pocketApi.getRoomMessages({
          channelId: member.channelId,
          serverId: member.serverId,
          nextTime: 0,
          fetchAll: true,
        });
        return `${statusOf(res)} via=${res?._request?.label || 'default'} channelId=${member.channelId} serverId=${member.serverId || '(auto)'} count=${contentCount(res, ['content.messageList', 'content.message', 'content.list', 'messageList', 'message', 'list'])}`;
      }));

      output.push(await runCase('Room album', async () => {
        const res = await pocketApi.getRoomAlbum({ channelId: member.channelId, nextTime: 0 });
        return `${statusOf(res)} count=${contentCount(res, ['content.messageList', 'content.message', 'content.list', 'messageList', 'message', 'list'])}`;
      }));

      output.push(await runCase('Room radio', async () => {
        const res = await pocketApi.operateRoomVoice({ channelId: member.channelId, serverId: member.serverId });
        return `${statusOf(res)} contentKeys=${Object.keys(res?.content || {}).join(',') || 'none'}`;
      }));
    }

    setRows(output);
    setRunning(false);
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="接口自检" />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text style={[styles.label, isDark && styles.textLight]}>暂无数据</Text>
          <MemberPicker selectedMember={selectedMember} onSelect={setSelectedMember} limit={40} />
          <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={runDiagnostics} disabled={running}>
            <Text style={styles.buttonText}>{running ? '检测中...' : '开始接口自检'}</Text>
          </TouchableOpacity>
        </View>

        {running ? <ActivityIndicator color="#ff6f91" style={{ padding: 16 }} /> : null}

        <FadeInView delay={80} duration={300}>
          <FlatList
            data={rows}
            scrollEnabled={false}
            keyExtractor={(item) => item.key}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            renderItem={({ item, index }) => (
              <FadeInView delay={80 + index * 30} duration={300}>
                <View style={[styles.row, isDark && styles.cardDark]}>
                  <Text style={[styles.rowTitle, item.ok ? styles.ok : styles.fail]}>{item.ok ? 'OK' : 'FAIL'} · {item.title}</Text>
                  <Text style={[styles.rowDetail, isDark && styles.textSub]}>{item.detail}</Text>
                </View>
              </FadeInView>
            )}
          />
        </FadeInView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  body: { flex: 1 },
  bodyContent: { padding: 12, paddingBottom: 30 },
  card: { backgroundColor: 'rgba(255,255,255,0.46)', padding: 14, borderRadius: 16, marginBottom: 10 },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  label: { color: '#555', fontSize: 13, marginBottom: 10, lineHeight: 19 },
  button: { backgroundColor: '#ff6f91', borderRadius: 18, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  row: { backgroundColor: 'rgba(255,255,255,0.46)', padding: 12, borderRadius: 16, marginBottom: 8 },
  rowTitle: { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  rowDetail: { color: '#444', fontSize: 12, lineHeight: 18 },
  ok: { color: '#178a45' },
  fail: { color: '#d4380d' },
  textLight: { color: '#eee' },
  textSub: { color: '#eeeeee' },
});
