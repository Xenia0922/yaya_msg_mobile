package com.yk1z.yayamsg;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.uimanager.events.RCTEventEmitter;

public class LiveExoErrorEvent extends Event<LiveExoErrorEvent> {
  public static final String EVENT_NAME = "topError";

  private final String message;

  public LiveExoErrorEvent(int viewTag, String message) {
    super(viewTag);
    this.message = message == null ? "" : message;
  }

  @Override
  public String getEventName() {
    return EVENT_NAME;
  }

  @Override
  public void dispatch(@NonNull RCTEventEmitter rctEventEmitter) {
    WritableMap data = Arguments.createMap();
    data.putString("message", message);
    rctEventEmitter.receiveEvent(getViewTag(), getEventName(), data);
  }
}
