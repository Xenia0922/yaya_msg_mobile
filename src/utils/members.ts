import { Member } from '../types';

export const OFFICIAL_TEAM_LOGOS: Array<[string, string]> = [
  ['SNH48 · SII', '/mediasource/teamLogo2/all/snh48_s2.png'],
  ['SNH48 · NII', '/mediasource/teamLogo2/all/snh48_n2.png'],
  ['SNH48 · HII', '/mediasource/teamLogo2/all/snh48_h2.png'],
  ['SNH48 · X', '/mediasource/teamLogo2/all/snh48_x.png'],
  ['GNZ48 · G', '/mediasource/teamLogo2/all/gnz48_g.png'],
  ['GNZ48 · NIII', '/mediasource/teamLogo2/all/gnz48_n3.png'],
  ['GNZ48 · Z', '/mediasource/teamLogo/all/gnz_z_log2.png'],
  ['BEJ48 · B', '/mediasource/teamLogo2/all/bej48_b.png'],
  ['BEJ48 · E', '/mediasource/teamLogo2/all/bej48_e.png'],
  ['CKG48 · C', '/mediasource/teamLogo/all/ckg_c.png'],
  ['CKG48 · K', '/mediasource/teamLogo/all/ckg_k.png'],
  ['预备生', '/mediasource/teamLogo/fulllogo/snh48_team_yubeisheng.png'],
];

const TEAM_LOGO_BY_ID: Record<string, string> = {
  '1001': '/mediasource/teamLogo2/all/snh48_s2.png',
  '1002': '/mediasource/teamLogo2/all/snh48_n2.png',
  '1003': '/mediasource/teamLogo2/all/snh48_h2.png',
  '1004': '/mediasource/teamLogo2/all/snh48_x.png',
  '1007': '/mediasource/teamLogo/fulllogo/snh48_team_yubeisheng.png',
  '1101': '/mediasource/teamLogo2/all/bej48_b.png',
  '1102': '/mediasource/teamLogo2/all/bej48_e.png',
  '1104': '/mediasource/teamLogo/fulllogo/snh48_team_yubeisheng.png',
  '1201': '/mediasource/teamLogo2/all/gnz48_g.png',
  '1202': '/mediasource/teamLogo2/all/gnz48_n3.png',
  '1203': '/mediasource/teamLogo/all/gnz_z_log2.png',
  '1207': '/mediasource/teamLogo/fulllogo/snh48_team_yubeisheng.png',
  '1401': '/mediasource/teamLogo/all/ckg_c.png',
  '1402': '/mediasource/teamLogo/all/ckg_k.png',
  '1405': '/mediasource/teamLogo/fulllogo/snh48_team_yubeisheng.png',
  '2103': '/mediasource/teamLogo/fulllogo/snh48_team_yubeisheng.png',
};

const TEAM_LOGO_BY_NAME: Record<string, string> = {
  'TEAM SII': '/mediasource/teamLogo2/all/snh48_s2.png',
  'TEAM NII': '/mediasource/teamLogo2/all/snh48_n2.png',
  'TEAM HII': '/mediasource/teamLogo2/all/snh48_h2.png',
  'TEAM X': '/mediasource/teamLogo2/all/snh48_x.png',
  'TEAM G': '/mediasource/teamLogo2/all/gnz48_g.png',
  'TEAM NIII': '/mediasource/teamLogo2/all/gnz48_n3.png',
  'TEAM Z': '/mediasource/teamLogo/all/gnz_z_log2.png',
  'TEAM B': '/mediasource/teamLogo2/all/bej48_b.png',
  'TEAM E': '/mediasource/teamLogo2/all/bej48_e.png',
  'TEAM C': '/mediasource/teamLogo/all/ckg_c.png',
  'TEAM K': '/mediasource/teamLogo/all/ckg_k.png',
  预备生: '/mediasource/teamLogo/fulllogo/snh48_team_yubeisheng.png',
};

export function resolveOfficialTeamLogo(source?: {
  teamId?: string | number;
  team?: string;
  teamName?: string;
}): string {
  if (!source) return '';
  const tid = String(source.teamId ?? '').trim();
  if (tid && TEAM_LOGO_BY_ID[tid]) return TEAM_LOGO_BY_ID[tid];
  const tname = String(source.team || source.teamName || '')
    .trim()
    .toUpperCase();
  if (tname && TEAM_LOGO_BY_NAME[tname]) return TEAM_LOGO_BY_NAME[tname];
  if (tname.includes('预备生')) return TEAM_LOGO_BY_NAME.预备生;
  return '';
}

let memberDatabase: Member[] = [];
const memberMap: Map<string, Member> = new Map();

function text(value: any): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function fallbackMemberId(raw: any): string {
  return text(
    raw?.id ||
      raw?.memberId ||
      raw?.userId ||
      raw?.starId ||
      raw?.channelId ||
      raw?.roomId ||
      raw?.yklzId ||
      raw?.smallRoomId ||
      raw?.account ||
      raw?.ownerName ||
      raw?.starName ||
      raw?.name,
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

  const camelParts = rawPinyin.split(/(?=[A-Z])/).filter(Boolean);
  const pinyinLower = rawPinyin.toLowerCase();
  const initials = camelParts
    .map((p) => p[0])
    .join('')
    .toLowerCase();
  const initialsSpaced = camelParts
    .map((p) => p[0])
    .join(' ')
    .toLowerCase();
  return [
    member.ownerName,
    short,
    pinyinLower,
    initials,
    initialsSpaced,
    member.team || '',
    member.groupName || '',
    String(member.id || ''),
  ]
    .join(' ')
    .toLowerCase();
}

export function classifyMemberState(raw: any): string {
  if (raw?.state) return raw.state;
  const inGroupKnown = raw?.isInGroup !== undefined && raw?.isInGroup !== null;
  const status = Number(raw?.status ?? raw?.memberStatus);
  const team = String(raw?.teamName || raw?.team || '');
  if (inGroupKnown) {
    if (raw.isInGroup === false) {
      if (status === 1) return 'graduated';
      if (status === 2) return 'left';
      if (status === 3) return 'paused';

      return 'graduated';
    }

    if (status === 2) return 'left';
    if (status === 3) return 'paused';
    return 'active';
  }

  if (status === 2) return 'left';
  if (status === 3) return 'paused';
  if (status === 1) {
    if (team.indexOf('荣誉毕业生') >= 0 || team.indexOf('明星殿堂') >= 0) return 'graduated';
    return 'active';
  }
  if (status === 0) return 'active';
  return 'unknown';
}

export function isRoomMember(member: Pick<Member, 'isInGroup' | 'state'>): boolean {
  return member.isInGroup !== false && member.state !== 'left' && member.state !== 'graduated';
}

export function normalizeMember(raw: any): Member {
  return {
    ...raw,
    id: fallbackMemberId(raw),
    ownerName: text(raw?.ownerName || raw?.starName || raw?.name || raw?.realName || raw?.nickname),
    serverId: text(raw?.serverId),
    channelId: text(raw?.channelId || raw?.roomId),
    yklzId: text(raw?.yklzId || raw?.smallRoomId || raw?.smallChannelId),
    roomId: text(raw?.roomId),
    liveRoomId: text(raw?.liveRoomId),
    team: text(raw?.team || raw?.teamName),
    pinyin: text(raw?.pinyin),
    avatar: text(raw?.avatar),
    groupName: text(raw?.groupName),
    teamId: text(raw?.teamId),
    teamLogo: text(raw?.teamLogo || raw?.teamLogoUrl) || resolveOfficialTeamLogo(raw),
    isInGroup: raw?.isInGroup !== false,
    state: classifyMemberState(raw),
  };
}

export function appendOfficialGroupMembers(members: Member[], official: any[]): Member[] {
  const groups = new Set(['SNH48', 'GNZ48', 'BEJ48', 'CKG48', 'CGT48', 'SHY48']);
  const ids = new Set(members.map((member) => String(member.id)));
  const result = [...members];
  for (const raw of official) {
    if (!groups.has(String(raw?.groupName || ''))) continue;
    const member = normalizeMember(raw);
    if (!member.id || !member.ownerName || ids.has(member.id)) continue;
    ids.add(member.id);
    result.push(member);
  }
  return result;
}

export async function loadMembers(json?: any): Promise<Member[]> {
  let arr: any[] = [];
  if (Array.isArray(json)) arr = json;
  else if (json) {
    arr = json.roomId || json.data || json.content || json.list || json.members || [];
  }
  memberDatabase = arr
    .filter(
      (m: any) => m && (m.id || m.memberId || m.userId || m.ownerName || m.starName || m.name),
    )
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
  return memberDatabase
    .filter((m) => {
      const name = m.ownerName.toLowerCase();
      const pn = (m.pinyin || '').toLowerCase();
      const initials = pinyinInitials(m.pinyin);
      const team = (m.team || '').toLowerCase();
      return (
        name.includes(q) ||
        pn.includes(q) ||
        initials.includes(q) ||
        team.includes(q) ||
        m.id.includes(q)
      );
    })
    .slice(0, limit);
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

export function getAllMembers(): Member[] {
  return memberDatabase;
}

export function getMembersByGroup(group: string): Member[] {
  if (group === 'all') return memberDatabase;
  return memberDatabase.filter((m) => m.groupName === group);
}

export function getMemberCount(): number {
  return memberDatabase.length;
}
