package com.yk1z.yayamsg

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.os.Build
import android.view.View
import android.view.ViewOutlineProvider
import com.facebook.react.views.view.ReactViewGroup
import kotlin.math.min

class ContinuousCornerView(context: Context) : ReactViewGroup(context) {
  private var cornerRadiusDp: Float = 0f
  private var strokeWidthDp: Float = 0f
  private var strokeColor: Int = Color.TRANSPARENT

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && hasClipPath) {
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

  fun setCornerRadiusDp(dp: Float) {
    val safe = if (dp.isFinite() && dp > 0f) dp else 0f
    if (safe != cornerRadiusDp) {
      cornerRadiusDp = safe
      dirty = true
      invalidateOutline()
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
