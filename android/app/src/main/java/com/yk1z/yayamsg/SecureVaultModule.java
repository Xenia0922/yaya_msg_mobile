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

      promise.resolve(null);
    }
  }
}
