package com.jiale.liquidglass

import androidx.compose.ui.unit.dp

/**
 * 默认值与推荐区间。
 *
 * **区间是数据约束**（落盘的值必须落在里面），所以和默认值放在一起，
 * 而不是散在做设置界面的代码里。这一组数值是在真机上一档档拖出来的，
 * 可以直接当滑块的取值范围用。
 */
object GlassDefaults {

    // ---- 通透度：越大膜层越薄、越透 ----
    const val TRANSPARENCY = 0.38f
    const val TRANSPARENCY_MIN = 0.05f
    const val TRANSPARENCY_MAX = 0.70f

    // ---- 折射强度：轮廓处的位移量（dp）----
    const val REFRACT_DP = 5.0f
    const val REFRACT_DP_MIN = 0.0f
    const val REFRACT_DP_MAX = 12.0f

    // ---- 边缘光带宽度（dp）----
    const val EDGE_DP = 2.0f
    const val EDGE_DP_MIN = 0.6f
    const val EDGE_DP_MAX = 10.0f

    // ---- 边缘光亮度倍率 ----
    const val EDGE_GLOW = 1.0f
    const val EDGE_GLOW_MIN = 0.4f
    const val EDGE_GLOW_MAX = 2.5f

    // ---- 色散（色差）强度 ----
    const val DISPERSION = 0.35f
    const val DISPERSION_MIN = 0f
    const val DISPERSION_MAX = 1f

    /** 背景遮罩浓度：浅色图调深、深色图调浅，保证叠在上面的文字读得清。 */
    const val SCRIM = 0.55f
    const val SCRIM_MIN = 0f
    const val SCRIM_MAX = 0.95f

    /**
     * **复刻 0.5.1 的"错位"写法**（默认关 = 现在的正确写法）。
     *
     * 打开后节点改用 `Modifier.size`（服从父级约束）→ 被夹成组件尺寸，出血完全不生效，
     * 于是内容整体偏左上、且玻璃右下角空出一条只剩膜层的带。**这是错误对齐，不是折射。**
     * 详见 [GlassParams.legacyBackdrop]。
     */
    const val LEGACY_BACKDROP = false

    /**
     * 给**小控件**用的模糊半径与边缘光宽度（按钮 ≈ 40dp 高、指示器 ≈ 32dp 高）。
     *
     * 这条经验比数值本身重要：**半径一旦接近控件高度，玻璃里就只剩一团均匀色块**，
     * 边缘光也是"占控件多少"被感知的，不收窄就会糊成一圈亮框。
     * 所以小控件不要用 [LiquidGlassSurface] 的默认值，显式传这两个。
     */
    val COMPACT_BLUR = 6.dp
    val COMPACT_EDGE_WIDTH = 1.2.dp
}
