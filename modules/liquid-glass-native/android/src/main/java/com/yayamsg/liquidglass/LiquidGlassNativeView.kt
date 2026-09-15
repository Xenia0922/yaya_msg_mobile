package com.yayamsg.liquidglass

import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.view.View
import android.view.ViewOutlineProvider
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * 液态玻璃原生视图：RenderNode 硬件录制 + 链式 RenderEffect（blur → AGSL 透镜/色散）。
 *
 * 渲染管线：
 *   1. 硬件录制目标（window content）到 RenderNode —— 不是软件 Bitmap
 *   2. RenderEffect.createChainEffect(AGSL 透镜, BlurEffect) —— 模糊作为着色器的输入
 *   3. canvas.drawRenderNode —— GPU 出图
 *
 * AGSL 只做苹果的签名动作：**边缘 30% 带内透镜折射 + RGB 色散 + 边缘高光**，
 * 中心区保持纯模糊（这也让着色器开销可控）。
 */
class LiquidGlassNativeView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  var blurRadius: Float = 22f
  /** 边缘透镜带宽（占半径比例 0~1） */
  var lensWidth: Float = 0.32f
  /** 折射位移强度（px） */
  var lensStrength: Float = 14f
  /** 色散强度（0~0.2，RGB 分离比例） */
  var dispersion: Float = 0.07f
  /** 边缘高光强度 */
  var rimStrength: Float = 0.16f
  var cornerRadius: Float = 28f

  private var tintColor: Int = Color.TRANSPARENT
  private var shader: RuntimeShader? = null
  private val srcNode = RenderNode("liquid-glass-src")
  private val locSelf = IntArray(2)
  private val locTarget = IntArray(2)

  init {
    setWillNotDraw(false)
    // RenderNode + 链式 RenderEffect 需要 API 31+；AGSL RuntimeShader 需要 API 33+
    if (Build.VERSION.SDK_INT >= 33) {
      shader = RuntimeShader(SHADER_SRC)
    }
    if (Build.VERSION.SDK_INT >= 31) {
      outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) {
          outline.setRoundRect(0, 0, view.width, view.height, cornerRadius)
        }
      }
      clipToOutline = true
    }
  }

  fun setTintFromString(value: String?) {
    tintColor = if (value.isNullOrEmpty()) {
      Color.TRANSPARENT
    } else {
      try {
        Color.parseColor(value)
      } catch (t: Throwable) {
        Color.TRANSPARENT
      }
    }
  }

  /** 录制内容的目标视图：整窗 content（玻璃背后的一切） */
  private val target: View?
    get() = (context as? Activity)?.window?.decorView?.findViewById(android.R.id.content)

  override fun onDraw(canvas: Canvas) {
    // 防自引用递归：录制期间本视图（以及所有同类视图）必须跳过绘制，
    // 否则"录制内容→画到自己→再录制"会在 libhwui 里无限递归爆栈（实测 SIGSEGV）。
    if (capturing) return
    val src = target ?: return
    val w = src.width
    val h = src.height
    if (w <= 0 || h <= 0 || width <= 0 || height <= 0) return

    // 1) 硬件录制（RenderNode，非 Bitmap）
    val rec = srcNode.beginRecording(w, h)
    getLocationInWindow(locSelf)
    src.getLocationInWindow(locTarget)
    rec.translate(-(locSelf[0] - locTarget[0]).toFloat(), -(locSelf[1] - locTarget[1]).toFloat())
    capturing = true
    try {
      src.draw(rec)
    } catch (t: Throwable) {
      // 个别视图拒绝录制：退化为不绘制，不影响其余 UI
      capturing = false
      srcNode.endRecording()
      return
    } finally {
      capturing = false
    }
    srcNode.endRecording()

    // 2) 链式效果：模糊 → AGSL 透镜/色散
    if (Build.VERSION.SDK_INT >= 31) {
      val blur = RenderEffect.createBlurEffect(blurRadius, blurRadius, Shader.TileMode.CLAMP)
      val s = shader
      if (Build.VERSION.SDK_INT >= 33 && s != null) {
        s.setFloatUniform("size", width.toFloat(), height.toFloat())
        s.setFloatUniform("lensWidth", lensWidth)
        s.setFloatUniform("strength", lensStrength)
        s.setFloatUniform("disp", dispersion)
        s.setFloatUniform("rim", rimStrength)
        s.setFloatUniform(
          "tint",
          Color.red(tintColor) / 255f,
          Color.green(tintColor) / 255f,
          Color.blue(tintColor) / 255f,
          Color.alpha(tintColor) / 255f,
        )
        val lens = RenderEffect.createRuntimeShaderEffect(s, "content")
        srcNode.setRenderEffect(RenderEffect.createChainEffect(lens, blur))
      } else {
        srcNode.setRenderEffect(blur)
      }
    }

    // 3) GPU 出图
    canvas.drawRenderNode(srcNode)
  }

  companion object {
    /** 录制进行中：所有同类视图跳过绘制，避免自引用递归 */
    @JvmStatic
    @Volatile
    var capturing: Boolean = false
      private set

    /**
     * AGSL 着色器：边缘透镜折射 + RGB 色散 + 边缘高光。
     * content 由 RenderEffect 链注入（链的内层 = 模糊结果）。
     */
    private const val SHADER_SRC = """
      uniform shader content;
      uniform float2 size;
      uniform float lensWidth;
      uniform float strength;
      uniform float disp;
      uniform float rim;
      uniform float4 tint;

      half4 main(float2 p) {
        float2 c = size * 0.5;
        float2 n = (p - c) / max(c, float2(1.0));
        // 盒式距离：0 = 中心，1 = 边缘
        float m = max(abs(n.x), abs(n.y));
        // 边缘透镜带：靠边逐渐增强
        float e = smoothstep(1.0 - lensWidth, 1.0, m);
        // 法向（指向中心），边缘处把采样点向内推 —— 模拟凸透镜放大边缘内容
        float2 dir = normalize((p - c) + float2(0.0001, 0.0001));
        float2 off = -dir * e * strength;

        half4 base = content.eval(p);
        float3 rgb = float3(
          content.eval(p + off * (1.0 + disp)).r,
          base.g,
          content.eval(p + off * (1.0 - disp)).b
        );

        // 边缘高光（环境光在上表面反射的那条亮带）
        float band = smoothstep(1.0 - lensWidth * 0.6, 1.0, m) * rim;
        rgb += band;

        // 材质染色（浅色 = 白纱，深色 = 深纱）
        rgb = mix(rgb, tint.rgb, tint.a);
        return half4(half3(rgb), 1.0);
      }
    """
  }
}
