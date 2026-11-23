package com.yk1z.yayamsg

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.os.Build
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import com.facebook.react.views.view.ReactViewGroup
import java.util.WeakHashMap
import kotlin.math.min

class ContinuousCornerView(context: Context) : ReactViewGroup(context) {
  private var cornerRadiusDp: Float = 0f
  private var strokeWidthDp: Float = 0f
  private var strokeColor: Int = Color.TRANSPARENT
  private var clipOutline: Boolean = false
  private val clippedSurfaces = WeakHashMap<SurfaceView, ViewOutlineProvider>()

  private val clipPath = Path()
  private val strokePath = Path()
  private var hasClipPath = false
  private var hasStrokePath = false

  private var dirty = true
  private var builtW = -1
  private var builtH = -1
  private var builtRadiusPx = -1f
  private var builtStrokePx = -1f
  private var clippedInDraw = false

  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
  }

  init {
    setWillNotDraw(false)
    clipToOutline = false
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        val w = view.width
        val h = view.height
        if (w <= 0 || h <= 0) {
          outline.setEmpty()
          return
        }
        rebuildPathsIfNeeded(w, h)
        val rPx = currentRadiusPx(w, h)
        val canUsePath = if (clipOutline) {
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        } else {
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        }
        if (canUsePath && hasClipPath) {
          try {
            outline.setPath(clipPath)
            return
          } catch (_: Throwable) {

          }
        }
        outline.setRoundRect(0, 0, w, h, rPx)
      }
    }
  }

  fun setClipOutline(enabled: Boolean) {
    if (enabled != clipOutline) {
      clipOutline = enabled
      clipToOutline = enabled
      invalidateOutline()
      syncDescendantSurfaceOutlines()
      invalidate()
    }
  }

  fun setCornerRadiusDp(dp: Float) {
    val safe = if (dp.isFinite() && dp > 0f) dp else 0f
    if (safe != cornerRadiusDp) {
      cornerRadiusDp = safe
      dirty = true
      invalidateOutline()
      syncDescendantSurfaceOutlines()
      invalidate()
    }
  }

  fun setStrokeWidthDp(dp: Float) {
    val safe = if (dp.isFinite() && dp > 0f) dp else 0f
    if (safe != strokeWidthDp) {
      strokeWidthDp = safe
      dirty = true
      invalidate()
    }
  }

  fun setStrokeColor(color: Int) {
    if (color != strokeColor) {
      strokeColor = color
      strokePaint.color = color
      invalidate()
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    dirty = true
    invalidateOutline()
    syncDescendantSurfaceOutlines()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    if (clipOutline) {
      syncDescendantSurfaceOutlines()
      post {
        if (clipOutline) syncDescendantSurfaceOutlines()
      }
    }
  }

  private fun syncDescendantSurfaceOutlines() {
    scanSurfaceViews(this)
  }

  private fun scanSurfaceViews(group: ViewGroup) {
    val count = group.childCount
    for (i in 0 until count) {
      val child = group.getChildAt(i) ?: continue
      if (child is SurfaceView) {
        applySurfaceOutline(child)
      } else if (child is ViewGroup) {
        scanSurfaceViews(child)
      }
    }
  }

  private fun applySurfaceOutline(sv: SurfaceView) {
    val shouldClip = clipOutline && cornerRadiusDp > 0f
    var provider = clippedSurfaces[sv]
    if (provider == null && shouldClip) {
      provider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) {
          val pW = this@ContinuousCornerView.width
          val pH = this@ContinuousCornerView.height
          val vW = view.width
          val vH = view.height
          if (pW <= 0 || pH <= 0 || vW <= 0 || vH <= 0) {
            outline.setEmpty()
            return
          }
          val rPx = currentRadiusPx(pW, pH)
          if (!clipOutline || rPx <= 0f) {
            outline.setRect(0, 0, vW, vH)
            return
          }
          rebuildPathsIfNeeded(pW, pH)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            hasClipPath &&
            vW == pW &&
            vH == pH
          ) {
            try {
              outline.setPath(clipPath)
              return
            } catch (_: Throwable) {
            }
          }
          outline.setRoundRect(0, 0, vW, vH, rPx)
        }
      }
      clippedSurfaces[sv] = provider
      sv.outlineProvider = provider
    }
    if (sv.clipToOutline != shouldClip) {
      sv.clipToOutline = shouldClip
    }
    if (provider != null) {
      sv.invalidateOutline()
    }
  }

  private fun currentRadiusPx(w: Int, h: Int): Float {
    val density = resources.displayMetrics.density
    val rPx = cornerRadiusDp * density
    return min(rPx, min(w, h) * 0.5f)
  }

  private fun rebuildPathsIfNeeded(w: Int, h: Int) {
    if (w <= 0 || h <= 0) {
      hasClipPath = false
      hasStrokePath = false
      return
    }
    val density = resources.displayMetrics.density
    val rPx = currentRadiusPx(w, h)
    val sPx = strokeWidthDp * density
    if (!dirty && builtW == w && builtH == h && builtRadiusPx == rPx && builtStrokePx == sPx) {
      return
    }
    dirty = false
    builtW = w
    builtH = h
    builtRadiusPx = rPx
    builtStrokePx = sPx

    hasClipPath = if (rPx > 0f) {
      ContinuousRoundRect.buildContinuousRoundRect(clipPath, w.toFloat(), h.toFloat(), rPx)
    } else {
      false
    }

    if (sPx > 0f && w.toFloat() - sPx > 1f && h.toFloat() - sPx > 1f) {
      val half = sPx * 0.5f
      val ok = ContinuousRoundRect.buildContinuousRoundRect(
        strokePath,
        w.toFloat() - sPx,
        h.toFloat() - sPx,
        maxOf(0f, rPx - half),
      )
      if (ok) {
        strokePath.offset(half, half)
        strokePaint.strokeWidth = sPx
        hasStrokePath = true
      } else {
        hasStrokePath = false
      }
    } else {
      hasStrokePath = false
    }
  }

  override fun draw(canvas: Canvas) {
    rebuildPathsIfNeeded(width, height)
    if (hasClipPath) {
      val saveCount = canvas.save()
      clippedInDraw = true
      try {
        canvas.clipPath(clipPath)
        super.draw(canvas)
      } finally {
        clippedInDraw = false
        canvas.restoreToCount(saveCount)
      }
    } else {
      super.draw(canvas)
    }
  }

  override fun dispatchDraw(canvas: Canvas) {
    rebuildPathsIfNeeded(width, height)
    if (!clippedInDraw && hasClipPath) {
      val saveCount = canvas.save()
      try {
        canvas.clipPath(clipPath)
        super.dispatchDraw(canvas)
      } finally {
        canvas.restoreToCount(saveCount)
      }
    } else {
      super.dispatchDraw(canvas)
    }
    if (hasStrokePath && strokeWidthDp > 0f && Color.alpha(strokeColor) > 0) {
      strokePaint.color = strokeColor
      canvas.drawPath(strokePath, strokePaint)
    }
  }
}
