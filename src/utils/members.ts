import { Member } from '../types';

let memberDatabase: Member[] = [];
let memberMap: Map<string, Member> = new Map();

function text(value: any): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

export function normalizeMember(raw: any): Member {
  return {
    ...raw,
    id: text(raw?.id || raw?.memberId || raw?.userId),
    ownerName: text(raw?.ownerName || raw?.starName || raw?.name || raw?.nickname),
    serverId: text(raw?.serverId),
    channelId: text(raw?.channelId || raw?.roomId),
    yklzId: text(raw?.yklzId || raw?.smallRoomId || raw?.smallChannelId),
    roomId: text(raw?.roomId),
    liveRoomId: text(raw?.liveRoomId),
    team: text(raw?.team),
    pinyin: text(raw?.pinyin),
    avatar: text(raw?.avatar),
    groupName: text(raw?.groupName),
    teamId: text(raw?.teamId),
    isInGroup: raw?.isInGroup !== false,
  };
}

export async function loadMembers(json?: any): Promise<Member[]> {
  let arr: any[] = [];
  if (Array.isArray(json)) arr = json;
  else if (json) {
    arr = json.roomId || json.data || json.content || json.list || json.members || [];
  }
  memberDatabase = arr
    .filter((m: any) => m && (m.id || m.memberId || m.userId || m.ownerName || m.starName || m.name))
    .map(normalizeMember)
    .filter((m) => m.id && m.ownerName);
  memberMap.clear();
  for (const m of memberDatabase) {
    memberMap.set(String(m.id), m);
    if (m.serverId) memberMap.set(String(m.serverId), m);
    if (m.channelId) memberMap.set(String(m.channelId), m);
    if (m.yklzId) memberMap.set(String(m.yklzId), m);
  }
  return memberDatabase;
}

export function searchMembers(query: string, limit = 20): Member[] {
  if (!query?.trim()) return memberDatabase.slice(0, limit);
  const q = query.trim().toLowerCase();
  return memberDatabase.filter((m) => {
    const name = m.ownerName.toLowerCase();
    const pn = (m.pinyin || '').toLowerCase();
    const team = (m.team || '').toLowerCase();
    return name.includes(q) || pn.includes(q) || team.includes(q) || m.id.includes(q);
  }).slice(0, limit);
}

export function findMember(idOrName: string): Member | undefined {
  if (!idOrName) return undefined;
  if (memberMap.has(idOrName)) return memberMap.get(idOrName);
  const results = searchMembers(idOrName, 1);
  return results[0];
}

export function findMemberByChannelId(channelId: string): Member | undefined {
  return memberDatabase.find((m) => m.channelId === channelId || m.yklzId === channelId);
}

export function getAllMembers(): Member[] { return memberDatabase; }

export function getMembersByGroup(group: string): Member[] {
  if (group === 'all') return memberDatabase;
  return memberDatabase.filter((m) => m.groupName === group);
}

export function getMemberCount(): number { return memberDatabase.length; }
