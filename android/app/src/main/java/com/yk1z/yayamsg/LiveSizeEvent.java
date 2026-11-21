package com.yk1z.yayamsg;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.uimanager.events.RCTEventEmitter;

public class LiveSizeEvent extends Event<LiveSizeEvent> {
  public static final String EVENT_NAME = "topSize";

  private final int width;
  private final int height;
  private final int visualWidth;
  private final int visualHeight;
  private final boolean isLandscape;
  private final boolean isPillarboxed;

  public LiveSizeEvent(int viewTag, int width, int height) {
    this(viewTag, width, height, width, height, width > height, false);
  }

  public LiveSizeEvent(
      int viewTag,
      int width,
      int height,
      int visualWidth,
      int visualHeight,
      boolean isLandscape,
      boolean isPillarboxed) {
    super(viewTag);
    this.width = width;
    this.height = height;
    this.visualWidth = visualWidth > 0 ? visualWidth : width;
    this.visualHeight = visualHeight > 0 ? visualHeight : height;
    this.isLandscape = isLandscape;
    this.isPillarboxed = isPillarboxed;
  }

  @Override
  public String getEventName() {
    return EVENT_NAME;
  }

  @Override
  public void dispatch(@NonNull RCTEventEmitter rctEventEmitter) {
    WritableMap data = Arguments.createMap();
    data.putInt("width", width);
    data.putInt("height", height);
    data.putInt("visualWidth", visualWidth);
    data.putInt("visualHeight", visualHeight);
    data.putBoolean("isLandscape", isLandscape);
    data.putBoolean("isPillarboxed", isPillarboxed);
    rctEventEmitter.receiveEvent(getViewTag(), getEventName(), data);
  }
}
