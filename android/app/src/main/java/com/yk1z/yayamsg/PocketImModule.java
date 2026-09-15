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
import com.netease.nimlib.sdk.qchat.param.QChatSendMessageParam;
import com.netease.nimlib.sdk.qchat.result.QChatSendMessageResult;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 口袋48 消息通道（云信官方 Android SDK 桥）。
 *
 * 为什么要走原生：口袋48 的「房间消息」= 云信圈组（QChat），而云信只有 Android/iOS 官方 SDK
 * 支持圈组，Web/RN 版 SDK（nim-web-sdk）里 qchat 仅有取地址能力、没有收发命令。
 * 逆向依据（口袋48 7.1.39）：
 *   com.pocket.snh48.lib.yunxin.im.group.MessageManger#sendTextMessage
 *     → new QChatSendMessageParam(serverId, channelId, MsgTypeEnum.text)
 *       + setBody(text) + setExtension(ChatMsgUtil.getChannelBaseParams(...))
 *   com.pocket.snh48.lib.yunxin.im.NIMStrategy#getOptions → appKey 明文
 *
 * RN 侧入口：NativeModules.PocketIm（见 src/native/PocketIm.ts）。
 * 事件：PocketIm:message / PocketIm:status。
 */
public class PocketImModule extends ReactContextBaseJavaModule {
  private static final String TAG = "PocketIm";
  /** 与官方一致的云信 appKey（NIMStrategy.getOptions 明文） */
  private static final String DEFAULT_APP_KEY = "632feff1f4c838541ab75195d1ceb3fa";

  private static volatile boolean inited = false;
  private final Handler main = new Handler(Looper.getMainLooper());
  private Observer<List<QChatMessage>> messageObserver;

  PocketImModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return "PocketIm";
  }

  /**
   * 云信错误码 → 文案（对齐 com.pocket.snh48.lib.yunxin.model.ChatCodeHelper）。
   * 414 的文案按上下文区分：登录 414 与服务端 App 标识校验相关，发送 414 才是 roomId/channelId 参数问题。
   */
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
      // RN 上下文已销毁（页面退出）时忽略
    }
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
    // 诊断期打开 SDK 控制台日志（logcat tag: NIM / nim），排查登录 414 后应关闭
    options.consoleLogEnabled = true;
    android.util.Log.i(TAG, "init appKey=" + options.appKey);
    try {
      NIMClient.init(getReactApplicationContext().getApplicationContext(), null, options);
      inited = true;
      android.util.Log.i(TAG, "init done, status=" + NIMClient.getStatus());
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
          android.util.Log.i(TAG, "login accid=" + accid + " tokenLen=" + (token == null ? 0 : token.length()));
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
      // 忽略：退出登录失败不影响 UI
    }
  }

  /** JSON → Map（圈组扩展段结构简单，仅基础类型） */
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
      // 扩展段非法时退化为空 map（消息正文仍可发出）
    }
    return map;
  }

  /**
   * 发送房间（圈组）文本消息。
   *
   * @param serverId  圈组 serverId
   * @param channelId 频道 channelId
   * @param text      正文
   * @param extJson   扩展段 JSON（对齐 ChatMsgUtil.getChannelBaseParams：channelRole/bubbleId/module/user）
   */
  @ReactMethod
  public void sendChannelText(final double serverId, final double channelId, final String text,
                              final String extJson, final Promise promise) {
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

  /** 注册/注销圈组消息监听（含自己发出的消息） */
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
                    Map<String, Object> ext = msg.getRemoteExtension();
                    item.putString("extension", ext == null ? "{}" : new JSONObject(ext).toString());
                    array.pushMap(item);
                  }
                  emit("PocketIm:message", array);
                }
              };
            }
            observer.observeReceiveMessage(messageObserver, true);
            promise.resolve(true);
          } else {
            if (messageObserver != null) observer.observeReceiveMessage(messageObserver, false);
            promise.resolve(false);
          }
        } catch (Throwable t) {
          promise.reject("E_OBSERVE", t);
        }
      }
    });
  }

  @Override
  public Map<String, Object> getConstants() {
    Map<String, Object> constants = new HashMap<>();
    constants.put("appKey", DEFAULT_APP_KEY);
    return constants;
  }
}
