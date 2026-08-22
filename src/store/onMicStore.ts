import { create } from 'zustand';
import pocketApi from '../api/pocket48';

export interface OnMicMemberInput {
  memberId: string;
  name: string;
  channelId: string;
  serverId: string;
  smallChannelId?: string;
}

export interface OnMicEntry {
  memberId: string;
  name: string;
  channelId: string;
  serverId: string;
  smallChannelId: string;
  /** 房间电台音频流已开启（streamUrl 存在） */
  hasRadio: boolean;
  /** 当前在麦（语音）人数 */
  onMicCount: number;
}

interface OnMicState {
  /** 以 memberId 为键的上麦成员表 */
  onMic: Record<string, OnMicEntry>;
  scanning: boolean;
  lastScan: number;
  scan: (members: OnMicMemberInput[]) => Promise<void>;
  clear: () => void;
}

/**
 * 判断某成员的 `team/voice/operate`(operateCode=2) 返回内容是否处于「上麦中」：
 *  - content.streamUrl 非空 → 房间电台音频流已开（有人在麦上播音）
 *  - content.voiceUserList 中存在 voiceStatus !== false 的用户 → 有人在语音麦上
 * 两者任一满足即视为上麦中。
 */
function parseOnMic(content: any): { hasRadio: boolean; onMicCount: number } {
  if (!content) return { hasRadio: false, onMicCount: 0 };
  const hasRadio = !!content.streamUrl;
  const list = Array.isArray(content.voiceUserList) ? content.voiceUserList : [];
  const onMicCount = list.filter((u: any) => u && u.voiceStatus !== false).length;
  return { hasRadio, onMicCount };
}

export const useOnMicStore = create<OnMicState>((set, get) => ({
  onMic: {},
  scanning: false,
  lastScan: 0,
  scan: async (members) => {
    if (!members || members.length === 0) return;
    // 避免重复扫描相互覆盖
    if (get().scanning) return;
    set({ scanning: true });
    const scannedIds = new Set(members.map((m) => m.memberId));
    const updates: Record<string, OnMicEntry> = {};
    let cursor = 0;
    const limit = 4;
    const worker = async () => {
      while (cursor < members.length) {
        const m = members[cursor++];
        try {
          const res: any = await pocketApi.operateRoomVoice({ channelId: m.channelId, serverId: m.serverId });
          const content = res?.content || (res?.data && res.data.content) || {};
          const { hasRadio, onMicCount } = parseOnMic(content);
          if (hasRadio || onMicCount > 0) {
            updates[m.memberId] = {
              memberId: m.memberId,
              name: m.name,
              channelId: m.channelId,
              serverId: m.serverId,
              smallChannelId: m.smallChannelId || '',
              hasRadio,
              onMicCount,
            };
          }
        } catch {
          // 单个成员查询失败（未登录 / 无权限 / 网络）忽略，不阻断整体扫描
        }
      }
    };
    const workers = Array.from({ length: Math.min(limit, members.length) }, () => worker());
    await Promise.all(workers);
    // 合并而非整体替换：仅更新本次扫描到的成员（在麦则写入、已下麦则移除），
    // 其余成员状态保持不变，避免单次单成员扫描清空整张表。
    set((s) => {
      const next: Record<string, OnMicEntry> = { ...s.onMic };
      scannedIds.forEach((id) => { if (!(id in updates)) delete next[id]; });
      Object.assign(next, updates);
      return { onMic: next, scanning: false, lastScan: Date.now() };
    });
  },
  clear: () => set({ onMic: {}, scanning: false, lastScan: 0 }),
}));
