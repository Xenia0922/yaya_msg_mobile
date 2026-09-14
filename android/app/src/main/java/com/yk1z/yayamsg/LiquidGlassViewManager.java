package com.yk1z.yayamsg;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.ViewGroupManager;
import com.facebook.react.uimanager.annotations.ReactProp;
import com.qmdeve.liquidglass.Config;
import com.qmdeve.liquidglass.LiquidGlass;

/**
 * RN 包装 QmDeve/AndroidLiquidGlassView（真折射 + 色散，Android 13 / API 33+ 生效；
 * 低版本 QmDeve 内部自动退化为透明层，此时 RN 侧应使用 expo-blur fallback）。
 *
 * 布局结构（iOS 26 卡片形态：中心清晰、边缘液态折射带）：
 *   root(FrameLayout)
 *     ├─ content(FrameLayout)   ← RN children（下层）
 *     └─ glass(LiquidGlass)     ← 上层；target=content，只折射边缘带(REFRACTION_HEIGHT)
 * 玻璃层不消费触摸（默认不可点击），children 交互不受影响。
 */
public class LiquidGlassViewManager extends ViewGroupManager<FrameLayout> {
  public static final String NAME = "LiquidGlassNativeView";

  private static class Holder {
    FrameLayout content;
    LiquidGlass glass;
    Config config;
    float density = 1f;
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @NonNull
  @Override
  protected FrameLayout createViewInstance(@NonNull ThemedReactContext reactContext) {
    FrameLayout root = new FrameLayout(reactContext);
    Holder holder = new Holder();
    holder.density = reactContext.getResources().getDisplayMetrics().density;
    holder.config = new Config();
    holder.config.CORNER_RADIUS_PX = 40f;
    holder.config.BLUR_RADIUS = 16f;
    holder.config.REFRACTION_HEIGHT = 24f;
    holder.config.REFRACTION_OFFSET = 4f;
    holder.config.TINT_ALPHA = 0.10f;
    holder.config.TINT_COLOR_RED = 1f;
    holder.config.TINT_COLOR_GREEN = 1f;
    holder.config.TINT_COLOR_BLUE = 1f;

    FrameLayout content = new FrameLayout(reactContext);
    content.setClipChildren(false);
    holder.content = content;
    root.addView(content, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    if (Build.VERSION.SDK_INT >= 33) {
      LiquidGlass glass = new LiquidGlass(reactContext, holder.config);
      glass.init(content);
      // 玻璃层不可点击：触摸穿透到 children
      glass.setClickable(false);
      glass.setFocusable(false);
      holder.glass = glass;
      root.addView(glass, new FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }
    root.setTag(holder);
    return root;
  }

  private void applyConfig(FrameLayout root) {
    Object tag = root.getTag();
    if (!(tag instanceof Holder)) return;
    Holder h = (Holder) tag;
    if (h.glass != null) h.glass.updateParameters();
  }

  @ReactProp(name = "cornerRadius", defaultFloat = 40f)
  public void setCornerRadius(FrameLayout root, float dp) {
    Object tag = root.getTag();
    if (!(tag instanceof Holder)) return;
    Holder h = (Holder) tag;
    h.config.CORNER_RADIUS_PX = dp * h.density;
    applyConfig(root);
  }

  @ReactProp(name = "blurRadius", defaultFloat = 16f)
  public void setBlurRadius(FrameLayout root, float dp) {
    Object tag = root.getTag();
    if (!(tag instanceof Holder)) return;
    Holder h = (Holder) tag;
    h.config.BLUR_RADIUS = dp * h.density;
    applyConfig(root);
  }

  @ReactProp(name = "refractionHeight", defaultFloat = 24f)
  public void setRefractionHeight(FrameLayout root, float dp) {
    Object tag = root.getTag();
    if (!(tag instanceof Holder)) return;
    Holder h = (Holder) tag;
    h.config.REFRACTION_HEIGHT = dp * h.density;
    applyConfig(root);
  }

  @ReactProp(name = "refractionOffset", defaultFloat = 4f)
  public void setRefractionOffset(FrameLayout root, float dp) {
    Object tag = root.getTag();
    if (!(tag instanceof Holder)) return;
    Holder h = (Holder) tag;
    h.config.REFRACTION_OFFSET = dp * h.density;
    applyConfig(root);
  }

  @ReactProp(name = "tintAlpha", defaultFloat = 0.10f)
  public void setTintAlpha(FrameLayout root, float v) {
    Object tag = root.getTag();
    if (!(tag instanceof Holder)) return;
    ((Holder) tag).config.TINT_ALPHA = v;
    applyConfig(root);
  }

  @Override
  public void addView(FrameLayout parent, View child, int index) {
    Object tag = parent.getTag();
    if (tag instanceof Holder) {
      ((Holder) tag).content.addView(child, index);
    } else {
      super.addView(parent, child, index);
    }
  }

  @Override
  public int getChildCount(FrameLayout parent) {
    Object tag = parent.getTag();
    return tag instanceof Holder ? ((Holder) tag).content.getChildCount()
        : super.getChildCount(parent);
  }

  @Override
  public View getChildAt(FrameLayout parent, int index) {
    Object tag = parent.getTag();
    return tag instanceof Holder ? ((Holder) tag).content.getChildAt(index)
        : super.getChildAt(parent, index);
  }

  @Override
  public void removeViewAt(FrameLayout parent, int index) {
    Object tag = parent.getTag();
    if (tag instanceof Holder) {
      ((Holder) tag).content.removeViewAt(index);
    } else {
      super.removeViewAt(parent, index);
    }
  }

  @Override
  public void removeAllViews(FrameLayout parent) {
    Object tag = parent.getTag();
    if (tag instanceof Holder) {
      ((Holder) tag).content.removeAllViews();
    } else {
      super.removeAllViews(parent);
    }
  }

  @Override
  public boolean needsCustomLayoutForChildren() {
    return true;
  }
}
