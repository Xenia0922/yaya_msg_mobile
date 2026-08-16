# 移动端 UI 审计报告（b5 批次·6 页）

- 项目：yaya_msg_mobile（React Native + Expo + TS，v2.6.5）
- 设计规范：usePalette() 双主题 / typography 梯度 / 无 `isDark && xxxDark` / GlassCard 或 palette.surface 卡片 / ScalePressable 或 Pressable pressed 态 / EmptyState·Skeleton·StateViews / Animated 必须 useNativeDriver:true
- 审计范围：MeleeRankScreen、MemberDynamicScreen、MemberWeiboScreen、InvoiceScreen、CommunityScreen、CommunityPostDetailScreen
- 行号基于读取时的源文件行。

> 跨页通用上下文：
> - 所有页面 `container: { backgroundColor: 'transparent' }`，背景色交由外层 Navigator 容器提供。若外层已是主题背景则成立，但 `MeleeRankScreen` 在 light 下设置 `isDark && styles.containerDark`（恒 transparent）是死代码（见 R-1）。
> - 大量 `TouchableOpacity` 未传 `activeOpacity`（默认 0.2，iOS 视觉偏"隐没"而非弹簧反馈）；全站标准是 `ScalePressable` / `pressed` 态，见 Motion.tsx / Button.tsx / Pill.tsx。
> - 卡片普遍用「palette.surface + borderColor pellet.hairline」，与 GlassCard 语言基本一致，可接受；但统一使用与 `radiiAlia.card`(16) 相同的数值 16，建议改令牌引用。
> - 字号大量用裸 `fontSize` 字面量（15/13/12/11/14/17），与 `typography` 梯度部分吻合但不引用令牌；字体/字重也未用令牌（fontWeight '800'/'700'/'900' 属于自定义，梯度里最重是 700）。

---

## 1. MeleeRankScreen（src/screens/MeleeRankScreen.tsx）

### A. 硬编码颜色字面量
- L88 `style={styles.retryText}` 中 L388 `retryText: { color: '#fff', ... }` —— 非 black-alpha 遮罩、非品牌粉，硬编码白色文字。**改**：L388 用令牌，如 `color: palette.label` 不可（在粉色底上），建议改为 `Button`（filled variant 自处理白字）或接受 `#fff`（filled 主色为 tint 时白字，属合理，可保留）——但 `retryBtn` 内部自己画按钮，建议整段改用 `Button` 组件。

### B. isDark 双分支 / theme 分支
- L41 `const isDark = useAppTheme();` —— 与 usePalette 并存，属审计 M（审计即发现的硬编码双分支残留）范畴。此处 `isDark` 仅用于 L197 与 L262/L241 的 `dark` 参数与 `CenterSpinner`。
- L197 `style={[styles.container, isDark && styles.containerDark]}` —— **死代码**：L361-362 `containerDark: { backgroundColor: 'transparent' }` 与 container 完全一致。整段判断无效果。**改**：删除 `isDark && styles.containerDark` 与 `containerDark` 样式，直接 `style={styles.container}`。
- L241 / L262 `CenterSpinner dark={isDark}` —— CenterSpinner 本身就是双分支（`dark ? '#ff8fa8' : '#ff6f91'`，Loaders.tsx L31-32），且该 loader 带 `dark` prop 是设计如此（非页内硬编码）。但既然页面已用 usePalette，`CenterSpinner` 内部却仍用 `palette.name === 'dark'` 硬编码双色（不在本页责任内）。建议后续把 CenterSpinner 改成 `usePalette` + `palette.tint`。

### C. 页头
- L198 使用 `ScreenHeader title={t('鸡腿榜')} onBack={...}` —— 合规。无 right 操作位，无问题。
- 页头下方即为 `modeRow`（L200），间距 `marginBottom: 8` / screenHeader 自带 paddingBottom：12，视觉与其它页面一致，无问题。

### D. 按压反馈
- L232 `retryBtn` TouchableOpacity 未传 activeOpacity（默认 0.2）。改为 `activeOpacity={0.85}` 或用 `Button`。
- MODES 切换用 `Pill`（内部带 pressed scale，合规）。
- weekChip 用 `Pill`（合规）。

### E. 动画
- L239 / L260 `FadeInView` 包住列表 —— 列表入场动画已用，native driver（Motion.tsx L39）。合规。
- RankCard/PersonCard 内 L303/L341 嵌套 `FadeInView delay={80+index*24}` —— **双层 FadeInView 嵌套**（外层已包整个列表 FadeInView，内层 item 再 FadeInView），会产生双重淡入叠加（外层整体淡入 + 内层逐条淡入），视觉上顶部 item 会"先整体淡入再逐条淡入"的二次跳动。**改**：删除外层列表级 FadeInView（L239/260），保留 item 级逐条入场；或删除 item 级的，保留整列表。建议保留 item 级（更有列表流更性感），同时去掉外层包裹。

### F. 空态/加载态/错误态
- L230-235 自绘 error：`errorWrap` + 文字 + `retryBtn`（用 palette.tint 底 + #fff 字）。与站内 `ErrorState`（StateViews.tsx, 红色系 alert 图标+重试按钮）不统一。**改**：替换为 `ErrorState title={error} onAction={...}`（或保留"榜单无数据"文案场景用 EmptyState）。
- L240-241 / L262 `CenterSpinner` 作为 loading（非 skeleton）——合规（Loaders 已废弃 skeleton 呼吸），但 `CenterSpinner dark` padding 有 24 上下，居中的列表空态样式 OK。
- L252-253 / L274-277 empty 自绘 `<Text style={[styles.empty,...]}>`，与 `EmptyState` 组件不统一（无图标）。**改**：用 `EmptyState`/`ErrorState` 组件。

### G. 硬编码间距/圆角
- L372 `borderRadius: 16` —— 应引用 `radiiAlias.card`。L375 `borderRadius: 12`（leadIcon）应为 `radii.md`。L377 `borderRadius: 17`（avatar）应为 `radii.pill`。L387 `borderRadius: 18`（retryBtn）应引用 `radiiAlias.button`。L369 `list padding:14`，L372 `padding:12`，L363 `modeRow paddingHorizontal:16`，L364 gap:6，与 spacing 令牌（sm12/md16）基本吻合但未引用令牌，建议统一。
- L372 `marginBottom: 5`、L366 `maxHeight: 46`、L365 `marginBottom: 4` 等非 4 的倍散的数值（5/46）属散乱数值。

### H. 其它
- L27 同时 `usePalette` + L26 `useAppTheme`，名 `isDark` 却实际用于传 `dark` 给 loader —— 属 B 项残留，建议随 CenterSpinner 消除。
- L41 `const navigation = useNavigation<any>()` 用 any。
- L376 `rankNum fontSize:18 fontWeight:900` —— fontWeight 900 超出 typography 梯度（最重 700），字体不一致。**改**：用 `typography.title3`(20/600) 或自定义合理梯度。
- `modeRow` 的 Wrap 每项 flex:1 + modePill stretch，4 个 Pill 平分整宽，周/总/年/成员贡献会较挤，小屏下文字可能被挤断行 —— 建议 `flexWrap` 或缩小 padding。

### 优先级
1. **P0**：删除 L197 `isDark && styles.containerDark` 死代码与 `containerDark` 样式（L362）。
2. **P0**：双层 FadeInView 叠加（L239/260 外层 + L303/L341 内层）造成二次跳动，去其一。
3. **P1**：错误态/空态改用 `ErrorState`/`EmptyState`（L229-235、L251-253、L274-277）。
4. **P1**：L388 retryText #fff、L376 fontWeight 900 等字体/颜色令牌化，圆角改 `radiiAlias`/`radii`。
5. **P2**：移除 `useAppTheme`，改传 `palette`/`CenterSpinner` 演进。

---

## 2. MemberDynamicScreen（src/screens/MemberDynamicScreen.tsx）

### A. 硬编码颜色字面量
- 无 #hex / rgba（全走 palette）。图片占位用 `palette.fill3`（合规）。

### B. isDark 双分支
- L70 `const isDark = useAppTheme()`，仅用于 L156 传给 `CenterSpinner dark={isDark}`。页内无 `isDark && xxxDark` 双分支，但 `useAppTheme` 属 M-检测的硬编码双分支残留入口（CenterSpinner 内部有 dark 分支）。建议本页改用 `CenterSpinner` 不传 dark（改由内部 usePalette）后删除该变量。

### C. 页头
- L132-136 `ScreenHeader` + right=刷新 TouchableOpacity（statusText 用 palette.tint）。合规；右上角是文字"刷新"而非图标，与 InvoiceScreen 一致（InventoryScreen 的 headerAction 也是文字）。与其它页（MeleeRank 无 right）布局一致。
- L134 disabled 态用 `(!member||loading) && styles.disabledText`（opacity 0.45）——动态 computed class，可接受。

### D. 按压反馈
- L120 图片 `TouchableOpacity activeOpacity={0.85}` —— 有 activeOpacity，但非 ScalePressable（无缩放）。图片点击放大建议用 scale 反馈更一致。
- L133 刷新按钮 TouchableOpacity 无 activeOpacity（默认 0.2）。
- 列表卡片 L105 是 View 非可点击，无需按压。

### E. 动画
- L104 item 级 `FadeInView` + L138 外层列表级 `FadeInView` 双层包裹 —— 与 MeleeRank 相同问题（外层+内层双重淡入）。**改**：去 outer（L138），保留 item 级。
- Animated 全走 native driver（Motion）。

### F. 空态/加载态/错误态
- L156 `CenterSpinner`（loading）、L158 `ErrorState`（错误，**合规**，带重试）、L160-165 自绘 empty（star 图标 + 文字，用 `MaterialCommunityIcons` + labelSecondary）—— 与 `EmptyState` 组件（iconBox 圆形底）不一致：自绘 empty 无圆形 iconBox。**改**：空态用 `EmptyState icon="star-circle-outline" ...`。
- 错误发生在已有数据时（非首屏）会 walk ListEmpty 分支（因为 error 优先于 empty），此时列表仍显示 items + ErrorState 替换 empty —— 逻辑 OK。

### G. 硬编码间距/圆角
- L180 `list padding: 8`（其它页 14/16 不一致）；L181 卡片 `borderRadius:16 marginVertical:4`（取令牌）；L188 `gridImage 100x100 borderRadius:10`（fixed 100px 九宫格，iOS 26 规范常用 flexBasis + aspectRatio，见 CommunityPostCard L135 `flexBasis:'31%'`）。**改**：网格用百分比 flexBasis 自适应宽度，避免小屏溢出/大屏浪费。
- L182-183 ownerAvatar 28/radius 14 无令牌。

### H. 其它
- 卡片 L105 `borderColor + borderWidth: hairlineWidth` 双写（palette.hairline 本身已是 hairline 强度），与 CommunityPostCard 一致，可接受。
- owner 信息在卡片内重复渲染（动态条目级有 ownerName），逻辑正确。

### 优先级
1. **P0**：双层 FadeInView（L104 + L138）。
2. **P1**：空态改 `EmptyState`（L160-165）。
3. **P1**：图片网格改百分比 flexBasis（L188）。
4. **P2**：组件缩放反馈统一（图片、刷新），移除 `useAppTheme`。

---

## 3. MemberWeiboScreen（src/screens/MemberWeiboScreen.tsx）

> 与 MemberDynamicScreen 高度同构（同一作者/同一卡片语言）。指出本页特有项，重复项从简。

### A/B. 硬编码颜色 / isDark
- 无硬编码色；L72 `useAppTheme` 仅传 CenterSpinner。同 M 残留。**改**：随 CenterSpinner 演进删除。

### C. 页头
- L152-156 `ScreenHeader` + 文字"刷新"。合规。**注意**：L73 `const palette = usePalette();` 在 L72 `isDark` 之后，且 L154 直接内联 computed `disabled ? undefined : styles.disabledText`（这是 style 数组里 JS，无问题）。

### D. 按压反馈
- L134 图片 TouchableOpacity activeOpacity 0.85（无 scale）。
- L141 `linkBtn`（查看微博原文）TouchableOpacity **无 activeOpacity**（默认 0.2，过强变暗）。**改**：`activeOpacity={0.85}` 或 `ScalePressable`。
- L153 刷新按钮无 activeOpacity。

### E. 动画
- L118 item FadeInView + L158 外层 FadeInView 双层，同问题。去外层。

### F. 空/载/错
- L176 CenterSpinner、L178 ErrorState（合规）、L180-184 自绘 empty（仅文字无图标，比 Dynamic 更简陋）。**改**：`EmptyState icon="account-outline"`（或类似）。

### G. 间距/圆角
- 同 Dynamic：L199 card 16，L207 gridImage fixed 100 无令牌；L208 `linkBtn borderRadius:18` 应引 `radiiAlias.button`；L199 list padding 8 与其它页不同。

### H. 其它
- L56 jumpUrl 处理正确；L134 图片 `key={idx}` 与 Dynamic 一样 OK（列表稳定）。
- 与 Dynamic 双文件几乎复制粘贴（含 `usePaginator` 不用，改手写 fetchData），**代码重复**：建议后续合并为共享列表组件。

### 优先级
1. **P0**：双层 FadeInView（L118 + L158）。
2. **P1**：`linkBtn` 缺 activeOpacity（L141）；空态改 `EmptyState`（L180-184）。
3. **P1**：网格固定 100px 改比例（L207）。
4. **P2**：与 Dynamic 合并共享组件；删 useAppTheme。

---

## 4. InvoiceScreen（src/screens/InvoiceScreen.tsx）

### A. 硬编码颜色字面量
- L132 `#20a464` 状态绿（可开票状态色）—— **绿色硬编码**，未走 semantic.success（#34C759）。**改**：状态绿应引 `palette.success`，或按"状态可用/禁用"语义用语义色。这是本页最明显硬编码色。
- L126 checkbox 勾 `color="#FFFFFF"` —— 白勾（品牌底上合理，白字）可接受。
- L184/193 typeText 选中 `#FFFFFF` —— 品牌 tint 底白字，合理。
- L243 `headerAction { color:'#ff6f91' }` —— **品牌粉硬编码**！但 L144 实际用 `{ color: palette.tint }` 覆盖（style 数组后者生效），L243 是死样式残留。**改**：删除 L243 color 或保留但改 palette.tint 引用。真正死代码。
- L247 `errorText { color:'#ff6f91' }` —— 但 L153 实际传 `{ color: palette.tint }` 覆盖。死样式残留。**改**：删掉或令牌化。
- L249 retryBtnText `#FFFFFF`、L282 submitText `#fff` —— 品牌底白字，合理可保留。
- L280 `submitBtn backgroundColor:'#ff6f91'` —— 又被 L227 `{ backgroundColor: palette.tint }` 覆盖，死代码。**改**：删/令牌化。

### B. isDark 双分支
- 无（本页未导入 useAppTheme，全部走 usePalette）—— **本页是双分支治理最干净的一页（A 类唯一的是死样式残留）**。

### C. 页头
- L142 ScreenHeader + 文字"刷新"。合规。
- L243 `headerAction { color:'#ff6f91' }` 在样式表里硬编码（L144 运行时 palette.tint 覆盖）—— C 类页头右操作的样式残留（== A 的死代码）。改同上。

### D. 按压反馈
- L104 orderCard TouchableOpacity `activeOpacity={0.85}`（disabled 时 1）——有。
- L154 retryBtn 无 activeOpacity（默认 0.2）。
- L177/186 typeBtn 无 activeOpacity —— 「个人/企业」切换按钮过强变暗。**改**：activeOpacity 0.85，若做成 segmented control 更好。
- L143 刷新按钮无 activeOpacity。
- L226 submitBtn 无 activeOpacity（disabled 0.45 opacity）。**改**：此为主 CTA，建议用 `Button` filled 组件（自带 pressed scale + disabled opacity）。

### E. 动画
- L103 item FadeInView —— 单层，列表无外层包裹（页面是 ScrollView 不是 FlatList，`orders.map` 渲染）。合规无双层。
- 提交按钮无 loading 动画之外的反馈（用文字"提交中…"）。

### F. 空/载/错
- L160-162 空态 `<Text style={[styles.empty,...]}>` 自绘，无图标，与 EmptyState 不统一。**改**：`EmptyState`。
- L151-157 错误 row（tint 粉底重试）不统一为 `ErrorState`。**改**：`ErrorState`。
- L163 loading 用 `ActivityIndicator`（padding 16）非 CenterSpinner —— 与全站不一致。**改**：统一 CenterSpinner。

### G. 间距/圆角
- L243-283 大量：L253 卡 16；L258 checkbox radius 7；L248 retryBtn radius 14；L272 typeBtn radius 16；L280 submitBtn radius 18（应 `radiiAlias.button`）；L262/263/274 字号 14/12/13。建议令牌化。
- L244 `scroll padding:16` 与其它页 list 8/14 不一致；L245 sectionTitle 15。
- 表单 input L275 `borderRadius:14` 未引 `radiiAlias.input`(14) —— 数值对但未引用。

### H. 其它
- **死代码集**：L243/L247/L280 的 `#ff6f91` 硬编码全被运行时 palette.tint 覆盖，属 A 类残留应清。
- 状态绿 L132 用 `#20a464` 与 semantic.success 冲突 —— 视觉偏差，金额/状态应保证一致绿。

### 优先级
1. **P0**：清理死样式硬编码（L243、L247、L280 的 `#ff6f91`），统一 palette.tint。
2. **P1**：状态绿 L132 `#20a464` → `palette.success`。
3. **P1**：错误态/空态/loading 统一组件（L151-163）。
4. **P1**：typeBtn/submitBtn 缺按压反馈，submitBtn 改 `Button`。
5. **P2**：圆角/字号令牌化。

---

## 5. CommunityScreen（src/screens/CommunityScreen.tsx）

### A. 硬编码颜色字面量
- L369 `modalMask { backgroundColor:'rgba(0,0,0,0.45)' }` —— 黑色遮罩，属合理场景（Modal 下方遮罩），可保留。
- L284 Modal `animationType="slide"` —— 底部滑出。L290 sheet 用 `palette.surface`。无其它硬编码。
- 无 #fff 除 submitText（白色）—— 品牌底白字合理（L333 `submitText`）。

### B. isDark
- **L62 `const isDark = useAppTheme()`**，但只用于 L127 `CenterSpinner dark={isDark}`（listEmpty）。页内无 `isDark && xxxDark`。同 M 残留，建议随 CenterSpinner 演进删除——community 是 2.6.5 新增页，仍引入 useAppTheme + CenterSpinner dark，属新写入的旧模式。

### C. 页头
- L145-154 ScreenHeader，right = composeBtn（tintSoft 圆形「+」图标）。合规，图标型操作比文字更规范（好于 Dynamic/Weibo/Invoice 的文字刷新）。无自绘 header。

### D. 按压反馈
- L148 compose 图标 TouchableOpacity 无 activeOpacity（hitSlop 有）→ 默认 0.2。**改**：activeOpacity 0.85 或包裹在 Pill 式 pressed。
- L161 顶部推荐/最新 tabPill TouchableOpacity `activeOpacity={0.85}` 有，但无 pressed scale → 用 Pill selected 更统一（Pill 自带 pressed 0.96 scale）。**改**：用 `Pill`/segmented 控件。
- L289 modalMask（点遮罩关闭）activeOpacity=1（不应变暗，正确）。
- L294 关闭按钮、L327 发布按钮有 activeOpacity 0.85（发布按钮用 0.85）。发布 submit 按钮 L327 无 scale —— 建议 ScalePressable。

### E. 动画
- L175 外层 FadeInView + L184 item 级 FadeInView —— **双层 FadeIn**（同 MeleeRank）。去外层。
- Modal `animationType="slide"` 是 RN 内置动画，非 useNativeDriver 可控，但为系统对话框动画，属于可接受（难自控）。若追求一致弹性，可改为手动 Animated + native driver。当前"滑出 + 无回弹"体验尚可，属 P2 可选。

### F. 空/载/错
- L126-141 `listEmpty` 逻辑用 `EmptyState`/`ErrorState` 组件，**合规且统一**；CenterSpinner 载态。这是 6 页中空态治理最好的页面（无自绘 empty）。
- 未登录态也走 EmptyState —— 优秀。

### G. 间距/圆角
- L344 list padding 8；L346 tabRow paddingHorizontal 16 marginBottom 8；L353 tabPill borderRadius 16（radius 建议令牌）；L361 composeBtn radius 16；L365-366 composeBtn 32/16；L371 sheet radius 24（顶部圆角大，符合底部 sheet 惯例）；L376 sheetHandle 40x4；L385/392 input radius 12（应 radii.md? input 规范是 14，此处 12 偏小，建议 radiiAlias.input=14）；L401 submitBtn radius 18（应 radiiAlias.button）。

### H. 其它
- L33 `checkMaskWords` / 话题输入等逻辑正确。
- ComposeMobile 底部滑出 + KeyboardAvoidingView：`behavior padding`（ios），但 sheet 里 TextInput multiline，键盘推出 sheet 时会遮挡 —— 需要 bottom inset 或 scroll。潜在布局问题（小屏+键盘）。
- L333 submitText color '#FFFFFF'（合理）。

### 优先级
1. **P0**：双层 FadeInView（L175 + L184）。
2. **P1**：无登录分支的 CenterSpinner dark(L62/L127) 删 useAppTheme；compose 图标缺 activeOpacity（L148）。
3. **P2**：input radius 12→14、submitBtn 用 Button/ScalePressable、modal 可选手动 native-driver 动画。

---

## 6. CommunityPostDetailScreen（src/screens/CommunityPostDetailScreen.tsx）

### A. 硬编码颜色字面量
- L286 send 图标颜色：`sending ? palette.labelTertiary : '#FFFFFF'` —— white（tint 底合理）。
- 无 #hex（除 #FFF 白字，合理）。

### B. isDark
- **L61 `const isDark = useAppTheme()`**，用于 L210/L226/L253 `CenterSpinner dark={isDark}`。同 M 残留（2.6.5 新增页用旧 double-branch loader）。

### C. 页头
- L238 ScreenHeader（title 帖子详情）onBack。合规。**注意**：无 right、无 subtitle、大标题左对齐，其它页一致。

### D. 按压反馈
- L255 `查看更多评论` TouchableOpacity `activeOpacity={0.8}` 有。
- L277 sendBtn `activeOpacity={0.85}` 有。
- 无点赞/收藏操作（社区 API 无 like）→ 本条「点赞/收藏无动画反馈」在此页不适用。
- L255/L277 无 scale，建议 ScalePressable 统一点击质感。

### E. 动画
- **列表入场动画缺失**：comment Row（L186 renderComment）与 listHeader 均非 FadeInView，无统一入场（feed 页有 FadeInView，详情页评论没有，风格不一致）。**改**：评论行包裹 `FadeInView`（或用 item 级）。
- Animated 无原生 useNativeDriver 外其它手工动画（评论输入条无动画）。发送评论后置顶插入（L176）无动画反馈（如新评论 slide-in）。建议加入。

### F. 空/载/错
- L210 CenterSpinner（detail loading）、L212 ErrorState（detail error，合规）、L224 ErrorState（comments error）、L225 CenterSpinner、L227 commentsEmpty 自绘 `<Text>`（无图标）。**评论空态自绘**，与 EmptyState 不统一；但详情页评论空态更适合轻量文字，可改用 EmptyState 小尺寸或保留——推荐 EmptyState 统一。

### G. 间距/圆角
- L299 commentsSection paddingHorizontal 12；L303 commentRow padding 16/10；L304 avatar 28/14；L310 loadMore paddingVertical 14 —— **间距/数值散乱**（12/16/10/14/8），未走 spacing 令牌。
- L321 composeInput radius 18（应 radiiAlias.input 14），L330 sendBtn radius 17（应 radii.pill）。
- L298 list paddingBottom 24 无水平 padding（卡片自带 marginHorizontal 4）。

### H. 其它
- L215 `CommunityPostCard textLines={0}` 在 header 渲染，正确。
- 底部 composeBar 用 KeyboardAvoidingView（ios padding）+ 自定义 padding。发送后 `setInput('')` 且键盘可能未收起，需考虑 `Keyboard.dismiss`（P2）。
- 新评论置顶插入后 FlatList 无 scrollToOffset / animated，用户可能看不到刚发的（若在底部）—— 需 scrollToEnd/顶部，P2。

### 优先级
1. **P1**：评论列表缺入场动画（L186/L207 包 FadeInView）。
2. **P1**：删 `useAppTheme`（L61）随 CenterSpinner 演进；评论空态统一 EmptyState（L227）。
3. **P2**：round 样式/令牌（L299-321）、send 无 scale 反馈、发布后 `Keyboard.dismiss` + 列表定位。

---

## 跨页共性问题（最重要 3 个）

1. **双层 FadeInView 嵌套 → 二次淡入跳动**（MeleeRank L239/260+303/341、MemberDynamic L104+138、MemberWeiboScreen L118+158、CommunityScreen L175+184）。统一约定：外层列表包一层 FadeInView 即可，item 别再包；或反之。建议保留 item 级、删除外层——4 页同病，需统一修。

2. **`useAppTheme`/`isDark` + CenterSpinner 硬编码双色残留**（MeleeRank L41、MemberDynamic L70、MemberWeiboScreen L72、CommunityScreen L62、CommunityDetail L61；Loaders.tsx L31-32 内部 `isDark ? '#ff8fa8':'#ff6f91'`）。按规定禁止 `isDark && xxxDark` 双分支；CenterSpinner 应改 `usePalette` + `palette.tint`，各页删 `useAppTheme`。就这台设备上是 5 页全部残留同一旧 loader 模式。

3. **按压反馈不统一**：满屏 `TouchableOpacity` 大量缺 `activeOpacity`（默认 0.2 过深变暗）或未用 pressed scale；空好组件标准是 `ScalePressable`/`Pressable pressed`（Pill/Button 已示范）。典型：MeleeRank retry L232、MemberDynamic 刷新 L133、MemberWeiboScreen linkBtn L141、Invoice typeBtn L177/186 + submit L226、Community compose L148/tabs L161、Detail 各处按钮——建议全局把可点组件切到 `ScalePressable`。

---

## 附：加分项 / 一致性好的一面
- 6 页都用 `ScreenHeader`，无自绘 header（除个别 headerAction 死样式残留）。
- 除 Invoice 外均用 `palette.surface+hairline` 卡片；Community 页空/错态全部用统一组件，是范本。
- 卡片圆角 16 与 `radiiAlias.card` 数值一致（仅未以令牌引用）。
- Animated 全部 `useNativeDriver: true`；`FadeInView`/`Pill` 已用弹簧动画。
- InvoiceScreen 无 `useAppTheme`，双主题治理最干净（仅死样式残留）。
