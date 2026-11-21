package com.yk1z.yayamsg

import android.graphics.Path

internal object ContinuousRoundRect {
  private const val SQRT_2 = 1.4142135623730951
  private const val FRAC_1_SQRT_2 = 0.7071067811865476
  private const val FRAC_PI_4 = 0.7853981633974483
  private const val EXTENDED_FRACTION = 2.0 / 3.0
  private const val ARC_FRACTION = 0.5

  private val THETA = (1.0 - ARC_FRACTION) * FRAC_PI_4
  private val COS = Math.cos(THETA)
  private val SIN = Math.sin(THETA)
  private val COT = 1.0 / Math.tan(THETA)
  private val COS2 = COS * COS
  private val SIN2 = SIN * SIN
  private val COS3 = COS2 * COS
  private val SIN3 = SIN2 * SIN

  private val K0: Double =
    ((SQRT_2 - COS * 6.0 + COS2 * 8.485281374238571 - COS3 * 4.0) * 27.0 * COT) +
      (SIN * 2.0 * ((((SQRT_2 - SIN * 2.0) * 2.0) * SIN3 - 9.0) +
        (COS * 2.8284271247461903) * (SIN2 + 9.0) -
        (COS2 * 2.0) * ((SIN2 * 2.0) + 9.0)))
  private val K1: Double =
    (((COS * 1.6568542494923806 - 0.5857864376269049) +
      COS2 * -1.1715728752538097) * -81.0 * COT) -
      (SIN * 4.0 * ((SIN3 * 1.4142135623730951 + 3.727922061357857) +
        (COS * -0.5857864376269049) * (SIN2 + 9.0)))
  private val K2: Double =
    (((COS * -0.3431457505076194 + 0.24264068711928566) * 9.0 * COT) +
      SIN * -0.3431457505076194) * 9.0
  private val K3: Double = COT * 2.7136367114850355

  private fun solveCubicSingle(a: Double, b: Double, c: Double, d: Double): Double {
    val f = ((c * 3.0) / a - (b * b) / (a * a)) / 3.0
    val g = ((((b * 2.0) * b * b) / ((a * a) * a)) -
      ((9.0 * b * c) / (a * a)) + ((d * 27.0) / a)) / 27.0
    val h = (g * g) / 4.0 + (f * f * f) / 27.0
    val sh = Math.sqrt(h)
    return Math.cbrt(-g / 2.0 + sh) + Math.cbrt(-g / 2.0 - sh) - b / (3.0 * a)
  }

  private fun solveDepressedQuarticSingle(p: Double, q: Double, r: Double): Double {
    val b = -p / 2.0
    val c = -r
    val d = (r * p) / 2.0 - (q * q) / 8.0
    val f = ((c * 3.0) - (b * b)) / 3.0
    val g = ((((b * 2.0) * b * b) - (9.0 * b * c) + (d * 27.0))) / 27.0
    val phi = Math.acos((-g) / (Math.sqrt(((-f) * f * f) / 27.0) * 2.0))
    val y = Math.sqrt(-f / 3.0) * 2.0 * Math.cos(phi / 3.0)
    val z = y - b / 3.0
    val u = Math.sqrt(z * 2.0 - p)
    return (u - Math.sqrt((u * u) - ((z + (q / (u * 2.0))) * 4.0))) / 2.0
  }

  private fun evenCorner(t: Double): DoubleArray {
    val k = EXTENDED_FRACTION * t
    val kappa = solveCubicSingle(K3, K2, K1 + (-k) * 8.0 * SIN3 * SIN, K0)
    val x3 = (SIN - FRAC_1_SQRT_2) / kappa + FRAC_1_SQRT_2
    val y3 = (FRAC_1_SQRT_2 - COS) / kappa + 0.2928932188134524
    val x2 = x3 - COT * y3
    val x1 = x2 - (kappa * 1.5 * y3 * y3) / SIN3
    val x0 = -k
    val x6 = 1.0 - y3
    val y6 = 1.0 - x3
    val y7 = 1.0 - x2
    val y8 = 1.0 - x1
    val y9 = 1.0 - x0
    val a = 1.5 * kappa
    val g = COS2 - SIN2
    val x36 = x6 - x3
    val y36 = y6 - y3
    val cc = -((COS * y36) - (SIN * x36))
    val lambda = (-g + Math.sqrt((g * g) - (4.0 * a * cc))) / (2.0 * a)
    val x4 = COS * lambda + x3
    val y4 = SIN * lambda + y3
    val x7 = x6 - SIN * lambda
    val y10 = y6 - COS * lambda
    return doubleArrayOf(
      x0, 0.0, x1, 0.0, x2, 0.0, x3, y3, x4, y4,
      x7, y10, x6, y6, 1.0, y7, 1.0, y8, 1.0, y9,
    )
  }

  private fun unevenCorner(tH: Double, tV: Double): DoubleArray {
    val kH = EXTENDED_FRACTION * tH
    val kV = EXTENDED_FRACTION * tV
    val ka3 = solveCubicSingle(K3, K2, K1 + (-kH) * 8.0 * SIN3 * SIN, K0)
    val ka6 = solveCubicSingle(K3, K2, K1 + (-kV) * 8.0 * SIN3 * SIN, K0)
    val x3 = (SIN - FRAC_1_SQRT_2) / ka3 + FRAC_1_SQRT_2
    val y3 = (FRAC_1_SQRT_2 - COS) / ka3 + 0.2928932188134524
    val x2 = x3 - COT * y3
    val x1 = x2 - (ka3 * 1.5 * y3 * y3) / SIN3
    val k7 = -kH
    val x3p = (SIN - FRAC_1_SQRT_2) / ka6 + FRAC_1_SQRT_2
    val y3p = (FRAC_1_SQRT_2 - COS) / ka6 + 0.2928932188134524
    val x2p = x3p - COT * y3p
    val x1p = x2p - (ka6 * 1.5 * y3p * y3p) / SIN3
    val x1p2 = -kV
    val x6 = 1.0 - y3p
    val y6 = 1.0 - x3p
    val y7 = 1.0 - x2p
    val y8 = 1.0 - x1p
    val y9 = 1.0 - x1p2
    val a = ka3 * 1.5
    val b = 1.5 * ka6
    val g = COS2 - SIN2
    val x36 = x6 - x3
    val y36 = y6 - y3
    val cc = -((COS * y36) - (SIN * x36))
    val dd = (SIN * y36) - (COS * x36)
    val p = (dd / b) * 2.0
    val q = (g * g * g) / ((a * b) * b)
    val r = ((a * dd * dd) + (cc * g * g)) / ((a * b) * b)
    val l6 = solveDepressedQuarticSingle(p, q, r)
    val l3 = ((-dd) - (b * l6 * l6)) / g
    val x4 = COS * l3 + x3
    val y4 = SIN * l3 + y3
    val x7 = x6 - SIN * l6
    val y10 = y6 - COS * l6
    return doubleArrayOf(
      k7, 0.0, x1, 0.0, x2, 0.0, x3, y3, x4, y4,
      x7, y10, x6, y6, 1.0, y7, 1.0, y8, 1.0, y9,
    )
  }

  private fun appendCornerCubics(
    path: Path,
    pts: DoubleArray,
    ox: Double,
    oy: Double,
    sx: Double,
    sy: Double,
    radius: Double,
  ) {
    for (seg in 0..2) {
      val i = 2 + seg * 6
      path.cubicTo(
        (ox + sx * pts[i] * radius).toFloat(),
        (oy + sy * pts[i + 1] * radius).toFloat(),
        (ox + sx * pts[i + 2] * radius).toFloat(),
        (oy + sy * pts[i + 3] * radius).toFloat(),
        (ox + sx * pts[i + 4] * radius).toFloat(),
        (oy + sy * pts[i + 5] * radius).toFloat(),
      )
    }
  }

  fun buildContinuousRoundRect(path: Path, w: Float, h: Float, r: Float): Boolean {
    if (w <= 0f || h <= 0f) return false
    val wd = w.toDouble()
    val hd = h.toDouble()
    val radius = minOf(r.toDouble(), minOf(wd, hd) / 2.0)
    path.reset()
    if (radius <= 0.0) {
      path.moveTo(0f, 0f)
      path.lineTo(w, 0f)
      path.lineTo(w, h)
      path.lineTo(0f, h)
      path.close()
      return true
    }
    val ext = radius * EXTENDED_FRACTION
    val tH = (((wd * 0.5) - radius) / ext).coerceIn(0.0, 1.0)
    val tV = (((hd * 0.5) - radius) / ext).coerceIn(0.0, 1.0)
    val p = if (tH == tV) evenCorner(tH) else unevenCorner(tH, tV)
    if (p.any { !it.isFinite() }) {

      path.addRoundRect(0f, 0f, w, h, radius.toFloat(), radius.toFloat(), Path.Direction.CW)
      return true
    }
    val pr = DoubleArray(20) { idx -> p[(9 - idx / 2) * 2 + idx % 2] }
    val xRight = wd - radius
    path.moveTo((xRight + p[0] * radius).toFloat(), (p[1] * radius).toFloat())
    appendCornerCubics(path, p, xRight, 0.0, 1.0, 1.0, radius)
    path.lineTo((xRight + pr[0] * radius).toFloat(), (hd - pr[1] * radius).toFloat())
    appendCornerCubics(path, pr, xRight, hd, 1.0, -1.0, radius)
    path.lineTo((radius - p[0] * radius).toFloat(), (hd - p[1] * radius).toFloat())
    appendCornerCubics(path, p, radius, hd, -1.0, -1.0, radius)
    path.lineTo((radius - pr[0] * radius).toFloat(), (pr[1] * radius).toFloat())
    appendCornerCubics(path, pr, radius, 0.0, -1.0, 1.0, radius)
    path.close()
    return true
  }
}
