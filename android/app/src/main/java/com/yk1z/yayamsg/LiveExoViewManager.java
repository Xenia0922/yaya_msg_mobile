package com.yk1z.yayamsg;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;

public class LiveExoViewManager extends SimpleViewManager<LiveExoView> {
  public static final String REACT_CLASS = "LiveExoView";

  @NonNull
  @Override
  public String getName() {
    return REACT_CLASS;
  }

  @NonNull
  @Override
  protected LiveExoView createViewInstance(@NonNull ThemedReactContext reactContext) {
    return new LiveExoView(reactContext);
  }

  @ReactProp(name = "url")
  public void setUrl(LiveExoView view, @Nullable String url) {
    view.setUrl(url);
  }

  @Override
  public void onDropViewInstance(@NonNull LiveExoView view) {
    view.stop();
    super.onDropViewInstance(view);
  }
}
