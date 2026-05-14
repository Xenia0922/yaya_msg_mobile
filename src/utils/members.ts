import { Member } from '../types';

let memberDatabase: Member[] = [];
let memberMap: Map<string, Member> = new Map();

function text(value: any): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function fallbackMemberId(raw: any): string {
  return text(
    raw?.id
      || raw?.memberId
      || raw?.userId
      || raw?.starId
      || raw?.channelId
      || raw?.roomId
      || raw?.yklzId
      || raw?.smallRoomId
      || raw?.account
      || raw?.ownerName
      || raw?.starName
      || raw?.name,
  );
}

export function pinyinInitials(value: any): string {
  return text(value)
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toLowerCase();
}

export function memberSearchText(member: Member): string {
  const short = member.ownerName.split('-').pop() || '';
  const rawPinyin = (member.pinyin || '').trim();
  // split camelCase: "BaoYuXin" → ["Bao","Yu","Xin"]; "baoyuxin" → ["baoyuxin"]
  const camelParts = rawPinyin.split(/(?=[A-Z])/).filter(Boolean);
  const pinyinLower = rawPinyin.toLowerCase();
  const initials = camelParts.map((p) => p[0]).join('').toLowerCase();
  const initialsSpaced = camelParts.map((p) => p[0]).join(' ').toLowerCase();
  return [
    member.ownerName,
    short,
    pinyinLower,
    initials,
    initialsSpaced,
    member.team || '',
    member.groupName || '',
    String(member.id || ''),
  ].join(' ').toLowerCase();
}

export function normalizeMember(raw: any): Member {
  return {
    ...raw,
    id: fallbackMemberId(raw),
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
    const initials = pinyinInitials(m.pinyin);
    const team = (m.team || '').toLowerCase();
    return name.includes(q) || pn.includes(q) || initials.includes(q) || team.includes(q) || m.id.includes(q);
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
