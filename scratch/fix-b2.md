# 牙牙消息 移动端 UI 修复报告（批 b2）

修复范围：6 个屏幕（LoginScreen / RechargeScreen / FetchScreen / FlipScreen / ProfileScreen / PhotosScreen）
验证：`npx tsc --noEmit | Select-String "screens\\(LoginScreen|RechargeScreen|FetchScreen|FlipScreen|ProfileScreen|PhotosScreen)"` → 0 错误（其余批次 HomeScreen 等 7 条错误与本批无关）。

---

## 1. LoginScreen.tsx

- 删除 `isDark`/`useAppTheme` 及相关全部 `xxxDark` 死样式（containerDark/inputDark/accountRowDark/verifyBoxDark/verifyOptionDark/textDark/textSubDark）。
- 删除全部被 JSX 覆盖的死硬编码样式色：sectionTitle(#333)、input/areaWrap(rgba 白框)、areaPlus(#555)、btn(#4a4a4a)、btnPrimary(#ff6f91)、status/biliStatus/metabLine/accountRow 等。
- `accountRowActive` 硬编码 `#ff6f91`/rgba → JSX 内 `isCurrent && { borderColor: palette.tint, backgroundColor: palette.tintSoft }`。
- `accountName`/`accountMeta`/(旧 `#333/#555`) → palette.label/labelSecondary（JSX 已覆盖，样式清死值）。
- `accountCurrent` 绿 `#20a464` → `palette.success`；`accountAction` `#ff6f91` → `palette.tint`（两分支统一由 JSX 按 isCurrent 赋色）。
- `tokenInfo` 绿 `#4caf50`：已保存Token 行 → `palette.labelSecondary`；B站已登录行 → `palette.success`。
- `verifyBox`/`verifyQuestion` 的 `#ffb3c1`/`#c2185b` → palette.innerStroke/palette.label（JSX）。
- 6 个手写玻璃 `section`（surfaceGlass+innerStroke+borderRadius:20）→ `<GlassCard>`（统一 radii/card + 内描边 + 阴影），外层加 `styles.cardMargin`。
- 删除 JSX 内全部 `false` 伪 prop（style 数组中）。
- `FadeInView` 改为只包主体区块（ScreenHeader 移到外层），distance=8、delay=80。
- 12 个无按压反馈的 `TouchableOpacity` → 统一组件：
  - 主/次按钮 → `Button`（variant filled/tinted，带 loading/disabled 及按压 scale）：获取验证码/登录/保存Token/检查Token/刷新账号列表/重新获取二维码/读取资料/修改昵称/选择本地图片上传头像/打开官方充值页。
  - 验证码选项（verifyOptions）→ `ScalePressable`（pressedScale 0.94）。
  - 账号行 accountRow → `ScalePressable`（pressedScale 0.985，activeOpacity 0.7，disabled 透传）。
- 清理样式表：删除 btn/btnPrimary/btnDisabled/btnText 死样式，新增 btnFlex/refreshRow/avatarRow/qrRetryRow/cardMargin，圆角走 `radii` token。

## 2. RechargeScreen.tsx

- 页头右侧自绘「刷新余额」→ `HeaderAction`（label/loading）。
- `refreshBtn`（TouchableOpacity）→ `Button` filled + `refresh` 图标 + `loading`/`fullWidth`。
- `webRetryBtn`（TouchableOpacity）→ `Button` filled。
- `renderLoading` 保持绝对定位自绘（盖 WebView 合理），仅改 trim。
- 错误层 `webErrorWrap` 外包 `FadeInView`（淡入过渡）。
- 删除 `actionText`(#ff6f91)、`refreshBtnText`、`webRetryText`(#fff) 死/硬编码样式；新增 refreshBtnWrap/webRetryWrap。
- 移除未使用的 `useNavigation` 导入。

## 3. FetchScreen.tsx

- 删除 `isDark = useAppTheme()`、`containerDark` 死分支；容器直接透明。
- `CenterSpinner dark={isDark}` → 去掉 dark prop（内部按 palette）。
- 4 个模式按钮（TouchableOpacity）→ `Pill`（selected 自带 filled/按压），移除 `#FFFFFF`/`palette.labelSecondary` 自绘文字色。
- `fetchBtn` → `Button` filled（loading/disabled/fullWidth）。
- 列表条目 `FadeInView delay={80+index*30}` → `delay={index < 12 ? 80 + index * 30 : 0}`（避免超大数据/分页重建延迟过大）。
- 空态自绘文本 → `EmptyState`（icon+title+hint）；loading → `CenterSpinner text`。
- 删除 `containerDark/modeBtn/modeText/fetchBtn/fetchBtnDisabled/fetchBtnText/empty` 样式，新增 `modePill`。
- 清理未使用导入（useNavigation/useSettingsStore）。

## 4. FlipScreen.tsx

- 删除 `isDark = useAppTheme()`、`containerDark`；`pageStyle` 直接 `styles.container`。
- `CenterSpinner dark={isDark}` → 去掉 dark。
- 页头右侧自绘「发送翻牌」（actionBtn `#ff6f91`）→ `HeaderAction`。
- send 模式「回复形式」「公开设置」chip（TouchableOpacity + `#FFFFFF`）→ `Pill`（selected/filled，disabled 项以 style opacity + onPress 阻断）。
- `rechargeBtn` → `ScalePressable`（tintSoft 底 + tint 文字）。
- `sendBtn` → `Button` filled lg + loading。
- view 模式 `retryBtn` → `Button` filled sm；错误态 state 复用 status regex → 列表 `ListEmptyComponent` 区分 `ErrorState`（含重试）/`EmptyState`（暂无翻牌记录）。
- 列表卡片 `FadeInView delay={80+index*30}` → `index < 12` 限制。
- `answerMediaBtn`（语音/视频播放切换）→ `Button` filled sm。
- `answerAudio` 硬编码 `rgba(0,0,0,0.08)` → `palette.fill2`（JSX）。
- 删除 `actionBtn/retryBtn/retryBtnText/optionChip/optionText/sendBtn/disabledBtn/sendBtnText/answerMediaBtn/answerMediaBtnText/empty` 样式；新增 `retryWrap`；圆角走 `radiiAlias/radii`。
- 清理未使用导入（useSettingsStore）。

## 5. ProfileScreen.tsx

- 删除 `isDark = useAppTheme()`、`containerDark`；容器直接透明。
- `CenterSpinner dark={isDark}` → `CenterSpinner`。
- `notice` 橙色警示 `borderLeftColor:#ff9800` → `palette.warning`（JSX）。
- notice 内 `retryBtn`（TouchableOpacity + `retryBtnText #FFFFFF`）→ `Button` filled sm（loading 内置）。
- 未选成员空态 `emptyCard`（emptyTitle/emptyText 自绘）→ `<EmptyState icon="account-search-outline">` 内嵌卡片。
- `InfoItem` 去掉 `palette: any` props 穿透 → 内部 `usePalette()` 自取（audit P3 建议）。
- `infoItem width:'48%'` → `48.5%`（审计 P2 修正 4% 残留/换行）。
- 删除 `containerDark/emptyTitle/emptyText/retryBtn/retryBtnText` 样式，新增 `retryWrap`；清理未使用导入（useNavigation/useSettingsStore/useMemberStore）。

## 6. PhotosScreen.tsx

- 删除 `isDark = useAppTheme()`、未使用 `navigation`；`CenterSpinner dark={isDark}` → 去掉 dark。
- `EmptyState icon="image-multiple-outline"`：StateViews.EmptyState 的 `icon` 即 MCI glyph 字符串，合法无需改（确认）。
- 清理重复 RN 导入行、未使用 FlatList 导入与 `useNavigation`。

---

## 跨页统一处理（已落实）

- 无 `useAppTheme()/isDark` + `xxxDark` 双分支残留。
- 无被覆盖的硬编码死颜色（#ff6f91/#20a464/#4caf50/#ff9800/#ffb3c1/rgba 白框等）。
- 所有 `CenterSpinner` 不再传 `dark`。
- 列表入场动画：Flip/Fetch 均改为 `index < 12` 才对首批错峰（对齐 Photos 范本）。
- 交互按钮统一收敛 `Button`/`Pill`/`ScalePressable`/`HeaderAction`。
- 业务逻辑、API 调用、数据流、路由参数、i18n 文案 `t('中文')` 均未改动。
