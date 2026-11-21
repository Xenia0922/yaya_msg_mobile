package com.yk1z.yayamsg;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.net.URL;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class BiliLoginModule extends ReactContextBaseJavaModule {

  private static final String DESKTOP_UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

  private final OkHttpClient client;

  public BiliLoginModule(ReactApplicationContext reactContext) {
    super(reactContext);
    client = new OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build();
  }

  @NonNull
  @Override
  public String getName() {
    return "BiliLoginModule";
  }

  private static boolean isAllowedTicketUrl(String raw) {
    try {
      URL url = new URL(raw);
      if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
      String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
      if (!host.equals("passport.biligame.com") && !host.equals("passport.bilibili.com")) return false;
      String path = url.getPath() == null ? "" : url.getPath().toLowerCase(Locale.ROOT);
      return path.startsWith("/x/passport-login/web/crossdomain");
    } catch (Throwable t) {
      return false;
    }
  }

  @ReactMethod
  public void fetchTicket(String ticketUrl, Promise promise) {
    if (ticketUrl == null || ticketUrl.isEmpty()) {
      promise.reject("E_TICKET_URL", "ticket url empty");
      return;
    }
    if (!isAllowedTicketUrl(ticketUrl)) {
      promise.reject("E_TICKET_URL", "ticket url not allowed");
      return;
    }
    final Request request = new Request.Builder()
        .url(ticketUrl)
        .header("User-Agent", DESKTOP_UA)
        .header("Referer", "https://www.bilibili.com/")
        .get()
        .build();

    client.newCall(request).enqueue(new okhttp3.Callback() {
      @Override
      public void onFailure(@NonNull okhttp3.Call call, @NonNull java.io.IOException e) {
        promise.reject("E_FETCH_TICKET", "ticket request failed: " + e.getMessage());
      }

      @Override
      public void onResponse(@NonNull okhttp3.Call call, @NonNull Response response) {
        try {
          StringBuilder cookie = new StringBuilder();
          for (String line : response.headers("Set-Cookie")) {

            String kv = line == null ? "" : line.trim();
            int semi = kv.indexOf(';');
            if (semi >= 0) kv = kv.substring(0, semi).trim();
            if (kv.isEmpty() || !kv.contains("=")) continue;
            if (cookie.length() > 0) cookie.append("; ");
            cookie.append(kv);
          }
          promise.resolve(cookie.toString());
        } catch (Exception e) {
          promise.reject("E_PARSE_COOKIE", "parse set-cookie failed: " + e.getMessage());
        } finally {
          response.close();
        }
      }
    });
  }
}
