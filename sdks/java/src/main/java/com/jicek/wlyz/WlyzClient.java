package com.jicek.wlyz;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

/**
 * jicek-wlyz Java SDK
 * 网络验证 SaaS 系统 Java 客户端
 *
 * <p>协议规范参考 docs/api/protocol.md：
 * <ul>
 *   <li>verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）</li>
 *   <li>auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密</li>
 *   <li>check_update: Base64 编码</li>
 * </ul>
 *
 * <p>安全设计（SPEC §2.6.1）：
 * <ul>
 *   <li>请求头 RSA-2048 签名（METHOD\nPATH\nTS\nNONCE\nBODY）</li>
 *   <li>时间戳 5 分钟有效期，Nonce 32 位随机串</li>
 *   <li>AES-256-CBC 业务加密 + 响应解密</li>
 *   <li>ECDHE PFS 完美前向保密</li>
 * </ul>
 *
 * <p>依赖：Gson（JSON 序列化）、JDK 11+
 */
public class WlyzClient {

    private static final Gson GSON = new Gson();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final ClientConfig config;
    private final String apiBase;

    public WlyzClient(ClientConfig config) {
        this.config = config;
        this.apiBase = config.baseUrl.replaceAll("/+$", "") + "/api/v1";
    }

    // -------------------------------------------------------------------------
    // 1. verify_rsa - 获取服务端 RSA 公钥 + ECDHE 会话密钥协商
    // -------------------------------------------------------------------------
    public Map<String, Object> verifyRsa() throws Exception {
        // 生成客户端 ECDHE 临时密钥对（P-256）
        java.security.KeyPairGenerator kpg =
                java.security.KeyPairGenerator.getInstance("EC");
        kpg.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
        java.security.KeyPair clientPair = kpg.generateKeyPair();

        String clientPubPem = pemFromPublicKey(clientPair.getPublic());

        Map<String, Object> body = new HashMap<>();
        body.put("app_key", config.appKey);
        body.put("client_public_key", clientPubPem);

        Map<String, Object> resp = httpPost("/verify_rsa",
                GSON.toJson(body).getBytes(StandardCharsets.UTF_8), null);
        Map<String, Object> data = checkResponse(resp);

        // 保存服务端 RSA 公钥
        config.serverRsaPublicKey = (String) data.get("server_public_key");

        // ECDHE 派生会话密钥：客户端私钥 + 服务端 ECDHE 公钥 → SHA-256 → AES-256
        byte[] serverEcdhPubDer = derFromPem((String) data.get("ecdhe_public_key"));
        KeyFactory kf = KeyFactory.getInstance("EC");
        PublicKey serverEcdhPub = kf.generatePublic(new X509EncodedKeySpec(serverEcdhPubDer));

        KeyAgreement ka = KeyAgreement.getInstance("ECDH");
        ka.init(clientPair.getPrivate());
        ka.doPhase(serverEcdhPub, true);
        byte[] sharedSecret = ka.generateSecret();
        // SHA-256 派生 AES-256 密钥
        java.security.MessageDigest sha256 =
                java.security.MessageDigest.getInstance("SHA-256");
        config.sessionKey = sha256.digest(sharedSecret);

        return data;
    }

    // -------------------------------------------------------------------------
    // 2. auth - 验证卡密并激活设备
    // -------------------------------------------------------------------------
    public Map<String, Object> auth(String cardCode, String machineCode,
                                    String deviceName) throws Exception {
        Map<String, Object> payload = new HashMap<>();
        payload.put("card_code", cardCode);
        payload.put("machine_code", machineCode);
        payload.put("device_name", deviceName == null ? "" : deviceName);
        return encryptedAction("/auth", payload);
    }

    // -------------------------------------------------------------------------
    // 3. use - 次数卡扣减
    // -------------------------------------------------------------------------
    public Map<String, Object> use(String deviceId, String cardCode) throws Exception {
        Map<String, Object> payload = new HashMap<>();
        payload.put("device_id", deviceId);
        payload.put("card_code", cardCode);
        return encryptedAction("/use", payload);
    }

    // -------------------------------------------------------------------------
    // 4. unbind - 解绑设备
    // -------------------------------------------------------------------------
    public Map<String, Object> unbind(String deviceId) throws Exception {
        Map<String, Object> payload = new HashMap<>();
        payload.put("device_id", deviceId);
        return encryptedAction("/unbind", payload);
    }

    // -------------------------------------------------------------------------
    // 5. check_update - 检查更新和云配置
    // -------------------------------------------------------------------------
    public Map<String, Object> checkUpdate() throws Exception {
        if (config.serverRsaPublicKey == null) {
            throw new WlyzException(2003, "未获取服务端公钥，请先调用 verifyRsa");
        }
        String ts = String.valueOf(System.currentTimeMillis() / 1000);
        String nonce = randomHex(16);
        String body = "";
        String path = "/api/v1/check_update";
        String signature = sign("POST", path, ts, nonce, body);

        Map<String, String> headers = buildHeaders(ts, nonce, signature);
        Map<String, Object> resp = httpPost("/check_update",
                body.getBytes(StandardCharsets.UTF_8), headers);
        return checkResponse(resp);
    }

    // -------------------------------------------------------------------------
    // 6. heartbeat - 心跳保活
    // -------------------------------------------------------------------------
    public Map<String, Object> heartbeat(String deviceId, String machineCode)
            throws Exception {
        Map<String, Object> payload = new HashMap<>();
        payload.put("device_id", deviceId);
        payload.put("machine_code", machineCode == null ? "" : machineCode);
        return encryptedAction("/heartbeat", payload);
    }

    // -------------------------------------------------------------------------
    // 内部：加密 action
    // -------------------------------------------------------------------------
    private Map<String, Object> encryptedAction(String path,
                                                Map<String, Object> payload)
            throws Exception {
        if (config.sessionKey == null || config.serverRsaPublicKey == null) {
            throw new WlyzException(2003, "会话未建立，请先调用 verifyRsa");
        }

        String plaintext = GSON.toJson(payload);
        byte[] iv = new byte[16];
        RANDOM.nextBytes(iv);
        String encrypted = aesEncrypt(config.sessionKey, iv, plaintext);

        Map<String, Object> bodyObj = new HashMap<>();
        bodyObj.put("iv", bytesToHex(iv));
        bodyObj.put("data", encrypted);
        String body = GSON.toJson(bodyObj);

        String ts = String.valueOf(System.currentTimeMillis() / 1000);
        String nonce = randomHex(16);
        String signature = sign("POST", "/api/v1" + path, ts, nonce, body);
        Map<String, String> headers = buildHeaders(ts, nonce, signature);

        Map<String, Object> resp = httpPost(path,
                body.getBytes(StandardCharsets.UTF_8), headers);

        // 响应也是加密的
        if (resp.containsKey("iv") && resp.containsKey("data")) {
            byte[] respIv = hexToBytes((String) resp.get("iv"));
            String plainResp = aesDecrypt(config.sessionKey, respIv,
                    (String) resp.get("data"));
            resp = GSON.fromJson(plainResp,
                    new TypeToken<Map<String, Object>>() {}.getType());
        }

        return checkResponse(resp);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> checkResponse(Map<String, Object> resp)
            throws WlyzException {
        Number code = (Number) resp.get("code");
        if (code == null || code.intValue() != 0) {
            throw new WlyzException(
                    code == null ? 9001 : code.intValue(),
                    (String) resp.getOrDefault("msg", "未知错误"),
                    resp.get("data"));
        }
        return (Map<String, Object>) resp.get("data");
    }

    // -------------------------------------------------------------------------
    // 加密与签名
    // -------------------------------------------------------------------------
    private String sign(String method, String path, String ts, String nonce,
                        String body) throws Exception {
        String source = String.join("\n", method, path, ts, nonce, body);
        byte[] keyDer = derFromPem(config.clientRsaPrivateKey);
        PrivateKey priv = KeyFactory.getInstance("RSA")
                .generatePrivate(new PKCS8EncodedKeySpec(keyDer));
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(priv);
        sig.update(source.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(sig.sign());
    }

    private Map<String, String> buildHeaders(String ts, String nonce,
                                             String signature) {
        Map<String, String> h = new HashMap<>();
        h.put("X-App-Key", config.appKey);
        h.put("X-Timestamp", ts);
        h.put("X-Nonce", nonce);
        h.put("X-Signature", signature);
        h.put("Content-Type", "application/json");
        return h;
    }

    private String aesEncrypt(byte[] key, byte[] iv, String data) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE,
                new SecretKeySpec(key, "AES"),
                new IvParameterSpec(iv));
        byte[] enc = cipher.doFinal(data.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(enc);
    }

    private String aesDecrypt(byte[] key, byte[] iv, String encrypted)
            throws Exception {
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.DECRYPT_MODE,
                new SecretKeySpec(key, "AES"),
                new IvParameterSpec(iv));
        byte[] dec = cipher.doFinal(Base64.getDecoder().decode(encrypted));
        return new String(dec, StandardCharsets.UTF_8);
    }

    // -------------------------------------------------------------------------
    // HTTP
    // -------------------------------------------------------------------------
    private Map<String, Object> httpPost(String path, byte[] body,
                                         Map<String, String> headers)
            throws Exception {
        URL url = new URL(apiBase + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(config.timeout * 1000);
        conn.setReadTimeout(config.timeout * 1000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        if (headers != null) {
            for (Map.Entry<String, String> e : headers.entrySet()) {
                conn.setRequestProperty(e.getKey(), e.getValue());
            }
        }
        try (OutputStream os = conn.getOutputStream()) {
            os.write(body);
        }
        int code = conn.getResponseCode();
        InputStream is = (code >= 200 && code < 300) ? conn.getInputStream()
                : conn.getErrorStream();
        String raw = readAll(is);
        return GSON.fromJson(raw, new TypeToken<Map<String, Object>>() {}.getType());
    }

    private static String readAll(InputStream is) throws IOException {
        if (is == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[4096];
        int n;
        while ((n = is.read(tmp)) != -1) buf.write(tmp, 0, n);
        return buf.toString(StandardCharsets.UTF_8.name());
    }

    // -------------------------------------------------------------------------
    // 工具
    // -------------------------------------------------------------------------
    private static String pemFromPublicKey(PublicKey pk) {
        String b64 = Base64.getEncoder().encodeToString(pk.getEncoded());
        return "-----BEGIN PUBLIC KEY-----\n"
                + b64.replaceAll("(.{64})", "$1\n")
                + "\n-----END PUBLIC KEY-----\n";
    }

    private static byte[] derFromPem(String pem) {
        String body = pem.replaceAll("-----BEGIN [^-]+-----", "")
                .replaceAll("-----END [^-]+-----", "")
                .replaceAll("\\s+", "");
        return Base64.getDecoder().decode(body);
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static byte[] hexToBytes(String hex) {
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static String randomHex(int byteLen) {
        byte[] buf = new byte[byteLen];
        RANDOM.nextBytes(buf);
        return bytesToHex(buf);
    }

    // -------------------------------------------------------------------------
    // 异常与配置
    // -------------------------------------------------------------------------
    public static class WlyzException extends Exception {
        public final int code;
        public final Object data;

        public WlyzException(int code, String msg, Object data) {
            super("[" + code + "] " + msg);
            this.code = code;
            this.data = data;
        }
    }

    public static class ClientConfig {
        public String baseUrl;
        public String appKey;
        public String clientRsaPrivateKey;  // PEM
        public String serverRsaPublicKey;   // PEM，verifyRsa 后填充
        public byte[] sessionKey;           // ECDHE 派生，verifyRsa 后填充
        public int timeout = 10;

        public ClientConfig(String baseUrl, String appKey,
                            String clientRsaPrivateKey) {
            this.baseUrl = baseUrl;
            this.appKey = appKey;
            this.clientRsaPrivateKey = clientRsaPrivateKey;
        }
    }
}
