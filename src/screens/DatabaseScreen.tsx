import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useSettingsStore, useMemberStore } from '../store';
import { Member } from '../types';
import { externalApi } from '../api/external';
import { loadMembers } from '../utils/members';

type Nav = StackNavigationProp<RootStackParamList, 'DatabaseScreen'>;

function memberActive(member: Member) {
  return member.isInGroup !== false && !/毕业|暂休|海外/.test(`${member.team} ${member.groupName}`);
}

function fieldValue(value: any) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function memberFields(member: Member) {
  const raw = member as any;
  return [
    ['成员ID', member.id],
    ['大房间', member.channelId],
    ['小房间', member.yklzId],
    ['服务器', member.serverId],
    ['直播间', member.liveRoomId],
    ['roomId', member.roomId],
    ['队伍ID', member.teamId],
    ['拼音', member.pinyin],
    ['昵称', raw.nickname || raw.nickName],
    ['SNH48 ID', raw.snh48Id || raw.snhId],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
}

export default function DatabaseScreen() {
  const navigation = useNavigation<Nav>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const setStoreMembers = useMemberStore((s) => s.setMembers);
  const storeMembers = useMemberStore((s) => s.members);
  const [members, setMembers] = useState<Member[]>(storeMembers);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('全部');
  const [status, setStatus] = useState('正在读取成员库...');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const backup = require('../../assets/members.json');
        const localMembers = await loadMembers(backup);
        if (!alive) return;
        setMembers(localMembers);
        setStoreMembers(localMembers);
        setStatus(`已加载随包成员库：${localMembers.length} 位`);

        const raw = await externalApi.fetchMembers();
        const normalized = await loadMembers(raw);
        if (!alive) return;
        if (normalized.length >= localMembers.length) {
          setMembers(normalized);
          setStoreMembers(normalized);
          setStatus(`已同步线上成员库：${normalized.length} 位`);
        } else {
          setStatus(`线上成员库较旧（${normalized.length} 位），继续使用随包 ${localMembers.length} 位`);
        }
      } catch (error: any) {
        if (!alive) return;
        setMembers(storeMembers);
        setStatus(`使用本地已加载成员库：${storeMembers.length} 位${error?.message ? ` · ${error.message}` : ''}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setStoreMembers]);

  const groups = useMemo(() => {
    const names = Array.from(new Set(members.map((m) => m.groupName || '其他').filter(Boolean)));
    return ['全部', ...names.sort()];
  }, [members]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members
      .filter((m) => groupFilter === '全部' || (m.groupName || '其他') === groupFilter)
      .filter((m) => {
        if (!q) return true;
        return `${m.ownerName} ${m.pinyin} ${m.team} ${m.groupName} ${m.id}`.toLowerCase().includes(q);
      })
      .sort((a, b) => Number(memberActive(b)) - Number(memberActive(a)) || (a.groupName || '').localeCompare(b.groupName || '') || (a.team || '').localeCompare(b.team || '') || a.ownerName.localeCompare(b.ownerName));
  }, [members, groupFilter, search]);

  const activeCount = members.filter(memberActive).length;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <View>
          <Text style={[styles.title, isDark && styles.textLight]}>数据库</Text>
          <Text style={styles.count}>总计 {members.length} 位 · 在团 {activeCount} 位</Text>
        </View>
      </View>

      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="搜索成员、拼音、队伍、ID..."
        placeholderTextColor="#5a5a5a"
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.groupBar}>
        <FlatList
          horizontal
          data={groups}
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.chip, groupFilter === item && styles.chipActive]} onPress={() => setGroupFilter(item)}>
              <Text style={[styles.chipText, groupFilter === item && styles.chipTextActive]}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <Text style={[styles.status, isDark && styles.textSubDark]}>{status}</Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.memberRow, isDark && styles.memberRowDark, !memberActive(item) && styles.inactiveRow]}>
            <View style={styles.memberMain}>
              <Text style={[styles.memberName, isDark && styles.textLight]}>{item.ownerName}</Text>
              <Text style={[styles.memberMeta, isDark && styles.textSubDark]}>
                {[item.groupName, item.team, item.pinyin].filter(Boolean).join(' · ')}
              </Text>
              <View style={styles.fieldGrid}>
                {memberFields(item).map(([label, value]) => (
                  <View key={`${item.id}-${label}`} style={styles.fieldChip}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <Text style={styles.fieldText} numberOfLines={1}>{fieldValue(value)}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.memberRight}>
              <Text style={memberActive(item) ? styles.activeTag : styles.inactiveTag}>{memberActive(item) ? '在团' : '非在团'}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>没有匹配成员</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 16 },
  backBtn: { color: '#ff6f91', fontSize: 14, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', color: '#ff6f91' },
  count: { fontSize: 12, color: '#333333', marginTop: 2 },
  input: { marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.58)', backgroundColor: 'rgba(255,255,255,0.72)', color: '#333' },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.62)', borderColor: '#444', color: '#eeeeee' },
  groupBar: { paddingHorizontal: 12, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.62)', marginHorizontal: 4 },
  chipActive: { backgroundColor: '#ff6f91' },
  chipText: { fontSize: 12, color: '#444', fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  status: { marginHorizontal: 16, marginBottom: 8, color: '#333333', fontSize: 12 },
  listContent: { paddingBottom: 120 },
  memberRow: { marginHorizontal: 16, marginVertical: 5, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)', flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  memberRowDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.12)' },
  inactiveRow: { opacity: 0.62 },
  memberMain: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 15, fontWeight: '800', color: '#333' },
  memberMeta: { fontSize: 11, color: '#333333', marginTop: 3 },
  memberRight: { alignItems: 'flex-end', gap: 4 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  fieldChip: { maxWidth: '48%', minWidth: '30%', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(255,111,145,0.10)' },
  fieldLabel: { fontSize: 9, color: '#ff6f91', fontWeight: '800', marginBottom: 2 },
  fieldText: { fontSize: 10, color: '#555', fontWeight: '700' },
  activeTag: { fontSize: 10, color: '#fff', backgroundColor: '#20a464', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  inactiveTag: { fontSize: 10, color: '#fff', backgroundColor: '#5a5a5a', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  textLight: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
  empty: { textAlign: 'center', color: '#333333', marginTop: 60, fontSize: 14 },
});
