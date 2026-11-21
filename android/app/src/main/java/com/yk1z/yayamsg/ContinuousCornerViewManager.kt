package com.yk1z.yayamsg

import android.graphics.Color
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp

class ContinuousCornerViewManager : ViewGroupManager<ContinuousCornerView>() {
  companion object {
    const val REACT_CLASS = "ContinuousCornerView"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(reactContext: ThemedReactContext): ContinuousCornerView =
    ContinuousCornerView(reactContext)

  @ReactProp(name = "cornerRadiusDp", defaultFloat = 0f)
  fun setCornerRadiusDp(view: ContinuousCornerView, dp: Float) {
    view.setCornerRadiusDp(dp)
  }

  @ReactProp(name = "strokeWidthDp", defaultFloat = 0f)
  fun setStrokeWidthDp(view: ContinuousCornerView, dp: Float) {
    view.setStrokeWidthDp(dp)
  }

  @ReactProp(name = "strokeColor", customType = "Color")
  fun setStrokeColor(view: ContinuousCornerView, color: Int?) {
    view.setStrokeColor(color ?: Color.TRANSPARENT)
  }
}
