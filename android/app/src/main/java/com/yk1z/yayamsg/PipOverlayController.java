package com.yk1z.yayamsg;

import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import java.util.Map;
import java.util.WeakHashMap;

/** 同步隐藏播放器 UI，避免系统小窗切换时等待 JS 渲染。 */
public final class PipOverlayController {
  private static final String OVERLAY_ID = "yaya.pip.overlay";
  private static final Map<View, Integer> hiddenViews = new WeakHashMap<>();

  private PipOverlayController() {}

  public static void setHidden(Activity activity, boolean hidden) {
    if (activity == null || activity.getWindow() == null) return;
    if (!hidden) {
      for (Map.Entry<View, Integer> entry : hiddenViews.entrySet()) {
        View view = entry.getKey();
        if (view != null && OVERLAY_ID.equals(view.getTag(com.facebook.react.R.id.view_tag_native_id))) {
          view.setVisibility(entry.getValue());
        }
      }
      hiddenViews.clear();
      return;
    }
    hideTaggedViews(activity.getWindow().getDecorView());
  }

  private static void hideTaggedViews(View view) {
    if (OVERLAY_ID.equals(view.getTag(com.facebook.react.R.id.view_tag_native_id))) {
      if (!hiddenViews.containsKey(view)) hiddenViews.put(view, view.getVisibility());
      view.setVisibility(View.INVISIBLE);
      return;
    }
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) hideTaggedViews(group.getChildAt(i));
    }
  }
}
