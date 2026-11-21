package com.yk1z.yayamsg;

import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.netease.nimlib.sdk.NIMClient;
import com.netease.nimlib.sdk.Observer;
import com.netease.nimlib.sdk.RequestCallback;
import com.netease.nimlib.sdk.RequestCallbackWrapper;
import com.netease.nimlib.sdk.StatusCode;
import com.netease.nimlib.sdk.SDKOptions;
import com.netease.nimlib.sdk.auth.AuthService;
import com.netease.nimlib.sdk.auth.LoginInfo;
import com.netease.nimlib.sdk.msg.constant.MsgTypeEnum;
import com.netease.nimlib.sdk.qchat.QChatMessageService;
import com.netease.nimlib.sdk.qchat.QChatServiceObserver;
import com.netease.nimlib.sdk.qchat.model.QChatMessage;
import com.netease.nimlib.sdk.qchat.model.QChatMessageAntiSpamOption;
import com.netease.nimlib.sdk.qchat.model.QChatSystemNotification;
import com.netease.nimlib.sdk.qchat.param.QChatSendMessageParam;
import com.netease.nimlib.sdk.qchat.result.QChatSendMessageResult;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

public class PocketImModule extends ReactContextBaseJavaModule {
  private static final String TAG = "PocketIm";

  private static boolean isSafeJsLong(double value) {
    return !Double.isNaN(value) && !Double.isInfinite(value)
        && value >= 0 && value <= 9007199254740991.0
        && value == Math.floor(value);
  }

  private static final String DEFAULT_APP_KEY = "632feff1f4c838541ab75195d1ceb3fa";

  private static volatile boolean inited = false;
  private final Handler main = new Handler(Looper.getMainLooper());
  private Observer<List<QChatMessage>> messageObserver;
  private Observer<List<QChatSystemNotification>> systemObserver;

  PocketImModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return "PocketIm";
  }

  private static String describe(int code, boolean loginContext) {
    switch (code) {
      case 302: return "帐号或密码错误";
      case 403: return "非法操作或没有权限";
      case 404: return "聊天室/频道不存在";
      case 408: return "服务器无响应";
      case 414:
        return loginContext
            ? "参数错误（App 标识未通过服务端校验：包名不在云信控制台白名单，或 accid/token 不匹配）"
            : "参数错误（serverId/channelId 不匹配或缺失）";
      case 415: return "与服务器建立连接失败";
      case 416: return "操作太快了，请稍后再试";
      case 422: return "账号被禁用";
      case 500: return "服务器内部错误";
      case 802: return "没有权限";
      case 804: return "用户不在群";
      case 809: return "已经在群内";
      case 1000: return "登录失败";
      case 13001: return "IM 主连接状态异常";
      case 13002: return "聊天室状态异常";
      default: return "code=" + code;
    }
  }

  private void emit(String event, Object payload) {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      if (ctx == null || !ctx.hasActiveReactInstance()) return;
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(event, payload);
    } catch (Throwable ignored) {

    }
  }

  private static String maskId(String raw) {
    if (TextUtils.isEmpty(raw)) return "";
    return raw.length() <= 4 ? "****" : "***" + raw.substring(raw.length() - 4);
  }

  private void initOnce(String appKey) {
    if (inited) return;
    SDKOptions options = new SDKOptions();
    options.appKey = TextUtils.isEmpty(appKey) ? DEFAULT_APP_KEY : appKey;
    options.preloadAttach = false;
    options.checkManifestConfig = false;
    options.asyncInitSDK = false;
    options.reducedIM = true;
    options.enableBackOffReconnectStrategy = true;

    options.consoleLogEnabled = BuildConfig.DEBUG;
    if (BuildConfig.DEBUG) android.util.Log.i(TAG, "init appKey=" + options.appKey);
    try {
      NIMClient.init(getReactApplicationContext().getApplicationContext(), null, options);
      inited = true;
      if (BuildConfig.DEBUG) android.util.Log.i(TAG, "init done, status=" + NIMClient.getStatus());
    } catch (Throwable t) {
      android.util.Log.e(TAG, "init failed", t);
      throw t;
    }
  }

  @ReactMethod
  public void init(String appKey, final Promise promise) {
    main.post(new Runnable() {
      @Override
      public void run() {
        try {
          initOnce(appKey);
          promise.resolve(true);
        } catch (Throwable t) {
          promise.reject("E_INIT", t);
        }
      }
    });
  }

  @ReactMethod
  public void status(final Promise promise) {
    try {
      StatusCode code = inited ? NIMClient.getStatus() : StatusCode.UNLOGIN;
      promise.resolve(code == null ? "UNLOGIN" : code.name());
    } catch (Throwable t) {
      promise.reject("E_STATUS", t);
    }
  }

  @ReactMethod
  public void login(final String accid, final String token, final Promise promise) {
    if (TextUtils.isEmpty(accid) || TextUtils.isEmpty(token)) {
      promise.reject("E_PARAM", "accid/token 不能为空");
      return;
    }
    main.post(new Runnable() {
      @Override
      public void run() {
        try {
          initOnce(DEFAULT_APP_KEY);
          if (BuildConfig.DEBUG) {
            android.util.Log.i(TAG, "login accid=" + maskId(accid) + " tokenLen=" + (token == null ? 0 : token.length()));
          }
          NIMClient.getService(AuthService.class)
              .login(new LoginInfo(accid, token))
              .setCallback(new RequestCallback<LoginInfo>() {
                @Override
                public void onSuccess(LoginInfo param) {
                  emit("PocketIm:status", "LOGINED");
                  promise.resolve(true);
                }

                @Override
                public void onFailed(int code) {
                  android.util.Log.e(TAG, "login onFailed code=" + code + " (" + describe(code, true) + ")");
                  promise.reject("E_LOGIN", "云信登录失败：" + describe(code, true));
                }

                @Override
                public void onException(Throwable exception) {
                  android.util.Log.e(TAG, "login onException: " + exception);
                  promise.reject("E_LOGIN", exception);
                }
              });
        } catch (Throwable t) {
          promise.reject("E_LOGIN", t);
        }
      }
    });
  }

  @ReactMethod
  public void logout() {
    try {
      if (inited) NIMClient.getService(AuthService.class).logout();
    } catch (Throwable ignored) {

    }
  }

  private static Map<String, Object> jsonToMap(String json) {
    Map<String, Object> map = new HashMap<>();
    if (TextUtils.isEmpty(json)) return map;
    try {
      JSONObject obj = new JSONObject(json);
      Iterator<String> keys = obj.keys();
      while (keys.hasNext()) {
        String key = keys.next();
        Object value = obj.get(key);
        if (value instanceof JSONObject) {
          Map<String, Object> child = new HashMap<>();
          JSONObject childObj = (JSONObject) value;
          Iterator<String> childKeys = childObj.keys();
          while (childKeys.hasNext()) {
            String childKey = childKeys.next();
            child.put(childKey, childObj.get(childKey));
          }
          map.put(key, child);
        } else {
          map.put(key, value);
        }
      }
    } catch (Throwable ignored) {

    }
    return map;
  }

  @ReactMethod
  public void joinChannel(final double serverIdD, final double channelIdD, final Promise promise) {
    if (!isSafeJsLong(serverIdD) || !isSafeJsLong(channelIdD)) {
      promise.reject("E_PARAM", "serverId/channelId 超出 JS 安全整数范围（2^53-1），请升级客户端使用字符串 ID");
      return;
    }
    main.post(new Runnable() {
      @Override
      public void run() {
        final long serverId = (long) serverIdD;
        final long channelId = (long) channelIdD;
        try {
          initOnce(DEFAULT_APP_KEY);
          Class<?> pc = Class.forName("com.netease.nimlib.sdk.qchat.param.QChatSubscribeAllChannelParam");
          java.lang.reflect.Constructor<?>[] ctors = pc.getConstructors();
          if (BuildConfig.DEBUG) {
            StringBuilder dump = new StringBuilder("subscribeAllChannelParam ctors:");
            for (java.lang.reflect.Constructor<?> c : ctors) {
              dump.append(" [");
              for (Class<?> pt : c.getParameterTypes()) dump.append(pt.getSimpleName()).append(',');
              dump.append(']');
            }
            android.util.Log.d(TAG, dump.toString());
          }

          Object param = null;
          for (java.lang.reflect.Constructor<?> c : ctors) {
            if (param != null) break;
            Class<?>[] pts = c.getParameterTypes();
            try {

              if (pts.length == 2 && pts[0].isEnum() && java.util.List.class.isAssignableFrom(pts[1])) {
                Object[] ecs = pts[0].getEnumConstants();
                StringBuilder tn = new StringBuilder();
                Object sub = null;
                for (Object ec : ecs) {
                  String en = ((Enum<?>) ec).name();
                  if (tn.length() > 0) tn.append(',');
                  tn.append(en);
                  if (sub == null && en.contains("SUB") && !en.contains("UN")) sub = ec;
                }
                android.util.Log.i(TAG, "QChatSubscribeType=" + tn);
                if (sub == null) sub = ecs[0];
                java.util.List<Long> ids = new java.util.ArrayList<>();
                ids.add(serverId);
                param = c.newInstance(sub, ids);
              } else if (pts.length == 1 && java.util.List.class.isAssignableFrom(pts[0])) {
                java.util.List<Long> l = new java.util.ArrayList<>();
                l.add(serverId);
                param = c.newInstance(l);
              } else if (pts.length == 1 && pts[0] == long.class) {
                param = c.newInstance(serverId);
              }
            } catch (Throwable t) {
              android.util.Log.e(TAG, "ctor attempt failed", t);
            }
          }
          if (param == null) {
            android.util.Log.e(TAG, "subscribeAllChannelParam 构造失败（见上方签名）");
            promise.resolve(false);
            return;
          }
          Class<?> svcCls = Class.forName("com.netease.nimlib.sdk.qchat.QChatServerService");
          Object svc = NIMClient.getService((Class) svcCls);
          Object ret = svcCls.getMethod("subscribeAllChannel", pc).invoke(svc, param);
          android.util.Log.i(TAG, "subscribeAllChannel ok serverId=" + serverId + " channelId=" + channelId
              + " ret=" + ret);
          promise.resolve(true);
        } catch (Throwable t) {
          android.util.Log.e(TAG, "subscribeAllChannel failed serverId=" + serverId, t);
          promise.resolve(false);
        }
      }
    });
  }

  @ReactMethod
  public void sendChannelText(final double serverId, final double channelId, final String text,
                              final String extJson, final Promise promise) {
    if (!isSafeJsLong(serverId) || !isSafeJsLong(channelId)) {
      promise.reject("E_PARAM", "serverId/channelId 超出 JS 安全整数范围（2^53-1），请升级客户端使用字符串 ID");
      return;
    }
    final String content = text == null ? "" : text.trim();
    if (content.isEmpty()) {
      promise.reject("E_PARAM", "内容不能为空");
      return;
    }
    main.post(new Runnable() {
      @Override
      public void run() {
        try {
          initOnce(DEFAULT_APP_KEY);
          android.util.Log.i(TAG, "sendChannelText serverId=" + (long) serverId + " channelId=" + (long) channelId + " len=" + content.length() + " ext=" + (extJson == null ? 0 : extJson.length()));
          QChatSendMessageParam param =
              new QChatSendMessageParam((long) serverId, (long) channelId, MsgTypeEnum.text);
          param.setBody(content);
          param.setNeedBadge(false);
          QChatMessageAntiSpamOption spam = new QChatMessageAntiSpamOption();
          spam.setAntiSpamUsingYidun(Boolean.TRUE);
          spam.setCustomAntiSpamContent(content);
          param.setAntiSpamOption(spam);
          Map<String, Object> ext = jsonToMap(extJson);
          if (!ext.isEmpty()) param.setExtension(ext);

          NIMClient.getService(QChatMessageService.class)
              .sendMessage(param)
              .setCallback(new RequestCallbackWrapper<QChatSendMessageResult>() {
                @Override
                public void onResult(int code, QChatSendMessageResult result, Throwable e) {
                  if (code == 200) {
                    promise.resolve(true);
                    return;
                  }
                  String detail = describe(code, false);
                  if (result != null && result.getSentMessage() != null
                      && result.getSentMessage().getAntiSpamResult() != null
                      && result.getSentMessage().getAntiSpamResult().isAntiSpam()) {
                    detail = "内容违规";
                  } else if (e != null && e.getMessage() != null && !e.getMessage().isEmpty()) {
                    detail = detail + "（" + e.getMessage() + "）";
                  }
                  promise.reject("E_SEND", "圈组发送失败：" + detail);
                }
              });
        } catch (Throwable t) {
          promise.reject("E_SEND", t);
        }
      }
    });
  }

  @ReactMethod
  public void observeMessages(final boolean enable, final Promise promise) {
    main.post(new Runnable() {
      @Override
      public void run() {
        try {
          initOnce(DEFAULT_APP_KEY);
          QChatServiceObserver observer = NIMClient.getService(QChatServiceObserver.class);
          if (enable) {
            if (messageObserver == null) {
              messageObserver = new Observer<List<QChatMessage>>() {
                @Override
                public void onEvent(List<QChatMessage> messages) {
                  if (messages == null || messages.isEmpty()) return;
                  WritableArray array = Arguments.createArray();
                  for (QChatMessage msg : messages) {
                    if (msg == null) continue;
                    WritableMap item = Arguments.createMap();
                    item.putString("uuid", msg.getUuid());
                    item.putDouble("serverId", msg.getQChatServerId());
                    item.putDouble("channelId", msg.getQChatChannelId());
                    item.putString("fromAccount", msg.getFromAccount());
                    item.putString("fromNick", msg.getFromNick());
                    item.putDouble("time", msg.getTime());
                    item.putString("content", msg.getContent());
                    item.putString("msgType", String.valueOf(msg.getMsgType()));

                    item.putString("attachment", msg.getAttachStr() == null ? "" : msg.getAttachStr());
                    Map<String, Object> ext = msg.getRemoteExtension();
                    item.putString("extension", ext == null ? "{}" : new JSONObject(ext).toString());
                    array.pushMap(item);
                  }
                  emit("PocketIm:message", array);
                }
              };
            }
            if (systemObserver == null) {
              systemObserver = new Observer<List<QChatSystemNotification>>() {
                @Override
                public void onEvent(List<QChatSystemNotification> notifications) {
                  if (notifications == null || notifications.isEmpty()) return;
                  WritableArray array = Arguments.createArray();
                  for (QChatSystemNotification notice : notifications) {
                    if (notice == null) continue;
                    WritableMap item = Arguments.createMap();
                    item.putString("uuid", notice.getMsgIdClient() == null ? String.valueOf(notice.getMsgIdServer()) : notice.getMsgIdClient());
                    item.putDouble("serverId", notice.getServerId());
                    item.putDouble("channelId", notice.getChannelId());
                    item.putString("fromAccount", notice.getFromAccount());
                    item.putString("fromNick", notice.getFromNick());
                    item.putDouble("time", notice.getTime());
                    item.putString("content", notice.getBody());
                    item.putString("msgType", String.valueOf(notice.getType()));
                    item.putString("attachment", notice.getAttach() == null ? "" : notice.getAttach());
                    item.putString("extension", notice.getExtension() == null ? "{}" : notice.getExtension());
                    array.pushMap(item);
                  }
                  if (array.size() > 0) emit("PocketIm:message", array);
                }
              };
            }
            observer.observeReceiveMessage(messageObserver, true);
            observer.observeReceiveSystemNotification(systemObserver, true);
            promise.resolve(true);
          } else {
            if (messageObserver != null) observer.observeReceiveMessage(messageObserver, false);
            if (systemObserver != null) observer.observeReceiveSystemNotification(systemObserver, false);
            promise.resolve(false);
          }
        } catch (Throwable t) {
          promise.reject("E_OBSERVE", t);
        }
      }
    });
  }

  @Override
  public void invalidate() {
    main.post(new Runnable() {
      @Override
      public void run() {
        try {
          if (!inited) return;
          QChatServiceObserver observer = NIMClient.getService(QChatServiceObserver.class);
          if (messageObserver != null) {
            observer.observeReceiveMessage(messageObserver, false);
            messageObserver = null;
          }
          if (systemObserver != null) {
            observer.observeReceiveSystemNotification(systemObserver, false);
            systemObserver = null;
          }
        } catch (Throwable ignored) {
        }
      }
    });
    super.invalidate();
  }

  @Override
  public Map<String, Object> getConstants() {
    Map<String, Object> constants = new HashMap<>();
    constants.put("appKey", DEFAULT_APP_KEY);
    return constants;
  }
}
