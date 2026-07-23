-- ===========================================================================
-- jicek-wlyz GGSDK 示例代码（gglua / GGLua）
-- 网络验证 SaaS 系统 - GG 修改器 Lua 脚本示例
--
-- 协议规范参考 docs/api/protocol.md：
-- - verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）
-- - auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密
-- - check_update: Base64 编码
--
-- 注：GG 修改器内置 Lua 不含 RSA/AES/ECDHE 库，需调用第三方 lua-openssl 模块
-- 或通过 native bridge 调用 SO 库实现。本示例展示完整调用流程。
-- ===========================================================================

local BASE_URL = "https://api.example.com"
local APP_KEY = "YOUR_APP_KEY"
local CLIENT_RSA_PRIVATE_KEY = [[-----BEGIN PRIVATE KEY-----
... 你的客户端 RSA 私钥 PEM ...
-----END PRIVATE KEY-----]]

-- ---------------------------------------------------------------------------
-- 1. verify_rsa：获取服务端 RSA 公钥 + ECDHE 会话密钥
-- ---------------------------------------------------------------------------
local function verify_rsa()
    local client_ecdh_priv, client_ecdh_pub_pem = ec_generate_keypair("P-256")
    local body = string.format(
        '{"app_key":"%s","client_public_key":%s}',
        APP_KEY,
        json_encode(client_ecdh_pub_pem)
    )
    local resp = http_post(BASE_URL .. "/api/v1/verify_rsa", body, {
        ["Content-Type"] = "application/json"
    })
    local data = json_decode(resp)
    if data.code ~= 0 then
        error("verify_rsa failed: " .. data.msg)
    end

    -- ECDHE 派生会话密钥：客户端私钥 + 服务端 ECDHE 公钥 → SHA-256 → AES-256
    local shared = ecdh_compute_secret(client_ecdh_priv, data.data.ecdhe_public_key)
    local session_key = sha256(shared)

    return {
        server_public_key = data.data.server_public_key,
        session_key = session_key,
    }
end

-- ---------------------------------------------------------------------------
-- 2. auth：验证卡密并激活设备
-- ---------------------------------------------------------------------------
local function auth(session_key, card_code, machine_code, device_name)
    device_name = device_name or ""
    local payload = string.format(
        '{"card_code":"%s","machine_code":"%s","device_name":"%s"}',
        card_code, machine_code, device_name
    )
    local iv = random_bytes(16)
    local encrypted = aes_256_cbc_encrypt(session_key, iv, payload)

    local body = string.format('{"iv":"%s","data":"%s"}',
        bytes_to_hex(iv), encrypted)

    local resp = send_encrypted_action("/auth", body, session_key)
    if resp.code ~= 0 then
        error("auth failed: " .. resp.msg)
    end
    return resp.data
end

-- ---------------------------------------------------------------------------
-- 3. heartbeat：心跳保活
-- ---------------------------------------------------------------------------
local function heartbeat(session_key, device_id, machine_code)
    machine_code = machine_code or ""
    local payload = string.format(
        '{"device_id":"%s","machine_code":"%s"}',
        device_id, machine_code
    )
    local iv = random_bytes(16)
    local encrypted = aes_256_cbc_encrypt(session_key, iv, payload)
    local body = string.format('{"iv":"%s","data":"%s"}',
        bytes_to_hex(iv), encrypted)

    local resp = send_encrypted_action("/heartbeat", body, session_key)
    return resp.code == 0
end

-- ---------------------------------------------------------------------------
-- 4. 内部：加密 action 通用流程
-- ---------------------------------------------------------------------------
local function send_encrypted_action(path, body, session_key)
    local ts = tostring(os.time())
    local nonce = bytes_to_hex(random_bytes(16))
    local sign_source = "POST\n/api/v1" .. path .. "\n" .. ts .. "\n" .. nonce .. "\n" .. body
    local signature = base64_encode(rsa_sha256_sign(CLIENT_RSA_PRIVATE_KEY, sign_source))

    local headers = {
        ["X-App-Key"] = APP_KEY,
        ["X-Timestamp"] = ts,
        ["X-Nonce"] = nonce,
        ["X-Signature"] = signature,
        ["Content-Type"] = "application/json",
    }
    local raw = http_post(BASE_URL .. "/api/v1" .. path, body, headers)
    local resp = json_decode(raw)

    -- 响应解密
    if resp.iv and resp.data then
        local resp_iv = hex_to_bytes(resp.iv)
        local plain = aes_256_cbc_decrypt(session_key, resp_iv, resp.data)
        resp = json_decode(plain)
    end
    return resp
end

-- ---------------------------------------------------------------------------
-- 主流程示例
-- ---------------------------------------------------------------------------
local function main()
    -- 1. 协商会话密钥
    local session = verify_rsa()

    -- 2. 验证卡密
    local result = auth(session.session_key,
        "XXXX-XXXX-XXXX-XXXX",
        get_machine_code(),  -- GG 修改器内置：读取设备唯一标识
        "GG Modify Device")
    print("Auth success, device_id:", result.device_id)
    print("Token:", result.token)

    -- 3. 启动心跳协程（按 heartbeat_interval 周期调用）
    while true do
        local ok = heartbeat(session.session_key, result.device_id, get_machine_code())
        if not ok then
            print("Heartbeat failed, re-auth required")
            break
        end
        gg.sleep(result.heartbeat_interval * 1000)
    end
end

main()
