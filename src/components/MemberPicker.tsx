import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { PerfFlatList } from './PerfFlatList';
import { CenterSpinner } from './Loaders';
import { NetworkImage } from './NetworkImage';
import { ScalePressable } from './Motion';
import { FilterChips } from './FilterChips';
import { useMemberStore } from '../store';
import { Member } from '../types';
import { normalizeMember, memberSearchText, isRoomMember } from '../utils/members';
import { normalizeUrl } from '../utils/data';
import { useI18n } from '../i18n';
import { usePalette, radii, spacing } from '../theme';
import { typography } from '../theme/typography';
import { Pill } from './Pill';
import { SearchBar } from './SearchBar';

interface MemberPickerProps {
  selectedMember: Member | null;
  onSelect: (_member: Member) => void;
  placeholder?: string;
  limit?: number;
  activeOnly?: boolean;

  compact?: boolean;

  quickMembers?: Member[];

  showTeams?: boolean;

  collapsible?: boolean;
}

function memberShortName(member: Member): string {
  return member.ownerName.split('-').pop() || member.ownerName;
}

export default function MemberPicker({
  selectedMember,
  onSelect,
  placeholder = '搜索成员...',
  limit = 10,
  activeOnly = true,
  compact = false,
  quickMembers,
  showTeams = false,
  collapsible = false,
}: MemberPickerProps) {
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((state) => state.members);
  const membersLoaded = useMemberStore((state) => state.membersLoaded);
  const [query, setQuery] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('全部');
  const [expanded, setExpanded] = useState(!selectedMember);
  const ph = placeholder === '搜索成员...' ? t('搜索成员...') : placeholder;

  useEffect(() => {
    if (!collapsible) return;
    if (!selectedMember) setExpanded(true);
  }, [collapsible, selectedMember]);

  const teamOptions = useMemo(() => {
    if (!showTeams) return [];
    const seen = new Set<string>();
    const list: string[] = [];
    for (const m of members) {
      if (activeOnly && !isRoomMember(m)) continue;
      const g = String(m.groupName || '').trim();
      if (!g || seen.has(g)) continue;
      seen.add(g);
      list.push(g);
    }
    const order = ['SNH48', 'GNZ48', 'BEJ48', 'CKG48', 'CGT48'];
    list.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return ['全部', ...list];
  }, [members, showTeams, activeOnly]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hasTeamFilter = showTeams && selectedTeam !== '全部';
    if (!q && !hasTeamFilter) return [];
    const list = members.filter(
      (member) =>
        (!activeOnly || isRoomMember(member)) &&
        (!hasTeamFilter || String(member.groupName || '').trim() === selectedTeam) &&
        (!q || memberSearchText(member).includes(q)),
    );
    const maxItems = hasTeamFilter && !q ? Math.max(limit, 36) : limit;
    return list.slice(0, maxItems);
  }, [members, query, limit, activeOnly, showTeams, selectedTeam]);

  const showQuick =
    !query.trim() &&
    (!showTeams || selectedTeam === '全部') &&
    Array.isArray(quickMembers) &&
    quickMembers.length > 0;
  const visibleList = showQuick ? quickMembers! : filtered;
  const sidePad = compact ? 0 : spacing.md;

  if (collapsible && selectedMember && !expanded) {
    const avatarUri = normalizeUrl(selectedMember.avatar || '');
    return (
      <View style={[styles.wrap, sidePad === 0 && styles.wrapCompact]}>
        <View
          style={[
            styles.pickedCard,
            {
              backgroundColor: palette.fill2,
              borderColor: palette.tint,
            },
          ]}
        >
          {avatarUri ? (
            <NetworkImage
              source={{ uri: avatarUri }}
              style={[styles.pickedAvatar, { backgroundColor: palette.fill3 }]}
              fallbackIcon="account"
              thumbnail={120}
            />
          ) : (
            <View
              style={[
                styles.pickedAvatar,
                styles.avatarFallback,
                { backgroundColor: palette.fill3 },
              ]}
            >
              <MaterialCommunityIcons name="account" size={20} color={palette.labelTertiary} />
            </View>
          )}
          <View style={styles.pickedMeta}>
            <Text style={[styles.pickedName, { color: palette.label }]} numberOfLines={1}>
              {memberShortName(selectedMember)}
            </Text>
            {selectedMember.groupName || selectedMember.team ? (
              <Text style={[styles.pickedSub, { color: palette.labelSecondary }]} numberOfLines={1}>
                {[selectedMember.groupName, selectedMember.team].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <Pill label={t('更换')} selected onPress={() => setExpanded(true)} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, sidePad === 0 && styles.wrapCompact]}>
      <View style={styles.searchRow}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={ph}
          style={[styles.searchBar, { marginHorizontal: sidePad }]}
        />
        {collapsible && selectedMember ? (
          <Pill label={t('收起')} onPress={() => setExpanded(false)} />
        ) : null}
      </View>

      {showTeams && teamOptions.length > 1 ? (
        <FilterChips
          items={teamOptions.map((g) => ({ key: g, label: g === '全部' ? t('全部') : g }))}
          value={selectedTeam}
          onSelect={setSelectedTeam}
          style={[styles.teamBar, { marginHorizontal: sidePad }]}
        />
      ) : null}

      {!membersLoaded ? (
        <View style={styles.loading}>
          <CenterSpinner />
        </View>
      ) : null}

      {showQuick ? (
        <View style={[styles.quickHead, { paddingHorizontal: sidePad }]}>
          <Text style={[styles.sectionHint, { color: palette.labelSecondary }]}>
            {t('常用成员')}
          </Text>
        </View>
      ) : null}

      {visibleList.length > 0 ? (
        showTeams || showQuick ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.chipList, { paddingHorizontal: sidePad }]}
          >
            {visibleList.map((item) => {
              const active = selectedMember?.id === item.id;
              const avatarUri = normalizeUrl(item.avatar || '');
              return (
                <ScalePressable
                  key={item.id}
                  pressedScale={0.96}
                  activeOpacity={0.85}
                  onPress={() => {
                    Keyboard.dismiss();
                    onSelect(normalizeMember(item));
                    if (collapsible) setExpanded(false);
                  }}
                  style={[
                    styles.memberCardChip,
                    {
                      backgroundColor: active ? palette.tintSoft : palette.fill2,
                      borderColor: active ? palette.tint : palette.hairline,
                    },
                  ]}
                >
                  {avatarUri ? (
                    <NetworkImage
                      source={{ uri: avatarUri }}
                      style={[styles.chipAvatar, { backgroundColor: palette.fill3 }]}
                      fallbackIcon="account"
                      thumbnail={96}
                    />
                  ) : (
                    <View
                      style={[
                        styles.chipAvatar,
                        styles.avatarFallback,
                        { backgroundColor: palette.fill3 },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="account"
                        size={14}
                        color={palette.labelTertiary}
                      />
                    </View>
                  )}
                  <View style={styles.chipTextCol}>
                    <Text
                      style={[styles.chipName, { color: active ? palette.tint : palette.label }]}
                      numberOfLines={1}
                    >
                      {memberShortName(item)}
                    </Text>
                    {item.groupName ? (
                      <Text
                        style={[styles.chipTeam, { color: palette.labelTertiary }]}
                        numberOfLines={1}
                      >
                        {item.groupName}
                      </Text>
                    ) : null}
                  </View>
                </ScalePressable>
              );
            })}
          </ScrollView>
        ) : (
          <PerfFlatList
            horizontal
            data={visibleList}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.chipList, { paddingHorizontal: sidePad }]}
            renderItem={({ item }) => (
              <Pill
                label={memberShortName(item)}
                selected={selectedMember?.id === item.id}
                onPress={() => {
                  Keyboard.dismiss();
                  onSelect(normalizeMember(item));
                  if (collapsible) setExpanded(false);
                }}
              />
            )}
          />
        )
      ) : membersLoaded && (query.trim() || (showTeams && selectedTeam !== '全部')) ? (
        <Text
          style={[
            typography.footnote,
            styles.emptyText,
            { color: palette.labelTertiary, marginHorizontal: sidePad },
          ]}
        >
          {t('没有找到匹配的成员')}
        </Text>
      ) : membersLoaded && showTeams ? (
        <Text
          style={[
            typography.footnote,
            styles.emptyText,
            { color: palette.labelTertiary, marginHorizontal: sidePad },
          ]}
        >
          {t('按分团浏览或输入关键词')}
        </Text>
      ) : null}

      {selectedMember && !collapsible ? (
        <Text
          style={[
            typography.footnote,
            styles.selectedBar,
            { color: palette.tint, marginHorizontal: sidePad },
          ]}
        >
          {t('已选成员：')}
          {selectedMember.ownerName}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 4 },
  wrapCompact: { marginVertical: 0 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBar: { flex: 1, marginBottom: 4 },
  teamBar: { marginTop: 6, marginBottom: 4 },
  quickHead: { marginTop: 6, marginBottom: 2 },
  sectionHint: { fontSize: 12, fontWeight: '600' },
  loading: { paddingVertical: 8 },
  chipList: { paddingVertical: 8, gap: 8, alignItems: 'center' },
  memberCardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 44,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipAvatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  chipTextCol: { maxWidth: 96 },
  chipName: { fontSize: 13, fontWeight: '700' },
  chipTeam: { fontSize: 10, marginTop: 1 },
  emptyText: { marginTop: 6 },
  selectedBar: { marginTop: 4 },
  pickedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickedAvatar: { width: 38, height: 38, borderRadius: 19 },
  pickedMeta: { flex: 1, minWidth: 0 },
  pickedName: { fontSize: 15, fontWeight: '700' },
  pickedSub: { fontSize: 12, marginTop: 2 },
});
