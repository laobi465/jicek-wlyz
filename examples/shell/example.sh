#!/bin/bash
# ===========================================================================
# jicek-wlyz Shell 示例代码（shell / curl + openssl）
# 网络验证 SaaS 系统 - Shell 脚本示例
#
# 协议规范参考 docs/api/protocol.md：
# - verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）
# - auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密
# - check_update: Base64 编码
#
# 注：Shell 通过 curl + openssl 命令行实现，ECDHE 在 OpenSSL 1.1+ 支持
# ===========================================================================

set -euo pipefail

BASE_URL="https://api.example.com"
APP_KEY="YOUR_APP_KEY"
CLIENT_RSA_PRIVATE_KEY="/path/to/client_private_key.pem"
TIMEOUT=10

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

# 生成 N 字节十六进制随机串
random_hex() {
    local n="${1:-16}"
    openssl rand -hex "$n"
}

# 字符串 SHA-256（输出二进制）
sha256_bytes() {
    printf '%s' "$1" | openssl dgst -sha256 -binary
}

# RSA-SHA256 签名（输入文本，输出 base64）
rsa_sign() {
    local source="$1"
    printf '%s' "$source" | openssl dgst -sha256 -sign "$CLIENT_RSA_PRIVATE_KEY" | base64 -w0
}

# AES-256-CBC 加密（key=hex, iv=hex, 输入=文本，输出=base64）
aes_encrypt() {
    local key_hex="$1"
    local iv_hex="$2"
    local data="$3"
    printf '%s' "$data" | openssl enc -aes-256-cbc \
        -K "$key_hex" -iv "$iv_hex" -nopad 2>/dev/null \
        | base64 -w0 || \
    printf '%s' "$data" | openssl enc -aes-256-cbc \
        -K "$key_hex" -iv "$iv_hex" | base64 -w0
}

# AES-256-CBC 解密（key=hex, iv=hex, 输入=base64，输出=文本）
aes_decrypt() {
    local key_hex="$1"
    local iv_hex="$2"
    local encrypted="$3"
    printf '%s' "$encrypted" | base64 -d \
        | openssl enc -d -aes-256-cbc -K "$key_hex" -iv "$iv_hex" 2>/dev/null
}

# JSON 字段提取（依赖 jq）
json_get() {
    local json="$1"
    local key="$2"
    printf '%s' "$json" | jq -r "$key"
}

# HTTP POST
http_post() {
    local path="$1"
    local body="$2"
    local headers_arg="${3:-}"

    local url="${BASE_URL}/api/v1${path}"
    local -a curl_args=(
        -sS --max-time "$TIMEOUT"
        -X POST "$url"
        -H "Content-Type: application/json"
    )

    if [[ -n "$headers_arg" ]]; then
        # headers_arg 格式：KEY1:VAL1|KEY2:VAL2
        IFS='|' read -ra HEADERS <<< "$headers_arg"
        for h in "${HEADERS[@]}"; do
            curl_args+=(-H "$h")
        done
    fi

    curl_args+=(--data-binary "@-")

    printf '%s' "$body" | curl "${curl_args[@]}"
}

# ---------------------------------------------------------------------------
# 1. verify_rsa - 获取服务端 RSA 公钥 + ECDHE 会话密钥
# ---------------------------------------------------------------------------
verify_rsa() {
    # 生成客户端 ECDHE 临时密钥对（P-256）
    local client_priv_key="client_ecdh_$$_key.pem"
    local client_pub_key="client_ecdh_$$_pub.pem"
    openssl ecparam -name prime256v1 -genkey -noout -out "$client_priv_key"
    openssl ec -in "$client_priv_key" -pubout -out "$client_pub_key" 2>/dev/null

    local client_pub_pem
    client_pub_pem=$(cat "$client_pub_key")

    # 构造 JSON 请求体（使用 jq 处理转义）
    local body
    body=$(jq -n --arg app "$APP_KEY" --arg pub "$client_pub_pem" \
        '{app_key:$app, client_public_key:$pub}')

    local resp
    resp=$(http_post "/verify_rsa" "$body" "")
    local code
    code=$(json_get "$resp" '.code')
    if [[ "$code" != "0" ]]; then
        echo "verify_rsa failed: $(json_get "$resp" '.msg')" >&2
        rm -f "$client_priv_key" "$client_pub_key"
        return 1
    fi

    SERVER_RSA_PUB=$(json_get "$resp" '.data.server_public_key')
    local server_ecdh_pub
    server_ecdh_pub=$(json_get "$resp" '.data.ecdhe_public_key')

    # ECDHE 派生会话密钥：客户端私钥 + 服务端 ECDHE 公钥 → SHA-256 → AES-256
    local server_ecdh_pub_file="server_ecdh_$$_pub.pem"
    printf '%s' "$server_ecdh_pub" > "$server_ecdh_pub_file"

    local shared
    shared=$(openssl pkeyutl -derive -inkey "$client_priv_key" \
        -peerkey "$server_ecdh_pub_file" -peerform PEM 2>/dev/null) || \
    shared=$(openssl derive -inkey "$client_priv_key" \
        -peerkey "$server_ecdh_pub_file" 2>/dev/null) || \
    shared=""

    if [[ -z "$shared" ]]; then
        echo "ECDHE 派生失败" >&2
        rm -f "$client_priv_key" "$client_pub_key" "$server_ecdh_pub_file"
        return 1
    fi

    SESSION_KEY=$(printf '%s' "$shared" | xxd -p -c 256 | tr -d '\n')
    SESSION_KEY=$(printf '%s' "$shared" | openssl dgst -sha256 -hex | awk '{print $NF}')

    rm -f "$client_priv_key" "$client_pub_key" "$server_ecdh_pub_file"
    echo "verify_rsa success"
}

# ---------------------------------------------------------------------------
# 2. auth - 验证卡密并激活设备
# ---------------------------------------------------------------------------
auth() {
    local card_code="$1"
    local machine_code="$2"
    local device_name="${3:-}"

    local payload
    payload=$(jq -n --arg c "$card_code" --arg m "$machine_code" --arg d "$device_name" \
        '{card_code:$c, machine_code:$m, device_name:$d}')

    local iv_hex
    iv_hex=$(random_hex 16)
    local encrypted
    encrypted=$(aes_encrypt "$SESSION_KEY" "$iv_hex" "$payload")

    local body
    body=$(jq -n --arg iv "$iv_hex" --arg d "$encrypted" '{iv:$iv, data:$d}')

    local resp
    resp=$(encrypted_action "/auth" "$body")
    echo "$resp"
}

# ---------------------------------------------------------------------------
# 3. heartbeat - 心跳保活
# ---------------------------------------------------------------------------
heartbeat() {
    local device_id="$1"
    local machine_code="${2:-}"

    local payload
    payload=$(jq -n --arg d "$device_id" --arg m "$machine_code" \
        '{device_id:$d, machine_code:$m}')

    local iv_hex
    iv_hex=$(random_hex 16)
    local encrypted
    encrypted=$(aes_encrypt "$SESSION_KEY" "$iv_hex" "$payload")

    local body
    body=$(jq -n --arg iv "$iv_hex" --arg d "$encrypted" '{iv:$iv, data:$d}')

    encrypted_action "/heartbeat" "$body"
}

# ---------------------------------------------------------------------------
# 内部：加密 action 通用流程
# ---------------------------------------------------------------------------
encrypted_action() {
    local path="$1"
    local body="$2"

    local ts
    ts=$(date +%s)
    local nonce
    nonce=$(random_hex 16)

    # 签名原文：METHOD\nPATH\nTS\nNONCE\nBODY
    local sign_source
    sign_source=$(printf 'POST\n/api/v1%s\n%s\n%s\n%s' "$path" "$ts" "$nonce" "$body")

    local signature
    signature=$(rsa_sign "$sign_source")

    local headers
    headers=$(printf 'X-App-Key:%s|X-Timestamp:%s|X-Nonce:%s|X-Signature:%s' \
        "$APP_KEY" "$ts" "$nonce" "$signature")

    local raw
    raw=$(http_post "$path" "$body" "$headers")

    # 响应解密：{ iv, data }
    local resp_iv
    resp_iv=$(json_get "$raw" '.iv // empty')
    if [[ -n "$resp_iv" ]]; then
        local resp_enc
        resp_enc=$(json_get "$raw" '.data // empty')
        local plain
        plain=$(aes_decrypt "$SESSION_KEY" "$resp_iv" "$resp_enc")
        echo "$plain"
    else
        echo "$raw"
    fi
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
main() {
    if [[ ! -f "$CLIENT_RSA_PRIVATE_KEY" ]]; then
        echo "客户端 RSA 私钥文件不存在: $CLIENT_RSA_PRIVATE_KEY" >&2
        exit 1
    fi

    verify_rsa || exit 1

    local machine_code
    machine_code=$(hostname | sha256sum | awk '{print $1}')

    local auth_resp
    auth_resp=$(auth "XXXX-XXXX-XXXX-XXXX" "$machine_code" "Shell Host")
    echo "Auth response: $auth_resp"

    local device_id
    device_id=$(json_get "$auth_resp" '.data.device_id')

    # 心跳循环
    while true; do
        sleep 60
        heartbeat "$device_id" "$machine_code" > /dev/null || {
            echo "Heartbeat failed" >&2
            break
        }
    done
}

main "$@"
