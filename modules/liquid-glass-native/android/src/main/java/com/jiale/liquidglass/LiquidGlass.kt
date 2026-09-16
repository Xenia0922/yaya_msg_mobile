package com.jiale.liquidglass

import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// ---------------------------------------------------------------------------
// 玻璃配方：饱和度 + 亮度 + 对比度（并进同一个 ColorMatrix，零额外成本）
// ---------------------------------------------------------------------------

/**
 * 模糊半径。
 *
 * **按控件尺寸定，不是按背景定**：半径一旦接近控件高度，玻璃里就只剩一团均匀色块，
 * 看不出"背后的图被糊了"。12dp 是"能看出磨砂、还认得出背后是什么"的档位；
 * 表面（卡片）也用这个值——模糊强度是按控件定的，不是按面积定的。
 */
val GLASS_BLUR: Dp = 12.dp

/** 背板饱和度提升。液态玻璃会把透过去的颜色"提亮一点"，这是它不像普通半透明的关键。 */
private const val GLASS_SATURATION = 1.45f

/**
 * 对比度与亮度补偿。**模糊必然压低局部方差**，不补回来玻璃就是"灰"的。
 *
 * 这两项并进同一个 `ColorMatrix`（见 [glassColorMatrix]），所以是零额外成本。
 * 数值刻意保守：对比度再高一点，背景纹理就会变硬，看起来像"锐化过的照片"而不是玻璃。
 */
private const val GLASS_CONTRAST = 1.12f
private const val GLASS_BRIGHTNESS = 0.03f

/**
 * 出血系数：节点要比控件本身大一圈。
 *
 * 模糊要在边界**外**采到真实邻居像素（高斯约 3σ 才有完整支撑），不然边缘会被 clamp
 * 采样抹出一条假边；背景一复杂、控件一移动，那圈就会闪。
 */
private const val GLASS_BLEED_FACTOR = 1.8f

/**
 * 内缘亮带的高度：紧贴上下边缘那几条 dp，是"玻璃有厚度"的主要线索（见 [LiquidGlassSurface]）。
 *
 * 顶缘亮、底缘也有一点亮（那是光穿出去的位置）。**不要改成暗带**：暗的一侧会读成
 * "里面糊了一层阴影"，加过一版又被撤了。
 */
private val GLASS_RIM_TOP: Dp = 3.dp
private val GLASS_RIM_BOTTOM: Dp = 2.dp

/**
 * 上表面那层反射白雾的**绝对高度**（不按控件比例）。
 *
 * 由厚度感决定，与控件多大无关——和 [GLASS_RIM_TOP] 一个道理。
 * 曾经用的是"按比例 0.55"，那是给卡片那种大表面配的：放到 40dp 高的按钮上，
 * 上面 22dp 全在渐亮，正好盖住上半那条位移带，看起来"上半没有折射、效果都在偏下"。
 */
private val GLASS_TOP_SHEEN: Dp = 12.dp

/**
 * 玻璃的可调参数，通过 [LocalGlassParams] 一次性下发：改一个值，
 * 整棵子树的玻璃立刻跟着变，不用一层层往下传参。
 *
 * 开放的几项都满足"**能在真机上一边拖一边看**"这个条件：通透度、折射（做法 + 强度）、
 * 边缘光（宽度 + 亮度）、色散。模糊半径**不在这里**（它是 [LiquidGlassSurface] 的入参）——
 * 它必须跟着控件尺寸走，调大了玻璃里就只剩一团均匀色块，不是适合让人随手试的参数。
 */
data class GlassParams(
    /** 通透度 0..1：越大膜层越薄、越透。表面要承载正文，所以默认偏保守。 */
    val transparency: Float = GlassDefaults.TRANSPARENCY,
    /**
     * 折射强度：**轮廓处的位移量（dp）**。
     *
     * 存位移而不是放大倍率，因为两种做法都要用它：FIELD 直接当位移；
     * SCALE 按控件的半对角线换算成倍率。位移在两边都说得通，倍率只对后者有意义。
     */
    val refractDp: Float = GlassDefaults.REFRACT_DP,
    /** 折射做法：[RefractMode.SCALE]（整体放大）或 [RefractMode.FIELD]（环形位移场）。 */
    val refractMode: RefractMode = RefractMode.SCALE,
    /** 边缘光带的宽度（dp）：越宽整体越淡，见 [LiquidGlassSurface]。 */
    val edgeWidthDp: Float = GlassDefaults.EDGE_DP,
    /**
     * 色散（色差）强度 0..1：R/G/B 沿半径各错开一点，边缘出现彩边。
     * 做法见 [buildEdgeRings]——游戏后处理里那套 chromatic aberration，
     * 但位移只发生在**贴边一条带**里（不是整块缩放）。
     */
    val dispersion: Float = GlassDefaults.DISPERSION,
    /** 边缘光的亮度倍率。1.0 = 自动（越宽越淡），调大可以在很宽的边缘光下也看清。 */
    val edgeGlow: Float = GlassDefaults.EDGE_GLOW,
    /**
     * **复刻 0.5.1 的"错位"写法**（默认关 = 现在的正确写法）。
     *
     * 0.5.1 的 `BackdropSlice` 用的是 `Modifier.size` —— 它**服从父级约束**，于是节点被夹成了
     * **组件尺寸**（出血完全没生效），而 `offset(-bleed)` 与坐标换算仍按"组件 + 2×出血"来算。
     * 于是两件事同时发生：
     * ① 内容整体往**左上**偏一个 bleed；② **右下角**留出一条没有内容的带（只剩膜层）。
     * 合起来读作"光从左上斜着进来"，比真折射还强——0.5.1 "效果好"有很大一部分是它。
     *
     * ⚠️ 这是**错误对齐**，不是折射：滚动/拖动时玻璃里的内容会和外面脱节。
     * 它和 [refractMode] / [refractDp] 正交，开不开都不影响两种折射做法。
     */
    val legacyBackdrop: Boolean = GlassDefaults.LEGACY_BACKDROP,
)

val LocalGlassParams = staticCompositionLocalOf { GlassParams() }

/**
 * 玻璃组件要知道"身后是什么"，才能把那一片重画并模糊。
 *
 * 背板就是 [GlassBackdrop] 铺的那张全屏图，所以信息很少：图、尺寸、位置、遮罩浓度。
 * **这条路只对"静态背板"成立**：要模糊滚动的内容（列表从玻璃下面滚过去）就得换成
 * 图层捕获（haze 那类方案），那时这个类要重写。
 */
class Backdrop(
    val image: ImageBitmap?,
    val size: IntSize,
    val origin: Offset,
    val scrim: Float,
) {
    /** 没图或还没量到尺寸时不具备重画条件，调用方据此退化。 */
    val usable: Boolean get() = image != null && size.width > 0 && size.height > 0
}

private val NoBackdrop = Backdrop(image = null, size = IntSize.Zero, origin = Offset.Zero, scrim = 0f)

val LocalBackdrop = compositionLocalOf { NoBackdrop }

/**
 * 液态玻璃表面：**自己模糊自己身后的那一块背景**。
 *
 * 和"把整张背景糊掉 + 所有容器半透明"是两码事——那种做法背景一旦是糊的，
 * 页面上所有东西都跟着发灰；这里背景保持清晰，只有玻璃内部那一片是糊的，
 * 边缘还有高光和折射，看起来才像一块真的玻璃压在图上。
 *
 * **用在哪**：玻璃是"表面"的材质，不是"控件"的材质。承载内容的面（卡片、按钮、
 * 指示器）适合它；容器色本来就来自语义色的控件（开关、分段控件）压一层玻璃反而像贴了块胶带。
 * 一条经验：**面积大、数量多的面别用**——每块都要重画身后的背板再模糊，成本是"面积 × 块数"，
 * 一页几张卡片就够把预算吃光。
 *
 * 实现要点（三件事，缺一件就不像）：
 * 1. **重画背板并模糊**。Compose 的 `Modifier.blur` 只能模糊节点自己的内容，
 *    模糊不了"身后"，所以这里按 `ContentScale.Crop` 的同一套缩放与偏移把背景图再画一遍，
 *    只截取本控件周围那一小块，再对它做 `BlurEffect`（RenderEffect，真 GPU 模糊）。
 *    取小块不是优化偏好，是必须的：按整屏尺寸建模糊图层，每帧要处理 260 万像素。
 * 2. **透镜感**：以控件中心为轴把背板放大（默认 5%），饱和度 ×1.45，再补一点对比度与亮度。
 *    放大有两种做法（见 [RefractMode]）：**整体放大**（位移线性、中场也在动）与
 *    **环形位移场**（内圈不动、只有外圈在折，位移集中在边缘）。
 * 3. **边缘**：顶部高光 + 内缘亮带 + 边缘光带。半透明色块和玻璃的区别几乎全在这道边上。
 * 4. **色散**：R/G/B 在**贴边那一条带**里各错开一点点，边缘出现彩边——见 [buildEdgeRings]。
 *    物理上它和折射是同一件事的两面（不同波长的折射率不同），所以只在边缘看得出来。
 *
 * 低版本（API < 31）没有 RenderEffect，**不做重画**——画一块清晰的背景在玻璃里
 * 反而像挖了个洞，不如老老实实退化成半透明色块。
 */
@Composable
fun LiquidGlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = MaterialTheme.shapes.medium,
    blurRadius: Dp = GLASS_BLUR,
    /**
     * 边缘光带宽度。传 [Dp.Unspecified] 时用 [GlassParams.edgeWidthDp]。
     * **小控件要单独传小一点**（比如 32dp 高的指示器用 1.5dp）：同样的宽度在小控件上
     * 占比更大，会糊成一圈亮框。
     */
    edgeWidth: Dp = Dp.Unspecified,
    onClick: (() -> Unit)? = null,
    enabled: Boolean = true,
    content: @Composable BoxScope.() -> Unit,
) {
    val backdrop = LocalBackdrop.current
    val scheme = MaterialTheme.colorScheme
    val glass = LocalGlassParams.current
    // 设置里存的是"通透度"，膜层浓度是它的补数
    val tintAlpha = (1f - glass.transparency).coerceIn(0f, 1f)
    val density = LocalDensity.current
    val blurPx = with(density) { blurRadius.toPx() }
    val edgePx = with(density) {
        (if (edgeWidth == Dp.Unspecified) glass.edgeWidthDp.dp else edgeWidth).toPx()
    }
    // 色散带 = 边缘光再宽一点点（"彩边刚好裹住那道光"）；
    // 折射带 = 位移量 × [REFRACT_BAND_FACTOR]，夹在 [REFRACT_BAND_MIN]–[REFRACT_BAND_MAX]。
    // 两者都只跟"想位移多少"有关，具体占短边多少由 [buildEdgeRings] 夹。
    val dispersionBandPx = with(density) { (edgePx.toDp() + DISPERSION_BAND_EXTRA).toPx() }
    val refractShiftPx = with(density) { glass.refractDp.dp.toPx() }
    val refractBandPx = with(density) {
        (glass.refractDp * REFRACT_BAND_FACTOR)
            .dp
            .coerceIn(REFRACT_BAND_MIN, REFRACT_BAND_MAX)
            .toPx()
    }
    // 色散拉满时的径向位移。上限夹到带宽的一半——位移超过带宽就不像"一道边"了。
    val dispersionShiftPx = (glass.dispersion.coerceIn(0f, 1f) *
        with(density) { DISPERSION_MAX_SHIFT.toPx() })
        .coerceAtMost(dispersionBandPx * 0.5f)
    val canBlur = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val drawBackdrop = backdrop.usable && canBlur

    // 只写不在这里读：读它会在滚动时触发重组，见下方 BackdropSlice 的说明
    val posState = remember { mutableStateOf(Offset.Zero) }
    val sizeState = remember { mutableStateOf(IntSize.Zero) }

    Box(
        modifier = modifier
            .clip(shape)
            .onGloballyPositioned { coords ->
                // 记下自己在窗口里的位置：重画背板时要按这个位置裁出对应的一片
                val p = coords.positionInRoot() - backdrop.origin
                if (p != posState.value) posState.value = p
                if (coords.size != sizeState.value) sizeState.value = coords.size
            }
            .then(
                if (onClick != null) {
                    Modifier.clickable(enabled = enabled, onClick = onClick)
                } else {
                    Modifier
                },
            ),
    ) {
        val image = backdrop.image
        if (drawBackdrop && image != null) {
            // 外壳**不参与测量**：里面那个节点用 requiredSize 撑到"控件 + 出血"，
            // 直接当子节点的话会把 Box 一起撑大 → 下一帧按新尺寸再算一遍出血 →
            // 尺寸无限增长（宽度不受约束的玻璃会直接跑飞）。matchParentSize 让它只负责画。
            Box(Modifier.matchParentSize()) {
                BackdropSlice(
                    image = image,
                    backdrop = backdrop,
                    shape = shape,
                    posState = posState,
                    sizeState = sizeState,
                    blurPx = blurPx,
                    refractShiftPx = refractShiftPx,
                    refractBandPx = refractBandPx,
                    refractMode = glass.refractMode,
                    dispersionShiftPx = dispersionShiftPx,
                    dispersionBandPx = dispersionBandPx,
                    legacyBackdrop = glass.legacyBackdrop,
                )
            }
            // 与周围同浓度的遮罩。少了这层，玻璃内外的明暗对不上，一眼能看出是贴上去的
            Box(
                Modifier
                    .matchParentSize()
                    .background(scheme.surface.copy(alpha = backdrop.scrim)),
            )
        }

        // 玻璃自己的膜层。不能模糊时加重一点，至少还是个"磨砂"的样子
        Box(
            Modifier
                .matchParentSize()
                .background(
                    scheme.surface.copy(alpha = if (drawBackdrop) tintAlpha else tintAlpha + 0.35f),
                ),
        )

        // 顶部高光（上表面那层反射白雾）：玻璃有厚度才立得住，没有它就只是个半透明色块。
        // **不要在下缘再加暗带**：试过，读起来是"里面糊了层阴影"，不是厚度。
        //
        // 停靠点按**绝对高度**算（[GLASS_TOP_SHEEN]），不按比例。理由：
        // 这层表示的是"玻璃上表面的一道反射"，高度由厚度感决定，跟控件多大无关；
        // 而原来写死的 0.55 是给卡片那种大表面配的——在 40dp 高的按钮上意味着
        // **上面 22dp 全是渐亮白雾**，正好盖住上半那条位移带（折射带 = 位移 × 2.5 ≈ 12.5dp），
        // 于是"上半部分看不出折射，效果全挤在偏下"。改成绝对高度后上下对称，小控件也不再被糊住。
        Box(
            Modifier
                .matchParentSize()
                .drawBehind {
                    val sheen = if (size.height > 0f) {
                        (GLASS_TOP_SHEEN.toPx() / size.height).coerceIn(0f, 0.5f)
                    } else {
                        0f
                    }
                    drawRect(
                        Brush.verticalGradient(
                            0f to Color.White.copy(alpha = 0.20f),
                            sheen to Color.Transparent,
                            // 底缘那一点（0.07）同样收成绝对高度：光穿出去的位置
                            1f - sheen to Color.Transparent,
                            1f to Color.White.copy(alpha = 0.07f),
                        ),
                    )
                },
        )

        // **边缘光带**：不是 1dp 的硬描边，而是**由外到内分三层叠出来的一道渐变**——
        // 外沿最亮、往里快速衰减，读起来是"光在玻璃边缘晕开"。
        // 1dp 的实边会被读成"描了一道边"，这正是玻璃和塑料的分界。
        // 宽度来自 [GlassParams.edgeWidthDp]；越宽整体越淡（宽了还浓就会像塑料包边），
        // 亮度再由「边缘光亮度」倍率拉回来。
        Box(
            Modifier
                .matchParentSize()
                .drawBehind { drawGlassEdge(shape, edgePx, glass.edgeGlow) },
        )

        // **内缘亮带 —— "显厚"的关键那一层。**
        // 玻璃的厚度不在正面，在侧壁：光从边缘进去、在玻璃内部走一小段再从内表面出来，
        // 于是紧贴边缘的那几 dp 会比周围更亮（顶缘最明显，底缘是光穿出去的地方，也有一点）。
        // 这里用两条绝对高度的窄渐变带模拟，成本是两次 fill，忽略不计。
        // 刻意**不做暗带**——暗的一侧会读成"里面糊了层阴影"，那是被否过的做法。
        Box(Modifier.matchParentSize()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(GLASS_RIM_TOP)
                    .align(Alignment.TopCenter)
                    .background(
                        Brush.verticalGradient(
                            0f to Color.White.copy(alpha = 0.34f),
                            1f to Color.Transparent,
                        ),
                    ),
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(GLASS_RIM_BOTTOM)
                    .align(Alignment.BottomCenter)
                    .background(
                        Brush.verticalGradient(
                            0f to Color.Transparent,
                            1f to Color.White.copy(alpha = 0.16f),
                        ),
                    ),
            )
        }

        content()
    }
}

/**
 * 边缘光带：由外到内**分三层叠出一道渐变**，取代原来的 1dp 描边。
 *
 * 为什么不是一条实边：1dp 的实边会被读成"描了一道边"（那是塑料），
 * 而"外沿最亮、往里快速衰减"的一小片才读作光在玻璃边缘晕开。
 * 三层已经看不出台阶，再多层只是多几次 drawOutline。
 *
 * 两个刻意的设计：
 * - **越宽越淡**（峰值 alpha 按宽度反比衰减）：宽度变大而浓度不变的话，结果就是一圈
 *   塑料包边——那正好是加宽想避免的东西。想放宽又要亮，就把 [glow] 调大（即
 *   「边缘光亮度」），而不是把这条规律去掉：自动规律负责"别过头"，`glow` 负责"我要多亮"。
 * - 每层都比上一层淡（[EDGE_LAYER_ALPHAS]），且**顶缘比底缘亮**（[EDGE_BOTTOM_FACTOR]）：
 *   光是从上面来的。
 */
private const val EDGE_MIN_LAYERS = 3
private const val EDGE_MAX_LAYERS = 8
/**
 * 由外到内的亮度衰减表。层数随宽度变（宽了要分更多层才不显台阶），
 * 所以这里给满 8 档，实际用时按层数等距取样。
 */
private val EDGE_LAYER_ALPHAS = floatArrayOf(1f, 0.62f, 0.40f, 0.26f, 0.17f, 0.11f, 0.07f, 0.045f)
private const val EDGE_PEAK_ALPHA = 0.62f
private const val EDGE_MIN_ALPHA = 0.04f
private const val EDGE_MAX_ALPHA = 0.95f
private const val EDGE_BOTTOM_FACTOR = 0.5f
/** 每层最厚 1.2dp：再厚就会看出台阶，所以宽度一大就自动多分几层。 */
private const val EDGE_LAYER_MAX_DP = 1.2f

private fun DrawScope.drawGlassEdge(shape: Shape, edgeWidthPx: Float, glow: Float) {
    if (edgeWidthPx <= 0.2f) return
    val widthDp = edgeWidthPx.toDp().value
    val layers = (widthDp / EDGE_LAYER_MAX_DP).roundToInt().coerceIn(EDGE_MIN_LAYERS, EDGE_MAX_LAYERS)
    val step = edgeWidthPx / layers
    // 越宽越淡：宽了还浓就会读成塑料包边；glow 是使用者对这个规律的再平衡
    val peak = (EDGE_PEAK_ALPHA * (1.4f / widthDp) * glow.coerceAtLeast(0f))
        .coerceIn(EDGE_MIN_ALPHA, EDGE_MAX_ALPHA)

    for (i in 0 until layers) {
        val tableIndex = (i * EDGE_LAYER_ALPHAS.size / layers).coerceIn(0, EDGE_LAYER_ALPHAS.size - 1)
        val alpha = peak * EDGE_LAYER_ALPHAS[tableIndex]
        if (alpha <= 0.01f) continue
        // 外沿那一层要往里挪半个步长：描边是"骑"在轮廓线上的，不挪的话一半会被裁掉
        val inset = (i + 0.5f) * step
        val w = size.width - inset * 2f
        val h = size.height - inset * 2f
        if (w <= 0f || h <= 0f) continue
        val outline = shape.createOutline(Size(w, h), layoutDirection, this)
        translate(left = inset, top = inset) {
            drawOutline(
                outline = outline,
                brush = Brush.verticalGradient(
                    listOf(
                        Color.White.copy(alpha = alpha),
                        Color.White.copy(alpha = alpha * EDGE_BOTTOM_FACTOR),
                    ),
                ),
                style = Stroke(width = step),
            )
        }
    }
}

/**
 * 把背板上对应的那一片重画出来、按选定的折射做法变形、按色散分通道、再模糊。
 *
 * 几何上比控件大一圈出血（见 [GLASS_BLEED_FACTOR]），节点往左上偏同样的距离，
 * 于是控件正好盖在节点中央；放大以**控件中心**为轴。
 *
 * **早期版本这里用的是 `Modifier.size`**，而 `size()` **会服从父级约束**——控件被
 * `height(40.dp)` 钉死时节点被夹成控件尺寸，出血一点都没生效，模糊直接在边界上做
 * clamp 采样（滚动时边缘闪的根因）；节点还整体偏了 14.4dp，底部与右侧各有一条没被
 * 背板覆盖的带。所以必须用 `requiredSize`：先满足出血，再由外层决定控件多大。
 */
@Composable
private fun BackdropSlice(
    image: ImageBitmap,
    backdrop: Backdrop,
    shape: Shape,
    posState: MutableState<Offset>,
    sizeState: MutableState<IntSize>,
    blurPx: Float,
    refractShiftPx: Float,
    refractBandPx: Float,
    refractMode: RefractMode,
    dispersionShiftPx: Float,
    dispersionBandPx: Float,
    /** 复刻 0.5.1 的错位写法（节点被夹成组件尺寸）。见 [GlassParams.legacyBackdrop]。 */
    legacyBackdrop: Boolean,
) {
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val bleed = max(blurPx * GLASS_BLEED_FACTOR, 1f)

    // 尺寸几乎不变，所以这里在组合阶段读一次没问题（会跟着尺寸变化重组）
    val element = sizeState.value
    val nodeWidthDp = with(density) { (element.width + bleed * 2).toDp() }
    val nodeHeightDp = with(density) { (element.height + bleed * 2).toDp() }
    // 组件自己的尺寸（不带出血）：只有在 legacy 那条路上才用
    val elementWidthDp = with(density) { element.width.toDp() }
    val elementHeightDp = with(density) { element.height.toDp() }
    val bleedDp = with(density) { bleed.toDp() }

    // 背板是按 ContentScale.Crop 铺满屏幕的：先自己算一遍它的缩放与居中偏移，
    // 才能把"屏幕坐标"换算成"图片坐标"。这套算法不依赖具体的 ContentScale 实现，
    // 但改动 ImageBackground 的绘制方式时必须同步改这里。
    val screenW = backdrop.size.width.toFloat()
    val screenH = backdrop.size.height.toFloat()
    val imageW = image.width.toFloat()
    val imageH = image.height.toFloat()
    val cropScale = if (imageW > 0f && imageH > 0f) max(screenW / imageW, screenH / imageH) else 0f
    val drawnW = imageW * cropScale
    val drawnH = imageH * cropScale
    val cropLeft = (screenW - drawnW) / 2f
    val cropTop = (screenH - drawnH) / 2f

    val glassFilter = remember { ColorFilter.colorMatrix(glassColorMatrix()) }
    // 色散：三个单通道 ColorFilter，建一次就够（矩阵是常量）
    val channelFilters = remember { List(3) { ColorFilter.colorMatrix(glassChannelMatrix(it)) } }

    // FIELD 做法的折射交给"环"（逐层改采样点）；SCALE 做法交给图层的整体缩放，
    // 所以它的环只带色散、折射系数为 0。
    val ringRefractPx = if (refractMode == RefractMode.FIELD) refractShiftPx else 0f
    val refractive = ringRefractPx > 0.004f
    // 只有色散真的开着才分三遍；关掉时走一遍全彩，成本与从前一样
    val dispreaded = dispersionShiftPx > 0.004f && dispersionBandPx > 0.5f
    val passes = if (dispreaded) 3 else 1

    // 环只跟尺寸和参数有关、与位置无关 → remember 缓存。
    // 每帧构造几个环（每个两次 createOutline + 一次 Path.op）是真实的分配开销，
    // 缓存掉滚动时就没有这部分了。
    val glassRings = remember(
        element.width,
        element.height,
        ringRefractPx,
        refractBandPx,
        dispersionShiftPx,
        dispersionBandPx,
    ) {
        buildEdgeRings(
            shape = shape,
            elementW = element.width.toFloat(),
            elementH = element.height.toFloat(),
            bleed = bleed,
            refractShiftPx = ringRefractPx,
            refractBandPx = refractBandPx,
            dispersionShiftPx = dispersionShiftPx,
            dispersionBandPx = dispersionBandPx,
            layoutDirection = layoutDirection,
            density = density,
        )
    }

    // 三遍是加性的，底图必须避开环带（理由见 [buildBaseClip]）。路径同样只跟尺寸有关 → 缓存。
    val baseClip = remember(element.width, element.height, glassRings, passes, legacyBackdrop) {
        val region = glassRings.region
        if (passes > 1 && region != null) {
            buildBaseClip(
                // legacy 时节点只有组件那么大，底图也跟着裁到组件范围（多画的部分反正会被丢弃）
                nodeW = if (legacyBackdrop) element.width.toFloat() else element.width + bleed * 2f,
                nodeH = if (legacyBackdrop) element.height.toFloat() else element.height + bleed * 2f,
                ringRegion = region,
            )
        } else {
            null
        }
    }

    // **0.5.1 的错位写法**：那版用 `Modifier.size`（服从父级约束）→ 节点被夹成**组件尺寸**，
    // 但下面的 `offset(-bleed)` 和坐标换算仍按"组件 + 2×出血"算。两件事一起发生：
    // 内容整体偏左上，而节点覆盖不到玻璃的右下角 → 那条带上没有内容、只剩膜层。
    // 关掉时是现在的正确写法：节点真的带一圈出血，模糊在界外采到真实邻居。
    val sizeModifier = if (legacyBackdrop) {
        Modifier.size(elementWidthDp, elementHeightDp)
    } else {
        Modifier.requiredSize(nodeWidthDp, nodeHeightDp)
    }
    Canvas(
        modifier = Modifier
            .offset(x = -bleedDp, y = -bleedDp)
            .then(sizeModifier)
            .graphicsLayer {
                val size = sizeState.value
                compositingStrategy = CompositingStrategy.Offscreen
                // SCALE 做法：整层以控件中心为轴放大。倍率由"轮廓处想位移多少"反推，
                // 用半对角线做参考长度，这样和 FIELD 那套的位移量级能对上。
                if (refractMode == RefractMode.SCALE && refractShiftPx > 0.004f) {
                    val nodeW = size.width + bleed * 2
                    val nodeH = size.height + bleed * 2
                    // 以控件中心（不是节点中心）为轴放大，这样透镜感是跟着控件动的
                    if (nodeW > 0 && nodeH > 0) {
                        transformOrigin = TransformOrigin(
                            (bleed + size.width / 2f) / nodeW,
                            (bleed + size.height / 2f) / nodeH,
                        )
                    }
                    val halfDiagonal = hypot(size.width / 2f, size.height / 2f)
                    val scale = 1f + refractShiftPx / max(halfDiagonal, 1f)
                    scaleX = scale
                    scaleY = scale
                }
                // 真模糊：RenderEffect。API 31 起可用，低版本这段根本不会走到
                if (blurPx > 0.5f) {
                    renderEffect = BlurEffect(blurPx, blurPx, TileMode.Clamp)
                }
            },
    ) {
        // 位置在 draw 阶段才读：滚动时只失效绘制，不触发重组
        val elementSize = sizeState.value
        if (elementSize.width <= 0 || elementSize.height <= 0 || cropScale <= 0f) return@Canvas

        val elementPos = posState.value
        val dstX = cropLeft - (elementPos.x - bleed)
        val dstY = cropTop - (elementPos.y - bleed)
        val centerX = bleed + elementSize.width / 2f
        val centerY = bleed + elementSize.height / 2f

        // 把整幅背板按 [scaleX]/[scaleY] 画一遍（轴心是控件中心）。
        // 位移 = 缩放增量 × 到中心的距离：位置越远动得越多，所以带上"轮廓处最大"这件事
        // 是靠把增量除以半宽 / 半高换来的，两个方向各自折算 → 长边短边一致。
        fun drawSlice(scaleX: Float, scaleY: Float, filter: ColorFilter, blend: BlendMode) {
            drawImage(
                image = image,
                dstOffset = IntOffset(
                    (centerX + (dstX - centerX) * scaleX).roundToInt(),
                    (centerY + (dstY - centerY) * scaleY).roundToInt(),
                ),
                dstSize = IntSize((drawnW * scaleX).roundToInt(), (drawnH * scaleY).roundToInt()),
                colorFilter = filter,
                blendMode = blend,
            )
        }

        val rings = glassRings.rings
        val region = glassRings.region

        if (passes == 1) {
            // 单遍：底图铺满（不裁），环用 SrcOver 盖上去。
            // 这条路上没有加性叠加，底图与环重叠也没关系，省掉一次大面积的裁剪。
            drawSlice(1f, 1f, glassFilter, BlendMode.SrcOver)
            rings.forEach { ring ->
                clipPath(ring.path) {
                    drawSlice(1f + ring.refractX, 1f + ring.refractY, glassFilter, BlendMode.SrcOver)
                }
            }
        } else {
            // 三遍：底图**只画一次**（全彩，裁掉环带），带上按 R/G/B 各画一遍、加性叠加。
            // 底图只画一次很重要——它覆盖的是整个控件面积，那才是填充率的大头。
            if (baseClip != null) {
                clipPath(baseClip) { drawSlice(1f, 1f, glassFilter, BlendMode.SrcOver) }
            } else {
                drawSlice(1f, 1f, glassFilter, BlendMode.SrcOver)
            }
            for (channel in 0..2) {
                // R 往里收、G 不动、B 往外偏（蓝光折射率最高）
                val sign = (channel - 1).toFloat()
                val filter = channelFilters[channel]
                if (sign == 0f && !refractive && region != null) {
                    // G 通道一点位移都没有（三种做法下都是恒等），整条带**一次画完**，
                    // 省掉 steps 次带裁剪的绘制。
                    clipPath(region) { drawSlice(1f, 1f, filter, BlendMode.Plus) }
                } else {
                    rings.forEach { ring ->
                        clipPath(ring.path) {
                            drawSlice(
                                scaleX = 1f + ring.refractX + sign * ring.dispX,
                                scaleY = 1f + ring.refractY + sign * ring.dispY,
                                filter = filter,
                                blend = BlendMode.Plus,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * # 边缘带：折射与色散共用同一套"逐层内缩"的环
 *
 * 两种效果都只发生在**贴边的一条带**里，位移沿带从轮廓处的最大值平滑衰减到 0
 * （`smoothstep`），带以里严格不动。位移量按两个方向分别折算（÷ 半宽 / 半高），
 * 所以**长边短边一致**。
 *
 * **为什么必须是"带"而不是"整块缩放"**（踩出来的）：
 * - 位移随半径线性增长的话，中心那一大片都小于一个像素，到某个半径才勉强看得见 →
 *   屏幕上会出现一道"中心没做效果"的圆边界（色散第一版就是这么翻车的）；
 * - 等比缩放让位移 ∝ 到中心的距离 → 宽卡片左右两侧的位移比上下大好几倍。
 *
 * **合成一套环是省性能的关键。** 一开始折射一套椭圆环（16 个）+ 色散一套环（8 个 ×
 * 3 通道）各画各的，还互相重叠（要在每个折射环上再做一次 Path.op 把色散带减掉）。
 * 现在两者共用一套 annuli，每个环同时带"折射位移"和"色散位移"两个系数。
 *
 * **环数刻意压得很少（3–6）**：整层随后会被 σ≈7dp 的模糊处理，
 * 比模糊核细得多的台阶根本传不到屏幕上，多分环只是白花绘制次数。
 */
private const val EDGE_STEPS_MIN = 3
private const val EDGE_STEPS_MAX = 6

/** 每层最厚这个值（dp）：层数 = ⌈带宽 / 它⌉，夹在 [EDGE_STEPS_MIN]–[EDGE_STEPS_MAX]。 */
private val EDGE_LAYER_MAX: Dp = 3.dp

/**
 * ⚠️ **环与环必须精确相邻：不留缝，也不重叠。**
 *
 * 这里原先留了 0.8px 的"重叠量"想盖住抗锯齿的缝，但方向正好反了——实际留出的是**缝**。
 * 无论缝还是重叠都会毁掉颜色，因为三通道的覆盖集合要严格一致：
 *
 * - 缝里：G 通道还画（它走的是 `region` 那一次整块绘制），R/B 逐环画却没有 → **只剩 G，偏青绿**；
 * - 重叠处：R/B 被加两次而 G 只加一次 → **偏品红**。
 *
 * 这就是"整体放大 + 色散"会显出一条杂色带、而「边缘折射」看不出来的原因：
 * 后者三通道都逐环走（`sign == 0` 的捷径只在没有折射位移时才走），错了也是一起错。
 *
 * 接缝那一两个亚像素的抗锯齿，交给整层那道 σ≈12dp 的模糊——它比任何补丁都管用。
 */

/**
 * 折射带比"位移量"宽多少倍。
 *
 * 位移越大就需要越长的距离把它衰减回 0，否则边缘会被拉得很陡。固定成 2.5 倍还有个好处：
 * **带宽随强度自动收放**——折射调小时效果面积同步变小，绘制开销也跟着降。
 */
private const val REFRACT_BAND_FACTOR = 2.5f
private val REFRACT_BAND_MIN: Dp = 10.dp
private val REFRACT_BAND_MAX: Dp = 32.dp

/** 色散带比边缘光宽出来多少——"略宽一点点"，让彩边刚好裹住那道光。 */
private val DISPERSION_BAND_EXTRA: Dp = 8.dp

/** 色散拉满时，轮廓处的径向位移。再大就不像玻璃边、像重影了。 */
private val DISPERSION_MAX_SHIFT: Dp = 4.5.dp

/** 带最多占短边的这个比例——再宽就不是"一道边"了。 */
private const val EDGE_BAND_MAX_FRACTION = 0.35f

/**
 * 单通道 + 玻璃提色的矩阵。
 *
 * "只取一个通道"就是乘一个对角线上只有一个 1 的矩阵；把它乘在提色矩阵左边，
 * 结果等价于**只保留提色矩阵的那一行**（另外两行连平移量一起归零）。
 * alpha 行照抄，所以每一遍画出来都是"不透明的单色"，三遍加性叠起来正好还原全彩。
 */
private fun glassChannelMatrix(channel: Int): ColorMatrix {
    val source = glassColorMatrix().values
    val out = FloatArray(20)
    for (column in 0 until 5) {
        out[channel * 5 + column] = source[channel * 5 + column]
        out[15 + column] = source[15 + column]
    }
    return ColorMatrix(out)
}

/**
 * 玻璃的颜色矩阵：**饱和度 → 对比度 → 亮度**，三项并进同一个矩阵。
 *
 * 加对比度和亮度是相对"只做模糊 + 饱和"唯一的增量，动机很实在：模糊一定会压低局部方差，
 * 只提饱和度的话玻璃看起来"灰、平"。两项在一个矩阵里完成，所以是零额外成本。
 *
 * 两个易错点：
 * - **顺序不能反**：先提饱和再加对比度，饱和带来的色偏才会被一起压回正常范围。
 * - 平移列是 **0..255 色阶**，不是 0..1。对比度以中灰（127.5）为轴展开，
 *   所以它的平移量是 `127.5 × (1 − c)`。
 */
private fun glassColorMatrix(): ColorMatrix {
    val saturation = ColorMatrix().apply { setToSaturation(GLASS_SATURATION) }
    val c = GLASS_CONTRAST
    val shift = 127.5f * (1f - c) + GLASS_BRIGHTNESS * 255f
    val contrast = ColorMatrix(
        floatArrayOf(
            c, 0f, 0f, 0f, shift,
            0f, c, 0f, 0f, shift,
            0f, 0f, c, 0f, shift,
            0f, 0f, 0f, 1f, 0f,
        ),
    )
    return saturation.apply { timesAssign(contrast) }
}

// ---------------------------------------------------------------------------
// 边缘带：折射与色散共用的逐层内缩环
// ---------------------------------------------------------------------------

/**
 * 一个贴边的环（annulus）：由"轮廓内缩 dOut / dIn 两条路径"做差集切出来。
 *
 * 采样变换有两项，因为它们来自两个独立的效果：
 * - [refractX] / [refractY]：**折射**的位移比例（轮廓处的位移 ÷ 半宽 / 半高），
 *   所有通道一致 → 整块一起被推；
 * - [dispX] / [dispY]：**色散**的位移比例，按通道取正负号。
 *
 * 绘制时 `scaleX = 1 + refractX + sign × dispX`，`sign` = R:−1 / G:0 / B:+1
 * ——B 往外偏、R 往里收，照蓝光折射率最高这条物理规律来。
 *
 * **比例而不是像素**是刻意的：除以半宽 / 半高之后，长边和短边在轮廓处的实际位移量才一致。
 */
private class GlassRing(
    val path: Path,
    val refractX: Float,
    val refractY: Float,
    val dispX: Float,
    val dispY: Float,
)

/**
 * 一次绘制要用到的全部环，以及它们**合起来盖住的那块区域**（[region]）。
 *
 * `region` 有两个用途：让底图让开（三遍是加性叠加的，底图若与环重叠，
 * 同一个通道会被加两次、亮度翻倍），以及给"没有位移的那个通道"整条带一次画完。
 */
private class GlassRings(val rings: List<GlassRing>, val region: Path?)

/**
 * 逐层内缩构造边缘环。**折射与色散共用这一套**——两者只是位移量不同，
 * 沿带的衰减曲线（`smoothstep`）完全一样。
 *
 * 几何用 `Shape.createOutline` 逐层内缩，**不用椭圆环**：椭圆和外接矩形在角上对不齐
 * （椭圆的 ρ=1 在角上其实落在轮廓里面），带会横穿圆角、看起来像角上被抹了一块。
 * 逐层内缩得到的才是与轮廓**等宽**的一圈，顺带把"胶囊的百分比圆角内缩后要变小"
 * 交给 Shape 自己处理。
 *
 * 环数按带宽自适应（每层最厚 [EDGE_LAYER_MAX]，夹在 [EDGE_STEPS_MIN]–[EDGE_STEPS_MAX]）：
 * 整层随后会被 σ≈7dp 的模糊处理，比模糊核细得多的台阶传不到屏幕上，多分环只是白花绘制次数。
 */
private fun buildEdgeRings(
    shape: Shape,
    elementW: Float,
    elementH: Float,
    bleed: Float,
    refractShiftPx: Float,
    refractBandPx: Float,
    dispersionShiftPx: Float,
    dispersionBandPx: Float,
    layoutDirection: LayoutDirection,
    density: Density,
): GlassRings {
    if (elementW <= 0f || elementH <= 0f) return GlassRings(emptyList(), null)

    val refractOn = refractShiftPx > 0.004f && refractBandPx > 0.5f
    val dispersionOn = dispersionShiftPx > 0.004f && dispersionBandPx > 0.5f
    if (!refractOn && !dispersionOn) return GlassRings(emptyList(), null)

    val halfW = max(elementW / 2f, 1f)
    val halfH = max(elementH / 2f, 1f)
    // 带最多占短边的一小部分——再宽就不是"一道边"了
    val cap = min(elementW, elementH) * EDGE_BAND_MAX_FRACTION
    val refBand = if (refractOn) refractBandPx.coerceAtMost(cap) else 0f
    val dispBand = if (dispersionOn) dispersionBandPx.coerceAtMost(cap) else 0f
    val bandPx = max(refBand, dispBand)
    if (bandPx <= 0.5f) return GlassRings(emptyList(), null)

    val layerMaxPx = with(density) { EDGE_LAYER_MAX.toPx() }
    val steps = ceil(bandPx / layerMaxPx).toInt().coerceIn(EDGE_STEPS_MIN, EDGE_STEPS_MAX)

    val rings = (0 until steps).map { i ->
        val outerInset = bandPx * i / steps
        val innerInset = bandPx * (i + 1) / steps
        val outer = insetOutlinePath(shape, elementW, elementH, bleed, outerInset, layoutDirection, density)
        // 内边界**精确**落在下一环的外边界上：不留缝、也不重叠（理由见上面那段 ⚠️）
        val inner = insetOutlinePath(shape, elementW, elementH, bleed, innerInset, layoutDirection, density)
        val path = Path().apply { op(outer, inner, PathOperation.Difference) }

        // 位移沿带衰减：轮廓处最大、带的内沿归零。两种效果各按自己的带宽算，
        // 所以调小折射强度时折射的有效范围会同步收窄（面积和开销一起降）。
        val depth = bandPx * (i + 0.5f) / steps
        val gRefract = if (refBand > 0f) smoothStep((1f - depth / refBand).coerceIn(0f, 1f)) else 0f
        val gDispersion = if (dispBand > 0f) smoothStep((1f - depth / dispBand).coerceIn(0f, 1f)) else 0f

        GlassRing(
            path = path,
            refractX = refractShiftPx * gRefract / halfW,
            refractY = refractShiftPx * gRefract / halfH,
            dispX = dispersionShiftPx * gDispersion / halfW,
            dispY = dispersionShiftPx * gDispersion / halfH,
        )
    }

    // 环合起来盖住的区域 = 轮廓本身 − 最内那一环的内边界。
    // ⚠️ 它必须与"所有环的并集"**严格相等**：G 通道在无折射位移时走的是"整块 region 一次画完"
    // 那条捷径，区域一旦对不上（多一块或少一块），三通道的覆盖就不一致了 → 偏色。
    val region = Path().apply {
        op(
            insetOutlinePath(shape, elementW, elementH, bleed, 0f, layoutDirection, density),
            insetOutlinePath(shape, elementW, elementH, bleed, bandPx, layoutDirection, density),
            PathOperation.Difference,
        )
    }
    return GlassRings(rings, region)
}


/**
 * 底图要避开的区域之外，全都是底图的：`节点矩形 − 环带`。
 *
 * 这个差集正好等于"出血边 + 轮廓以内的内部"——也就是底图该覆盖的两块。
 */
private fun buildBaseClip(nodeW: Float, nodeH: Float, ringRegion: Path): Path {
    val nodeRect = Path().apply { addRect(Rect(0f, 0f, nodeW, nodeH)) }
    return Path().apply { op(nodeRect, ringRegion, PathOperation.Difference) }
}

/**
 * 轮廓内缩 [inset] 像素之后的路径，坐标已换算到节点坐标系。
 *
 * 用 `Shape.createOutline` 而不是自己减圆角：胶囊那种百分比圆角，内缩后半径应该跟着变小，
 * 这件事只有 Shape 自己会做对（`RoundedCornerShape` 会按新尺寸重新夹取半径）。
 */
private fun insetOutlinePath(
    shape: Shape,
    elementW: Float,
    elementH: Float,
    bleed: Float,
    inset: Float,
    layoutDirection: LayoutDirection,
    density: Density,
): Path {
    val w = (elementW - inset * 2f).coerceAtLeast(0.5f)
    val h = (elementH - inset * 2f).coerceAtLeast(0.5f)
    val path = Path()
    when (val outline = shape.createOutline(Size(w, h), layoutDirection, density)) {
        is Outline.Rounded -> path.addRoundRect(outline.roundRect)
        is Outline.Rectangle -> path.addRect(outline.rect)
        is Outline.Generic -> path.addPath(outline.path)
    }
    path.translate(Offset(bleed + inset, bleed + inset))
    return path
}

/** 3t² − 2t³：两端一阶导为 0，所以内圈与外圈接上时看不出拐点。 */
private fun smoothStep(t: Float): Float = t * t * (3f - 2f * t)
