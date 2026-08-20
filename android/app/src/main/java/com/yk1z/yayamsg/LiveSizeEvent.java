package com.yk1z.yayamsg;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.uimanager.events.RCTEventEmitter;

/** 视频尺寸变化事件：把 RTMP 直播的实际宽高传给 JS（小窗据此适配横竖屏容器） */
public class LiveSizeEvent extends Event<LiveSizeEvent> {
  public static final String EVENT_NAME = "topSize";

  private final int width;
  private final int height;

  public LiveSizeEvent(int viewTag, int width, int height) {
    super(viewTag);
    this.width = width;
    this.height = height;
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
    rctEventEmitter.receiveEvent(getViewTag(), getEventName(), data);
  }
}
