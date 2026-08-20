# 深色模式可见性专项审计与修复明细

审计范围：全部任务指定文件。逐文件 scan 固定色值字面量并与 `usePalette` 上下文对照，仅对有真问题的做修复；媒体封面/视频/直播上白字遮罩、全屏播放器沉浸黑底、纯遮罩 `rgba(*,0.4+)` 均属合理，保留。

## 已修复文件

### src/screens/FollowedRoomsScreen.tsx
- 消息气泡「播放/暂停」按钮文字 `mediaPlayText` 原无 color（默认黑字叠在 tint 粉底上）→ 加入 `palette.onTint`。
- 礼物图片容器 `giftImage` 白色 `#fff` 底（dark 下加载时闪白/不协调）→ 叠加 `palette.surface`。
- 其余消息区/房间列表/贡献榜均为内联 palette 主题，无需改。

### src/screens/LoginScreen.tsx
- 分段控件激活项 `segmentItemActive` 硬编码 `#FFFFFF` 底（dark 下亮白刺眼）→ 叠加 `palette.surfaceElevated`，与分段轨道 `palette.fill2` 形成正确层级。
- 二维码卡 `qrCard` 白色底为扫码必需，保留；其余卡片已内联 palette.surface。

### src/screens/MessagesScreen.tsx
- 成员选择器 chevron 标签 `pickerTag` 用 `rgba(0,0,0,0.04)`（dark 下几乎不可见）→ 叠加 `palette.fill2`。

### src/screens/AnalysisScreen.tsx
- 语音回复播放容器 `flipAudio` 用 `rgba(0,0,0,0.06)`（dark 下几乎不可见）→ 叠加 `palette.surface`。

## 审计无需修复文件（定位合理/已内联主题）

- **MediaScreen.tsx**：内容区（录播/直播网格、送礼、贡献榜、日历）均已内联 palette；playerToolbar/bottomDock/controlsBar/announcePanel 为沉浸深色播放器界面，白字在 `#121214` 上对比充足，保留。`calSheet` 白底已在 JSX 被 `palette.surface` 覆盖。
- **PrivateMessagesScreen.tsx**：气泡 mine=palette.tint / other=palette.surface，翻牌条/输入条/翻牌标签全内联 palette，对比充足。
- **SettingsScreen.tsx**：`sectionTitle` 静态 `#111`/`#fff` 均在用途处被 `palette.label` 覆盖，无需改。
- **TripScreen.tsx**：今日节点 `#FFFFFF` 点在 tint 圆上，双主题均合理。
- **InvoiceScreen / MeleeRankScreen / CommunityScreen / CommunityPostDetailScreen / MemberDynamicScreen / MemberWeiboScreen / MusicLibraryScreen / AudioProgramsScreen / RoomRadioScreen / OpenLiveScreen / BilibiliLiveScreen / PhotosScreen / FlipScreen / FetchScreen / DatabaseScreen / RechargeScreen**：仅 媒体黑播放器、封面黑遮罩+白字、语义色半透明徽章（success/danger）与 `RechargeScreen` WebView 白底（支付页），均属合理保留，无需改。

## 验证
- `npx tsc --noEmit`（workdir=E:\yymsg\yaya_msg_mobile）通过，无任何 TS 错误。
- 修复原则遵守：未引入 useAppTheme()/isDark 双分支；Animated 未改动（现有均 useNativeDriver:true）；未改动业务逻辑/API/路由/i18n。
