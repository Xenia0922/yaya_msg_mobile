package com.jiale.liquidglass

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.IntSize
import java.io.File

/**
 * 背板：一张铺满的图 + 一层遮罩；**同时把背板信息通过 [LocalBackdrop] 提供给下面的玻璃**。
 *
 * 没有图（`image == null`）时只画一层主题底色，调用方不需要分支。
 *
 * 三层职责，缺一不可：
 *
 * 1. **底色不能省**：Compose 里 Scaffold / 顶栏 / 底栏通常都是透明的，这里不铺底色，
 *    窗口背景就会漏出来（深色模式下的"白色状态栏条带"就是这么来的）。
 * 2. **遮罩浓度由使用者调**：这不是装饰性选项——背景图深浅不一、文字又是固定的主题色，
 *    没有遮罩的话浅色图上会直接看不清。默认 [GlassDefaults.SCRIM]。
 * 3. **背板本身始终清晰**：模糊归各个玻璃组件自己负责（见 [LiquidGlassSurface]）。
 *    试过"有玻璃就把整张背景糊掉"，结果是背景一糊、页面上所有东西都跟着发灰；
 *    真玻璃只该糊自己那一片。
 *
 * ⚠️ **铺图用的是 `ContentScale.Crop`，这个算法和 [LiquidGlassSurface] 里重画背板的
 * 那套是同一份**（"屏幕坐标 → 图片坐标"的换算）。要改铺图方式，两处必须同步改，
 * 否则玻璃里显示的那一片会和周围对不上。
 */
@Composable
fun GlassBackdrop(
    image: ImageBitmap?,
    modifier: Modifier = Modifier,
    scrimAlpha: Float = GlassDefaults.SCRIM,
    content: @Composable () -> Unit,
) {
    var rootPos by remember { mutableStateOf(Offset.Zero) }
    var rootSize by remember { mutableStateOf(IntSize.Zero) }
    val safeScrim = scrimAlpha.coerceIn(0f, 1f)
    // 只在真正变化时换新实例：这个对象每次重组都新建的话，玻璃组件会跟着白重组一遍
    val backdrop = remember(image, rootSize, rootPos, safeScrim) {
        Backdrop(image = image, size = rootSize, origin = rootPos, scrim = safeScrim)
    }

    // 无论有没有图都先铺主题底色，保证不透明容器，绝不透出窗口背景
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .onGloballyPositioned { coords ->
                if (coords.size != rootSize) rootSize = coords.size
                val p = coords.positionInRoot()
                if (p != rootPos) rootPos = p
            },
    ) {
        if (image != null) {
            Image(
                bitmap = image,
                contentDescription = null,
                // Crop：铺满全屏且保持比例，宁可裁掉边缘也不要把人像拉变形。
                // LiquidGlass 里重画背板时用的是同一套算法，改这里要同步改那边。
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // 遮罩用主题的 surface 色而不是纯黑——深色模式下叠黑会死成一片，
            // 叠 surface 才能跟着明暗模式走
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = safeScrim)),
            )
        }

        CompositionLocalProvider(LocalBackdrop provides backdrop, content = content)
    }
}

/**
 * 从文件读一张背板图：`remember` 住，文件没变就不重复解码。
 *
 * 解码在主线程上做，**只适合已经处理过尺寸的小图**（比如缩到 2048px 长边的那种）。
 * 大图请自己在后台线程解码好，再用 [GlassBackdrop] 的 `ImageBitmap` 重载。
 */
@Composable
fun rememberBackdropImage(file: File?): ImageBitmap? {
    val bitmap = remember(file) {
        file?.takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.absolutePath) }
    }
    return remember(bitmap) { bitmap?.asImageBitmap() }
}
