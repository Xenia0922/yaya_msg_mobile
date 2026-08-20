# 共享组件移动端 UI 审计报告 — yaya_msg_mobile v2.6.5

审计范围：`src/components/` 下 22 个组件 + 主题 tokens（`src/theme/*`）。
参考规范：iOS 26 主题 token —— `spacing`(4pt，2xs=4 … 4xl=56)、`radii`(md=14，cardAl=16，button=18，pill=999)、`typography`(caption2=11 … largeTitle=34)、`motion`(fast=160/base=240/slow=360 + spring)、`usePalette`(light/dark 双主题)、`makeShadows`。

已将优先级用 `[P0/P1/P2]` 标注：P0 高（视觉违规/主题不一致/明显 bug/重复组件），P1 中（一致性/动效缺口），P2 低（死代码/微调）。

---

## 1. GlassCard.tsx

- **E · 行47 `shadows.sm`（iOS 与 android 分支相同）** — `Platform.select` 两个分支都是 `shadows.sm`，`default: undefined`，纯冗余代码。可简化为 `{...shadows.sm}`。
- **B · 行37 用 `palette.name==='dark'` 传 `makeShadows`** — 正确接入 usePalette，但阴影 alpha 由 shadows 内部处理，非硬编码，合格。
- **A · 行39 `'rgba(28,28,30,0.78)'`** — pink tint 强玻璃的深色回退是硬编码遮罩色，与 `dark.surfaceGlassStrong` 相关但未走 token。属可接受的玻璃语义，建议抽为 `palette` 上的常量或注释说明。
- **G · 行21 `radius` 默认注释"默认 card (28)"与行32实际 `radiiAlias.card`** — 注释与代码不符（theme comments 卡片 16/14，radii 注释 16）。注释应改，避免误导。

**结论**：整体最规范的一个组件。仅修 Platform.select 冗余与注释。
**建议**：`Platform.select` 三行删减为一行。

---

## 2. Button.tsx

- **C · 行78-88 Pressable 已内联 `pressed ? 0.97 : 1` scale** — 有按压反馈，合格。但可改用统一的 `ScalePressable`(Motion.tsx)，且此时内联 scale 与全局反馈节奏(0.96)不一致(0.97)。
- **A · 行68 `'#FFFFFF'`** — filled 白字硬编码；Pill.tsx、StateViews.tsx 等同样用 `'#FFFFFF'` 作为 tint 上白字。建议中心化为 `onTint` token。
- **G · 行130-131 `export { motion }`** — **死代码**：在此处 re-export motion 纯属无关导出，会让调用方误从 Button 导入 motion。查实无必要，应删除。
- **E · 行83 `borderRadius: radii.pill`** — 主题注释明确"按钮 18 非全胶囊"，此处用 `pill(999)` 做全胶囊。若产品意图是 iOS 26 全胶囊则 theme 的 `radiiAlias.button:18` 应更新；否则应改为 `radiiAlias.button`。组件与 theme 定义**互相矛盾**，需二选一对齐。
- **C · `sizeMap` 中 sm/md/lg 高度 36/44/52** — 无 token 依据，但按钮高度属合理 hardcode，可接受。
- **G · 行98 `marginRight: 8`** 图标间距 — 非 `spacing.xs`(8)恰巧一致，可读作 token 以表意。

**结论**：最高优先级是 `borderRadius` 与 `radiiAlias.button` 的矛盾、以及尾部 `motion` re-export 死代码。

---

## 3. EmptyState.tsx

- **F · 与 StateViews.tsx 严重重复 — P0**：`EmptyState.tsx`(icon+title+desc+Button) 与 `StateViews.tsx` 的 `EmptyState`/`StateView` 是两套"空态"实现，功能几乎重叠（居中图标+标题+说明+操作），但视觉差异巨大：本文件用 `iconBox`(56圆+fill3) + `typography.title3` + `Button`；StateViews 用 `iconWrap`(64圆+tintSoft) + 自定义 15px 标题 + 自绘 `TouchableOpacity` 按钮。**保持两个同名 `EmptyState` 共存必然导致全站空态视觉不统一**。
- **E · 行25 `marginTop:16`、行32 `maxWidth:280`、行39 `marginTop:20`**：间距未走 `spacing` token（16 可读 `spacing.md`，20 可读 `spacing.lg`）。
- **E · 行52-56 `paddingVertical:48`、`paddingHorizontal:24`**：与 StateViews 的 48/32 不一致。
- **A · 用 `palette.fill3` 而非粉底** — 逻辑对，但与 StateViews 的 tintSoft 视觉不同。

**结论**：**应删除本文件，或在本文件之上统一复用 StateViews（Recommended: 保留一个，全站替换调用点）**，见"组件合并/统一建议"。

---

## 4. Loaders.tsx

- **B · 行20-35 用 `dark?: boolean` prop 而非 `usePalette` — P0**：调用方必须手动传 `dark`，且无法感知主题。对比全局其他组件都用 `usePalette()` 自动切主题。**建议删除 `dark` prop，改用 `usePalette()`**（此时 `palette.tint` 即品牌粉，无需在行31手写 `dark?'#ff8fa8':'#ff6f91'` 双分支）。
- **A · 行31/44/45 硬编码 `#ff8fa8`/`#ff6f91`** — tint 双主题字面量，未走 `usePalette().tint`（light=#ff6f91，dark=#ff8fa8），与主题明确定义重复。
- **E · 行44 字号 12 + fontWeight 600 + marginTop 8** — 与 `typography.caption1`/`spacing.xs` 一致，但未引用 token 表意（读作 token 更清晰）。
- **F · 加载指示器重复** — 见"合并建议"：CenterSpinner 是全站唯一集中 spinner，但未提供 `usePalette` 主题化，应作为统一入口。

**结论**：`dark` prop 是反 theme 设计，应改为内部 `usePalette()`。

---

## 5. Skeleton.tsx

- **D · 行21-29 已用 `Animated.loop` + `useNativeDriver: true`** — 合格，无问题。
- **B · 行17/38 正确用 `usePalette().fill3`** — 合格。
- **G · 行47-50 `SkeletonRow`** — 是否被引用需确认；若无引用则为死代码。内部 marginVertical:6 / radius:6 未走 token。
- **G · 行53 `const styles = StyleSheet.create({})`** — 空 styles 常量，死代码。

**结论**：本组件实现合规。仅清理空 styles 与可能的 SkeletonRow 死代码。

---

## 6. StateViews.tsx

- **A · 行32 `rgba(255,59,48,0.12)`** — error 红色遮罩硬编码，与 `semantic.danger`(#FF3B30) 相关但需手写 alpha。可建议在 theme 加 `dangerSoft`。
- **A · 行86 `'#FFFFFF'`** — 按钮白字硬编码（同 Button.tsx）。
- **C · 行38-41 `TouchableOpacity activeOpacity={0.85}`** — 属通用主按钮，却手写 (非 Button 组件)。若统一应改用 `Button variant="filled"`，消除与 Button/Pill 的白字+粉底重复。（见 EmptyState 同款问题）
- **E · 行63-64 `paddingVertical:48 / paddingHorizontal:32`** — 与 EmptyState 的 48/24 不一致；`iconWrap` 64 vs EmptyState 56。两套空态/错误态应统一。
- **E · 行76-86 字号 15/12、圆角 18、padding 26×9 手写** — 与 typography/radii 不符（15/12 无对应 token;18 恰 = radiiAlias.button）。**这是全套自绘按钮，与 Button 组件重复。**
- **G · 行43 `actionLabel || t('重试')`** — StateView 内兜底文案在本文件多余（已由 ErrorState 注入 `actionLabel`），逻辑冗余但无害。

**结论**：StateView 作为统一状态组件方向正确，但其"自绘主按钮"与 Button 组件重复，且与 EmptyState.tsx 冲突。修法见"合并建议"。

---

## 7. SectionHeader.tsx

- **C · 行49 `Pressable`(actionLabel) 无 pressed 态** — 文字按钮点击无任何按压反馈。可加 `opacity` 或微缩。可复用 ScalePressable。
- **C · 行49 `hitSlop={10}`** — 数值应读 `spacing.xs`(8)/`sm`(12)，微调即可。
- **E · 行69 `paddingTop:24 / paddingBottom:8`** — 非 token（24=`spacing.xl`，8=`spacing.xs`），建议读作 token。
- **B · 正确用 usePalette + typography + insets** — 合格。

**结论**：仅按压反馈缺失 + token 化小修。

---

## 8. Pill.tsx

- **C · 行26-34 Pressable 内联 scale 0.96** — 有反馈，合格。可复用 ScalePressable 统一。
- **A · 行23 `'#FFFFFF'`** — selected/accent 白字硬编码（同 Button）。
- **E · 行44-46 `fontSize:14` 覆盖 typography.subhead(15)** — 覆盖了 subhead 的字号却不走 `typography.footnote/caption`，属 mini 字号硬编码；14 无 token 对应，建议用 `caption1(12)` 或 `subhead(15)` 之一。
- **E · 行57-58 paddingHorizontal 14/paddingVertical 7** — 非 token。14/7 可用 `spacing`(sm/md) 就近表达。
- **B · 正确 usePalette** — 合格。

**结论**：字号 14 覆盖 subhead 是不一致的 mini 字号；白字需统一 onTint。

---

## 9. NetworkImage.tsx

- **G · 无问题** — 单一封装的 Image 入口（android fadeDuration 200），目的就是集中替换，设计正确。
- **G · 行14 缺省 `fadeDuration` iOS 0 / Android 200** — 合理，已优于裸 Image。

**结论**：合规，建议在调用方尽量替换裸 `Image`/`ImageBackground`，统一走此入口（CoverArt 中仍用裸 `Image`）。

---

## 10. PerfFlatList.tsx

- **G · 无问题** — 集中性能默认值封装，forwardRef + 泛型转发，设计正确。

**结论**：合规，零修改建议。

---

## 11. CoverArt.tsx

- **A · 行10-23 `PALETTE` 12 组渐变** — 硬编码但**合理**（确定性音乐封面，非主题相关，可接受）。
- **A · 行120-124 `rgba(255,255,255,0.95)` / `rgba(0,0,0,0.38)` / `'#fff'` activeDot** — 白色音符/阴影/亮点，属封面上的绝对对比层，**可接受**（不随主题）。但 activeDot 背景 `'#fff'` 在浅色封面上不可见，建议用高对比自定义。
- **G · 行95-96 boxStyle `borderRadius:999`(round)** — 硬编码 999，应读 `radii.pill`。
- **G · 裸 `Image`（行105）** — 未走 NetworkImage（会丢 android fade 一致性），建议换成 NetworkImage。
- **G · 行64 `useState(false)` errored/loaded + 3s 重试 + 15s 超时** — 复杂但注释详尽，属于有意的健壮性设计，保留。注意多处 `setTimeout`(行88) 未清理，组件卸载后仍会触发 setState —— **轻微内存/告警隐患**（可加 mounted ref）。

**结论**：功能性复杂组件可接受；建议用 `radii.pill`、NetworkImage、清理 setTimeout。

---

## 12. MiniPlayerBar.tsx

- **D · 行80 / 101 / 103 / 109 / 110 全部 `useNativeDriver: true`** — 合格。旋转/spring/timing 规范。
- **A · 行202-206 `shadowColor:'#000'` 等手写阴影** — 未走 `makeShadows('md')`，与 GlassCard 一致性问题（**P1**）。且 `shadowColor:'#000'`+透明度 0.12 在 dark 下偏重。建议改用 `makeShadows`。
- **E · 行195 `borderRadius:26`** — 非 token（介于 md 14/lg 20 之间，偏高）。且右圆角深色模式下 borderColor 用 pallet.innerStroke 正确。
- **G · 行223-224 `void spacing;` + 注释** — **死代码**：为"未来使用"的 spacing 引用，纯噪音，应删除 import 与 `void`。
- **G · 行216 `cover` 背景 `'#1a1a1a'`** — 硬编码背景，CoverArt 自身已带渐变垫底，此值多余。
- **G · 行49 `progRef` + PanResponder seek** — 复用合理。
- **F · 进度条（progressTrack/Fill/Thumb 行139-148）与 FullScreenPlayer 进度条(行232-245)重复实现** — 两处各自实现 seek 手势逻辑（一个 PanResponder、一个原生 responder），见合并建议。

**结论**：阴影/圆角 token 化 + 删 `void spacing` + 进度条抽取。

---

## 13. FullScreenPlayer.tsx（重构中，问题最多）

- **B · 全套用 `isDark` + `Colors.bgDark` 而非 `usePalette` — P0**：行20,44 `isDark` prop; 行366 `backdropD:{backgroundColor:Colors.bgDark}`; 行408 `queueSheetD:{backgroundColor:Colors.bgDark}`。这是**双分支 + hide palette** 的反主题实现，与全站 `usePalette` 风格割裂。
- **A · 大量硬编码颜色 — P0/P1**：行377 黑胶 disc `#1a1a1a/#0d0d0d`; 行253-262/283/307 图标 `#ccc/#666/#eee/#333/#ff3b5c`; 行391-395 进度 rgba(0,0,0,0.12)/(255,255,255,0.18)、`#ff6f91`、`#fff`; 行403 `playBtn` `#ff6f91`; 行407-409 queueSheet `#fff`/`#ddd`; 行380-405 lyricTool 等。**基本全部绕过 palette**。
- **E · 字号大量裸数字**：行370-417 fontSize 10/11/15/16 等未走 typography token。
- **C · 行182/249/255/258/264/267/270 Pressable 多无 pressed 反馈**（仅少数有 favOn/lyricOn 背景态）；行277/296 TouchableOpacity。反馈缺失。
- **D · 行276 `Modal animationType="slide"` + 行277 自定义 sheet** — 用**系统默认 slide**，无 spring/bounce 个性；而 MiniPlayerBar 已用 motion.spring。全站动画不一致（**P1**）。另 `slideAnim`(行119) 用于整页下拉关闭的 translateX 而非 translateY —— 下拉手势却做横向位移，**手势方向与动画方向不符（疑似视觉 bug）**。
- **D · 行151-162 PanResponder 下拉关闭** — 无 `useNativeDriver` 自定义 spring（行159 有 spring 但参数为默认，未用 motion.spring.*）。
- **G · 死代码/未用样式**：行372 `topBtnOn`、行404 `playIcon`、行418 `queueUnavail` 均未在 JSX 用；行377 大 disc。请清理。
- **G · 进度条重复**与 MiniPlayerBar（见 F）。
- **G · 行341 外层 `if(!visible) return null` 而后内层 FullScreenPlayerInner 又有行175 `if(!visible) return null`** — 双保险；外层先 return 保证 hooks 不提前返回(正确做法)，但 `visible` 已成恒 true，**Inner 的行175 条件是无效死代码**。

**结论**：这是最需要重构的组件。P0：砍 isDark/Colors 改 usePalette，进度/歌词/图标全面 token 化。P1：下拉手势 translateY 修正、sheet 动画统一 motion、删死代码。

---

## 14. ZoomImageModal.tsx

- **D · 行78 `animationType="fade"`** — 有进出场 fade，但 Modal 内部无额外动画；图片缩放无 spring 回弹（行70-74 直接 setScale(1) 归位，生硬）。**P1**：缩放边界处用 spring 更 iOS。
- **C · 行80 close TouchableOpacity 无 activeOpacity** — 默认 0.2，且是"关闭"按钮无反馈可接受，建议显式 `activeOpacity={0.8}`。
- **A · 行107 `rgba(0,0,0,0.94)` 全屏遮罩、行109 `rgba(255,255,255,0.14)` 按钮底** — 属全屏查看器的遮罩语义，**可接受**。
- **G · 用 Reanimated 风格 setState 驱动 transform（行33-34 scale/offset 走 React state）** — 每帧 setState 重渲，性能差于 Animated/useNativeDriver。图片缩放/平移走 state 会低帧率。**P1 性能**。
- **G · line 75 useMemo 依赖 `[offset,scale]`** — 每次移动重建 PanResponder，正确性 OK。

**结论**：缩放用 state 驱动是主要性能问题；close 反馈与 spring 微调。

---

## 15. CommunityPostCard.tsx

- **E · 行122 `borderRadius:16`** — 与 `radiiAlias.card`=16 一致但**未引用 token**（硬编码）。同理：行135 `gridItem borderRadius:10`（= `radii.sm`）,行128 avatar 34/17(距),行123 padding 14 等均裸数字。
- **B · 正确用 usePalette — 合格**（行27）。
- **C · 行104 TouchableOpacity `activeOpacity={0.9}`** — 有反馈，合格。行65 图片 TouchableOpacity `0.85` 合格。
- **E · 字号行129-132 13/15/11** — 多与 typography(subhead 15/caption1 12) 接近但裸写。统计字体 11 等。
- **G · 行48 `post.title` numberOfLines={3} 用了硬编码 3，与 textLines 无关** — title 始终截 3 行而 text 用 textLines，逻辑分裂，可确认是否有意。
- **G · 行137 imageGrid/gridImage** — 9:12 宫格实现于 gridItem flexBasis 31% 合理。

**结论**：主题接入正确，但全文件裸数字/字号未 token 化（P1 一致性问题）。

---

## 16. MemberPicker.tsx

- **B · 用 `useAppTheme()` 的 `isDark` + 双分支样式 — P1/P0**：行36 `isDark`; 行97-121 input/chip/team 一堆 `#ddd/#FFFFFF/#333/#1C1C1F/#eeeeee/#ff6f91/...` 双分支；与 `usePalette` 风格（周边组件）不一致。**建议改 usePalette**。
- **C · 行71-74 chip 用 `TouchableOpacity activeOpacity={0.75}`** — 有反馈，但 chip 视觉与全局「Pill」重复（成员选择 chip ≈ Pill），**F：与 Pill 重复**。
- **E · 行95-100 input borderRadius:16/borderColor'#ddd'** — 未 token（`radii.md`=14/`input`）。
- **E · 行93-99 input padding 10** 裸数字。
- **G · 行1 import `'.//PerfFlatList'`** — 路径 `.//` 双斜杠异常但可用；改 `'./PerfFlatList'`。
- **G · 行41 `ph` 逻辑依赖默认值字符串判断** — 若调用方传自定义且同时想要 i18n 会漏；属元编程风格，可接受但脆弱。
- **D · 输入筛选即时渲染** — 无问题。

**结论**：改 usePalette 消除双分支；chip 复用 Pill；病理路径修正。

---

## 17. AppToast.tsx

- **B · 行57-58 用 `palette.name==='dark'` 选取遮罩 rgba — 正确（属玻璃遮罩合理场景）**。
- **D · 行23-37 spring入场 + timing 退场，全 `useNativeDriver:true` — 合格**。
- **E · 行85-91 pill `paddingHorizontal:16/paddingVertical:10/borderRadius:22`** — 22 非 token(≥20/≤28 中间)；边距近 token。微调。
- **A · 行59 `rgba(255,255,255,0.08)` border、行67 白字 — 属高对比 toast 可接受**。
- **G · 行35 固定 2200ms + 无手动 dismiss** — 行为合理。

**结论**：实现规范。仅 22 圆角 token 化 + 边距。

---

## 18. ErrorBoundary.tsx

- **B · 行11-23 `ErrorFallback` 用 `isDark` + 双分支 — P1**：整文件用 useAppTheme/isDark，未用 usePalette（`containerDark:#1a1a1a`、`messageDark:#aaa` 等）。建议 usePalette。
- **A · 行41-47 硬编码 `#f5f5f5/#1a1a1a/#ff6f91/#555/#aaa/#fff`** — 未 token。
- **F · 行18-20 自绘"重试"按钮 + 白字粉底，与 StateViews/Button 重复**。
- **E · 行43 `title fontSize:20` 裸数字，`btn borderRadius:18` 恰=radiiAlias.button但未引用**。
- **G · 行44/47 `#fff` 白字**。

**结论**：usePalette + 复用统一 StateView(error) 作为 fallback，避免第三套错误页。

---

## 19. DanmakuSettingsSheet.tsx

- **B · 用 `useAppTheme isDark` + 双分支 — P0/P1**：行64 isDark，行158-185 大量 `#fff/#1b1b1b/#ddd/#222/#333/#999/#ccc/#aaa` 双分支。应用 usePalette。
- **C · 行52 Chip TouchableOpacity 无 activeOpacity（默认0.2）** — chip 按压反馈缺失；且 chip 视觉与 Pill/StateViews chip 重复（**F**）。
- **D · 行69 `Modal animationType="slide"`** — 系统默认 slide，无 spring。与 AppToast/MiniPlayer 的 motion 不一致（**P1**）。
- **A · 行159 `rgba(0,0,0,0.55)` 遮罩、行177-179 chip 背景** — 遮罩可接受；chip 背景色可 token。
- **G · 行40-61 内部 `Chip` 与全局 `Pill` 重复** — 见合并建议。
- **E · 行160-185 sheet 圆角22（同 FullScreenPlayer 22）** — 全站 sheet 圆角 22 均为硬编码 `borderTopLeftRadius:22`，未定义统一 token（应加 `sheetRadius`）。

**结论**：usePalette + 复用 Pill + 系统 sheet 动画改 motion + 圆角 22 抽 token。

---

## 20. ListItem.tsx（用户标注已看过，简要复核）

- **C · 行44-51 Pressable 内联 pressed 背景色 双分支 `palette.name==='dark'?'#2A2A2C':'#F2F2F7'`** — 硬编码按压底，未走 `palette.fill1/2` 或 press 态 token。建议 `palette.fill2`。
- **E · 行94 `paddingHorizontal:20` / `radii.md`=14** — 20 近 `insets.listInset`(20) 但裸写；leading marginRight 14 裸数字。
- **G · 行86-106 `Chevron` 无 pressed** — 可接受。

**结论**：按压底色可 token 化。

---

## 21. ScreenHeader.tsx（用户标注已看过，简要复核）

- **C · 行33 TouchableOpacity(返回键,圆形玻璃钮) 无 activeOpacity** — 默认 0.2 也算反馈；可改 ScalePressable 统一缩放手感。
- **B · 正确用 usePalette** — 合格。
- **E · 行80/81 backBtn 36/18 圆角** — 18 恰=radiiAlias.button 未引用；36 尺寸可读 spacing。
- **A · 行55 `rgba(0,0,0,0.30)` overlay 阴影 — 可接受（图片页可读性）**。

**结论**：微调 + ScalePressable 统一返回键。

---

## 22. AppScaffold.tsx（用户标注已看过，简要复核）

- **A · 行42 `(palette.name==='dark' ? '#000000' : '#F2F2F7')`** — **绕过 palette** 手写深浅底，但恰为场景默认底（dark 用纯黑、light 用近白）。应直接 `palette.background`（light=#F5F5F7, dark=#0B0B0F），现用的 #F2F2F7/#000000 与 palette.background 不一致（**P1**）。
- **E · 行61 paddingHorizontal:20（可读 insets.screenHorizontal）、行90 topBar paddingHorizontal:14** — 裸数字。

**结论**：背景改 `palette.background`，对齐 token。

---

## 组件合并 / 统一建议（按收益排序）

### A（最高收益，P0）. 统一「状态组件」——消除两套 EmptyState + 重复按钮
- 现状：`EmptyState.tsx`、`StateViews.tsx`(StateView/EmptyState/ErrorState)、`ErrorBoundary.tsx` 各自实现空态/错误态，且内部都自绘了「粉底白字主按钮」。
- 动作：以 `StateViews.tsx` 为准（已有 error/retry 语义），**删除 `EmptyState.tsx`**，全站调用点改指向 `StateViews`；其自绘 `btn` 内部替换为 `Button variant="filled"`。
- 收益：删一套组件 + 统一空/错误态视觉 + 消除 3 处同类按钮实现。

### B（P0）. 统一「主按钮/胶囊白字」语义 token
- 现状：`Button/Section/StateViews/Pill/FullScreenPlayer` 等 6+ 处手写 `'#FFFFFF'` 作为 tint 上白字。
- 动作：在 `colors.ts` 加 `onTint: '#FFFFFF'`（或 `onAccent`），统一引用。

### C（P0）. 统一「胶囊选择 chip」——StateViews chip、Pill、MemberPicker chip、DanmakuSettings `Chip` 四处重复
- 动作：统一改用 `Pill`（已支持 selected/accent/pressable scale）。MemberPicker 与 Danmaku 传入 selected 即可。

### D（P0）. 统一「深度面板/底部 sheet」——FullScreenPlayer queueSheet x DanmakuSettingsSheet x ZoomImageModal
- 现状：三处各自实现 `rgba(0,0,0,0.55)` 遮罩 + 底部圆角 22 sheet + 顶部 handle，且都用系统 `Modal animationType="slide"`。
- 动作：抽 `BottomSheet`(Modal + motion spring + 固定 `sheetRadius` token + handle)。三处复用，消除 sheet 22/ handle 描边 重复。同时 `animationType` 统一为自定义 spring 进出场。

### E（P1）. 统一「进度条组件」——MiniPlayerBar x FullScreenPlayer
- 现状：两处 API 相同(progressTrack/Fill/Thumb)、手势不同(PanResponder vs 原生 responder)。
- 动作：抽 `SeekBar({progress,onSeek,dragable})`，内部统一手势与主题。

### F（P1）. 统一「按压反馈」——推广 ScalePressable/Motion.tsx
- 现状：Button/Pill/ListItem 内联 scale，SectionHeader/FullScreenPlayer/Danmaku 多缺按下反馈，ScreenHeader 用 TouchableOpacity。
- 动作：全站交互元素统一走 `ScalePressable`（已有），删除各组件内联 scale 分支，保证反馈节奏一致。

### G（P1）. 统一连接源——NetworkImage 作为唯一图片入口
- 现状：CoverArt 仍用裸 `Image`。统一替换为 NetworkImage/NetworkBackground，保证 android fadeDuration 一致。

### H（P2）. 清理死代码
- `Button.tsx` 行130-131 `export { motion }`；`MiniPlayerBar.tsx` 行223-224 `void spacing`；`Skeleton.tsx` 行53 空 styles + 可能未用的 `SkeletonRow`；`FullScreenPlayer.tsx` 行372/404/418 未用样式（`topBtnOn/playIcon/queueUnavail`）及 Inner 行175 无效 `!visible` 判断；`GlassCard.tsx` 冗余 `Platform.select`。

---

## 全站最严重的 5 个共性问题（汇总）

1. **反主题实现泛滥（P0 最高）**——`FullScreenPlayer`/`MemberPicker`/`DanmakuSettingsSheet`/`ErrorBoundary`/`AppScaffold` 用 `isDark`+双分支或 `Colors.bgDark`，绕过 `usePalette`；`Loaders` 用手传 `dark` prop。大量「#fff/#000/#1a1a1a/#43434/背景/文字/图标」硬编码，主题 token 形同虚设。
2. **组件重复/冲突（P0）**——两套 `EmptyState`（EmptyState.tsx vs StateViews.tsx，同名导出冲突）；主按钮实现散落 Button/Pill/StateViews/ErrorBoundary；选选 chip 四处重复(Pill/MemberPicker/Danmaku-Chip)；底部 sheet 三处重复且圆角 22 无 token；进度条两处重复。
3. **动效不一致**——Modal/Sheet 全用系统 `animationType="slide/fade"`，与已在 MiniPlayerBar/AppToast 建立的 `motion` spring 体系割裂；`FullScreenPlayer` 下拉手势动画方向(translateX)与手势方向(dy)不符；`ZoomImageModal` 缩放/平移用 React state 驱动而非 `Animated`+`useNativeDriver`，低帧率。
4. **token 未用**——`radii.md/pill/button`、`spacing.*`、`typography.*` 在 CommunityPostCard/MemberPicker/StateViews/MiniPlayerBar 等大量裸数字(圆角16/13/22/18、字号11/13/15、间距10/14/24)，且多处与 theme 注释矛盾（Button 用 pill 而 theme 定义 button=18）。
5. **死代码/冗余**——`Button export { motion }`、`MiniPlayerBar void spacing`、`Skeleton` 空 styles、`FullScreenPlayer` 3 个未用样式 + 无效 `!visible` 双保险、`GlassCard` 冗余 `Platform.select`、`AppScaffold` 背景绕过 palette。
