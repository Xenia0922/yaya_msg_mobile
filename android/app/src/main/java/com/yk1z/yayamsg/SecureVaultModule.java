package com.yk1z.yayamsg;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 敏感凭证加密仓（AndroidKeyStore + AES-256-GCM）。
 *
 * ── 设计定位 ──
 * 只解决「**落盘明文**」这一个问题：凭据在磁盘上只存密文，密钥由 AndroidKeyStore
 * 生成并保存在 TEE / StrongBox 里，**不可导出**，只有本应用在本机运行时可解密。
 *
 * ── 不影响「复制 Token」等用户功能 ──
 * 加密只作用于「写到磁盘的那一份」。JS 侧在启动时解密一次放进内存，
 * 之后所有同步读取（发请求、复制到剪贴板、显示）照旧读内存。用户零感知。
 *
 * ── 为什么不用 setUserAuthenticationRequired(true) ──
 * 一旦绑定生物识别/锁屏密码，用户改指纹、改密码、锁屏策略变化都会让密钥**永久失效**
 * → 表现为「凭据莫名消失、必须重新登录」。这里刻意不绑，兼顾安全与可用性。
 *
 * ── 返回格式 ──
 * encrypt → Base64( [1 字节 IV 长度][IV][密文+GCM tag] )，NO_WRAP。
 * decrypt → 明文；任何异常返回 null（调用方按「无凭据」处理，不崩溃）。
 */
public class SecureVaultModule extends ReactContextBaseJavaModule {
  private static final String NAME = "SecureVault";
  private static final String KEY_ALIAS = "yaya_credential_key_v1";
  private static final String KEYSTORE = "AndroidKeyStore";
  private static final String TRANSFORM = "AES/GCM/NoPadding";
  private static final int TAG_BITS = 128;

  public SecureVaultModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return NAME;
  }

  /** 取密钥，不存在则生成（AES-256/GCM，不绑用户认证） */
  private synchronized SecretKey getOrCreateKey() throws Exception {
    KeyStore ks = KeyStore.getInstance(KEYSTORE);
    ks.load(null);
    if (ks.containsAlias(KEY_ALIAS)) {
      KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
      if (entry instanceof KeyStore.SecretKeyEntry) {
        return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
      }
    }
    KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
    kg.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        // 关键：不要求用户认证。绑定生物识别会在换指纹/改锁屏时使密钥永久失效。
        .setUserAuthenticationRequired(false)
        .build());
    return kg.generateKey();
  }

  @ReactMethod
  public void encrypt(String plain, Promise promise) {
    try {
      byte[] data = (plain == null ? "" : plain).getBytes(StandardCharsets.UTF_8);
      Cipher c = Cipher.getInstance(TRANSFORM);
      c.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
      byte[] iv = c.getIV();
      byte[] ct = c.doFinal(data);
      byte[] out = new byte[1 + iv.length + ct.length];
      out[0] = (byte) (iv.length & 0xFF);
      System.arraycopy(iv, 0, out, 1, iv.length);
      System.arraycopy(ct, 0, out, 1 + iv.length, ct.length);
      promise.resolve(Base64.encodeToString(out, Base64.NO_WRAP));
    } catch (Throwable t) {
      promise.reject("EENCRYPT", t.getMessage() != null ? t.getMessage() : "encrypt failed", t);
    }
  }

  @ReactMethod
  public void decrypt(String payload, Promise promise) {
    try {
      if (payload == null || payload.isEmpty()) {
        promise.resolve(null);
        return;
      }
      byte[] all = Base64.decode(payload, Base64.NO_WRAP);
      if (all.length < 2) {
        promise.resolve(null);
        return;
      }
      int ivLen = all[0] & 0xFF;
      if (ivLen <= 0 || all.length < 1 + ivLen + 1) {
        promise.resolve(null);
        return;
      }
      byte[] iv = new byte[ivLen];
      System.arraycopy(all, 1, iv, 0, ivLen);
      int ctLen = all.length - 1 - ivLen;
      byte[] ct = new byte[ctLen];
      System.arraycopy(all, 1 + ivLen, ct, 0, ctLen);
      Cipher c = Cipher.getInstance(TRANSFORM);
      c.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(TAG_BITS, iv));
      byte[] pt = c.doFinal(ct);
      promise.resolve(new String(pt, StandardCharsets.UTF_8));
    } catch (Throwable t) {
      // 密钥失效 / 数据损坏 / 换机还原：一律按「无凭据」返回 null，绝不抛给 JS 造成崩溃
      promise.resolve(null);
    }
  }
}
