# 液态玻璃引擎（shufajiaok/LiquidGlass）集成说明

上游：<https://github.com/shufajiaok/LiquidGlass>（MIT，Copyright (c) 2026 jiale）。与本项目 GPL-3.0 兼容。

## 状态

已集成并**默认开启**；设置页可一键关闭（即时生效、无需重启）。构建链路：原生源码随模块编译，无额外 AAR 依赖。

## 组成

| 层 | 位置 |
|:--|:--|
| 上游 Kotlin 源码 | `modules/liquid-glass-native/android/src/main/java/com/jiale/liquidglass/`（`LiquidGlass.kt` / `GlassBackdrop.kt` / `GlassDefaults.kt` / `RefractMode.kt`，原样引入） |
| Compose 桥视图 | `.../com/yayamsg/liquidglass/LiquidGlassComposeView.kt`（抓背板位图 + 渲染）+ `LiquidGlassComposeViewManager.kt` + `LiquidGlassPackage.kt` 注册 |
| JS 桥 / 参数档 | `src/native/LiquidGlassCompose.ts`（`GLASS_TUNING` 按角色给参数） |
| 全站唯一出口 | `src/components/GlassSurface.tsx`（Compose 引擎 / expo-blur 二选一） |

构建配置：模块 `build.gradle` 加 `kotlin.plugin.compose`(2.1.20) + `compose-bom 2024.12.01`；根 `android/build.gradle` 加插件 classpath。

## 开关（三级）

| 级别 | 位置 | 作用 |
|:--|:--|:--|
| 1（最强） | `GLASS_ENGINE = 'blur'`（`GlassSurface.tsx`） | 开发期硬开关，全局强制回退 expo-blur（发版排障用） |
| 2 | 设置页「外观 → 液态玻璃」= `settings.yaya_liquid_glass`（持久化，默认 `true`） | **用户退路**：关闭后全站玻璃立即改走 expo-blur，不用重启 |
| 3 | 组件 `engine="blur"` prop | 单实例覆盖（如内容从玻璃下滚过的地方） |

判定式：`isLiquidGlassComposeAvailable && GLASS_ENGINE !== 'blur' && liquidGlassEnabled && (engine ?? 'auto') !== 'blur'`

## 参数（`GLASS_TUNING`，覆盖用 `GLASS_TUNING_OVERRIDE`）

| 角色 | blurRadius | transparency | dispersion | edgeGlow | captureRefreshMs | backdropMode | filmColor |
|:--|--:|--:|--:|--:|--:|--:|:--|
| bar（底栏） | 9 | 0.72 | 0.45 | 1.15 | 150 | 1（整窗） | `#08FFFFFF` |
| selector（选中胶囊） | 6 | 0.72 | 0.40 | 1.10 | 150 | 1 | `#0CFFFFFF` |
| header | 11 | 0.70 | 0.42 | 1.10 | 0 | 1 | `#0AFFFFFF` |
| card | 11 | 0.68 | 0.38 | 1.10 | 0 | 0（背景层） | `#0CFFFFFF` |
| chip | 6 | 0.70 | 0.34 | 1.10 | 0 | 0 | `#0EFFFFFF` |

- `backdropMode`：`1` = 抓整窗内容（玻璃里能透出背后的列表/图，**底栏必须用**）；`0` = 只抓 `GLASS_BACKDROP_ID` 那一层（省）。
- `filmColor`：覆盖引擎默认的膜色（引擎默认取 `MaterialTheme.surface`，偏白显得"实"）。
- `captureRefreshMs`：背板重抓间隔；`0` = 抓一次用到底（静态背景）。

## 性能要点

- 主要开销 = `bar` 的整窗抓图（每 `captureRefreshMs` 一次，`bitmapScale=2` 半分辨率）。
- 背板位图在原生 `companion object` 里**全局共享一张**（N 个玻璃实例不各存一份），键 = `targetId|w|h|scale`。
- 关闭开关时 Compose 视图全部卸载；共享位图目前仍驻留（1080p/2 ≈ 2.6MB），后续可在实例归零时回收。
- 旧的两条原生路线（`useNativeDock` / `useAgsL`）在 `GlassSurface.tsx` 里是 `false &&` 硬关闭，只留作对照。

## 未完成 / 待验证

- 真机上滚动的 janky / p50 帧时间（Compose 引擎尚未实测；expo-blur 侧旧数据：janky ≤1.26%、p50 5~13ms）。
- 背板缓存的生命周期回收。
