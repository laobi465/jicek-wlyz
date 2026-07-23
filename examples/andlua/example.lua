-- ===========================================================================
-- jicek-wlyz AndroLua 示例代码（andlua / AndroLua+）
-- 网络验证 SaaS 系统 - Android Lua 脚本示例
--
-- 协议规范参考 docs/api/protocol.md：
-- - verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）
-- - auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密
-- - check_update: Base64 编码
--
-- 注：AndroLua+ 可直接调用 Java Crypto API，参考 Java SDK 实现
-- ===========================================================================

local BASE_URL = "https://api.example.com"
local APP_KEY = "YOUR_APP_KEY"
local CLIENT_RSA_PRIVATE_KEY = [[-----BEGIN PRIVATE KEY-----
... 你的客户端 RSA 私钥 PEM ...
-----END PRIVATE KEY-----]]

-- ---------------------------------------------------------------------------
-- 通过 LuaJ 调用 Java 类
-- ---------------------------------------------------------------------------
local LuaJ = luaj
local String = LuaJ.bindClass("java.lang.String")
local Base64 = LuaJ.bindClass("android.util.Base64")
local KeyFactory = LuaJ.bindClass("java.security.KeyFactory")
local PKCS8EncodedKeySpec = LuaJ.bindClass("java.security.spec.PKCS8EncodedKeySpec")
local Signature = LuaJ.bindClass("java.security.Signature")
local Cipher = LuaJ.bindClass("javax.crypto.Cipher")
local SecretKeySpec = LuaJ.bindClass("javax.crypto.spec.SecretKeySpec")
local IvParameterSpec = LuaJ.bindClass("javax.crypto.spec.IvParameterSpec")
local MessageDigest = LuaJ.bindClass("java.security.MessageDigest")
local KeyPairGenerator = LuaJ.bindClass("java.security.KeyPairGenerator")
local ECGenParameterSpec = LuaJ.bindClass("java.security.spec.ECGenParameterSpec")
local KeyAgreement = LuaJ.bindClass("javax.crypto.KeyAgreement")

local URL = LuaJ.bindClass("java.net.URL")
local HttpURLConnection = LuaJ.bindClass("java.net.HttpURLConnection")
local ByteArrayOutputStream = LuaJ.bindClass("java.io.ByteArrayOutputStream")

-- ---------------------------------------------------------------------------
-- 1. verify_rsa
-- ---------------------------------------------------------------------------
local function verify_rsa()
    -- 生成客户端 ECDHE 密钥对（P-256）
    local kpg = KeyPairGenerator.getInstance("EC")
    kpg.initialize(ECGenParameterSpec("secp256r1"))
    local pair = kpg.generateKeyPair()
    local clientPriv = pair.getPrivate()
    local clientPub = pair.getPublic()

    -- 构造请求体
    local pubBytes = clientPub.getEncoded()
    local pubB64 = Base64.encodeToString(pubBytes, 2):gsub("(.{64})", "%1\n")
    local pubPem = "-----BEGIN PUBLIC KEY-----\n" .. pubB64 .. "\n-----END PUBLIC KEY-----\n"

    local body = string.format('{"app_key":"%s","client_public_key":%s}',
        APP_KEY, json_encode(pubPem))

    local raw = http_post("/verify_rsa", body, nil)
    local resp = json_decode(raw)
    if resp.code ~= 0 then
        error("verify_rsa failed: " .. resp.msg)
    end

    -- ECDHE 派生会话密钥
    local serverPubDer = base64_decode(extract_pem_body(resp.data.ecdhe_public_key))
    local serverPub = KeyFactory.getInstance("EC")
        :generatePublic(PKCS8EncodedKeySpec(serverPubDer))

    local ka = KeyAgreement.getInstance("ECDH")
    ka.init(clientPriv)
    ka.doPhase(serverPub, true)
    local shared = ka.generateSecret()
    local md = MessageDigest.getInstance("SHA-256")
    md.update(shared)
    local sessionKey = md.digest()

    return {
        server_public_key = resp.data.server_public_key,
        session_key = sessionKey,
    }
end

-- ---------------------------------------------------------------------------
-- 2. auth
-- ---------------------------------------------------------------------------
local function auth(session_key, card_code, machine_code, device_name)
    device_name = device_name or ""
    local payload = string.format(
        '{"card_code":"%s","machine_code":"%s","device_name":"%s"}',
        card_code, machine_code, device_name)

    local iv = random_bytes(16)
    local encrypted = aes_encrypt(session_key, iv, payload)
    local body = string.format('{"iv":"%s","data":"%s"}',
        bytes_to_hex(iv), encrypted)

    local resp = send_encrypted_action("/auth", body, session_key)
    if resp.code ~= 0 then
        error("auth failed: " .. resp.msg)
    end
    return resp.data
end

-- ---------------------------------------------------------------------------
-- 3. heartbeat
-- ---------------------------------------------------------------------------
local function heartbeat(session_key, device_id, machine_code)
    machine_code = machine_code or ""
    local payload = string.format(
        '{"device_id":"%s","machine_code":"%s"}',
        device_id, machine_code)

    local iv = random_bytes(16)
    local encrypted = aes_encrypt(session_key, iv, payload)
    local body = string.format('{"iv":"%s","data":"%s"}',
        bytes_to_hex(iv), encrypted)

    local resp = send_encrypted_action("/heartbeat", body, session_key)
    return resp.code == 0
end

-- ---------------------------------------------------------------------------
-- 内部：加密 action 通用流程
-- ---------------------------------------------------------------------------
local function send_encrypted_action(path, body, session_key)
    local ts = tostring(math.floor(os.time() / 1000))
    local nonce = bytes_to_hex(random_bytes(16))
    local sign_source = "POST\n/api/v1" .. path .. "\n" .. ts .. "\n" .. nonce .. "\n" .. body
    local signature = rsa_sign(CLIENT_RSA_PRIVATE_KEY, sign_source)

    local headers = {
        ["X-App-Key"] = APP_KEY,
        ["X-Timestamp"] = ts,
        ["X-Nonce"] = nonce,
        ["X-Signature"] = signature,
        ["Content-Type"] = "application/json",
    }
    local raw = http_post(path, body, headers)
    local resp = json_decode(raw)

    if resp.iv and resp.data then
        local resp_iv = hex_to_bytes(resp.iv)
        local plain = aes_decrypt(session_key, resp_iv, resp.data)
        resp = json_decode(plain)
    end
    return resp
end

-- ---------------------------------------------------------------------------
-- Java 桥接实现
-- ---------------------------------------------------------------------------
local function rsa_sign(pem_key, source)
    local der = base64_decode(extract_pem_body(pem_key))
    local priv = KeyFactory.getInstance("RSA")
        :generatePrivate(PKCS8EncodedKeySpec(der))
    local sig = Signature.getInstance("SHA256withRSA")
    sig.initSign(priv)
    sig.update(String(source):getBytes())
    local signed = sig.sign()
    return base64_encode(signed)
end

local function aes_encrypt(key, iv, data)
    local cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
    cipher.init(Cipher.ENCRYPT_MODE,
        SecretKeySpec(key, "AES"),
        IvParameterSpec(iv))
    local enc = cipher.doFinal(String(data):getBytes())
    return base64_encode(enc)
end

-- ---------------------------------------------------------------------------
-- 主流程
-- ---------------------------------------------------------------------------
local function main()
    local session = verify_rsa()

    local result = auth(session.session_key,
        "XXXX-XXXX-XXXX-XXXX",
        get_android_id(),  -- AndroLua+ 调用 Activity getContentResolver
        "AndroLua Device")
    print("Auth success:", result.token)

    -- 后台心跳协程
    while true do
        local ok = heartbeat(session.session_key,
            result.device_id, get_android_id())
        if not ok then break end
        os.execute("sleep " .. result.heartbeat_interval)
    end
end

main()
