# jicek-wlyz 协议规范文档

> 版本：1.0 ｜ 状态：M4 接入生态 ｜ 最后更新：2026-07-23
>
> 本文档定义客户端 SDK 与服务端验证 API 之间的通信协议，所有语言 SDK 必须严格遵循本规范。

---

## 1. 总览

### 1.1 API 入口

```
POST {BASE_URL}/api/v1/{action}
```

- `BASE_URL`：服务端部署的基础 URL（如 `https://api.example.com`）
- `action`：6 个内置 action 之一（详见 §2）

### 1.2 action 列表

| action | 功能 | 加密方式 |
|---|---|---|
| `verify_rsa` | 获取服务端 RSA 公钥 + ECDHE 会话密钥协商 | 明文（HTTPS 保护） |
| `auth` | 验证卡密并激活设备 | RSA 签名 + AES-256-CBC 加密 |
| `use` | 次数卡扣减 | RSA 签名 + AES-256-CBC 加密 |
| `unbind` | 解绑设备 | RSA 签名 + AES-256-CBC 加密 |
| `check_update` | 检查应用更新与云配置 | Base64 编码 |
| `heartbeat` | 设备心跳保活 | RSA 签名 + AES-256-CBC 加密 |

### 1.3 推荐调用顺序

```
1. verify_rsa      ← 每次启动调用一次（协商会话密钥，PFS）
2. auth            ← 用户输入卡密后调用
3. heartbeat       ← 按 heartbeat_interval 周期调用
4. check_update    ← 按需调用（启动时 + 定期轮询）
5. use             ← 次数卡每次使用时调用
6. unbind          ← 用户主动解绑时调用
```

---

## 2. 请求规范

### 2.1 统一请求头（auth/use/unbind/heartbeat/check_update）

| Header | 说明 |
|---|---|
| `X-App-Key` | 应用 AppKey（开发者后台获取） |
| `X-Timestamp` | 秒级时间戳，5 分钟有效期 |
| `X-Nonce` | 32 位随机十六进制串（16 字节），10 分钟内去重 |
| `X-Signature` | RSA-2048 签名（base64），原文见 §2.2 |
| `Content-Type` | `application/json` |

### 2.2 签名原文

```
METHOD\nPATH\nTS\nNONCE\nBODY
```

- `METHOD`：HTTP 方法（POST）
- `PATH`：URL 路径（如 `/api/v1/auth`）
- `TS`：X-Timestamp 值
- `NONCE`：X-Nonce 值
- `BODY`：请求体原文（明文或加密后的 JSON 字符串）

签名算法：RSA-2048 + SHA-256 + PKCS#1 v1.5，输出 base64。

### 2.3 统一响应体

```json
{
  "code": 0,
  "msg": "success",
  "data": { ... },
  "ts": 1717000000000,
  "nonce": "a1b2c3d4e5f6..."
}
```

- `code`：0=成功，非 0=错误码（详见 §5）
- `msg`：消息文案
- `data`：业务数据（成功时返回，失败时为 null）
- `ts`：服务器时间戳（毫秒）
- `nonce`：随机串

### 2.4 加密响应

`auth/use/unbind/heartbeat` 的响应是加密的，格式：

```json
{
  "iv": "<32 字符 hex>",
  "data": "<base64 密文>"
}
```

客户端使用会话密钥解密后得到统一响应体。

---

## 3. 各 action 详细规范

### 3.1 verify_rsa

**功能**：获取服务端 RSA 公钥 + ECDHE 会话密钥协商（PFS 完美前向保密）。

**请求体**（明文，无签名）：

```json
{
  "app_key": "ak_xxxxxxxxxxxx",
  "client_public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "server_public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "ecdhe_public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "encrypted_session_key": "<base64 或 null>",
    "crypto_mode": "rsa_aes"
  }
}
```

**会话密钥派生**：

1. 客户端生成 ECDHE 临时密钥对（P-256 / prime256v1）
2. 客户端用私钥 + 服务端 `ecdhe_public_key` 计算 ECDH 共享密钥
3. SHA-256(共享密钥) → 32 字节 AES-256 会话密钥
4. 会话密钥缓存 10 分钟（Redis），过期后需重新 `verify_rsa`

### 3.2 auth

**功能**：验证卡密并激活设备。

**加密请求体**：

```json
{
  "iv": "<32 字符 hex>",
  "data": "<base64 AES-256-CBC 密文>"
}
```

**明文载荷**（AES 加密前）：

```json
{
  "card_code": "XXXX-XXXX-XXXX-XXXX",
  "machine_code": "DEVICE_HASH",
  "device_name": "My Device"
}
```

**响应**（加密后解密）：

```json
{
  "code": 0,
  "data": {
    "device_id": "cuid_xxx",
    "token": "cuid_xxx:1717000000000",
    "expires_at": "2026-08-22T00:00:00.000Z",
    "heartbeat_interval": 60
  }
}
```

### 3.3 use

**功能**：次数卡扣减 1 次。

**明文载荷**：

```json
{
  "device_id": "cuid_xxx",
  "card_code": "XXXX-XXXX-XXXX-XXXX"
}
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "remaining_count": 99
  }
}
```

### 3.4 unbind

**功能**：解绑设备。

**明文载荷**：

```json
{
  "device_id": "cuid_xxx"
}
```

**响应**：

```json
{
  "code": 0,
  "data": { "unbound": true }
}
```

### 3.5 check_update

**功能**：检查应用更新与云配置（无需 AES 加密）。

**请求体**：空字符串

**响应**：

```json
{
  "code": 0,
  "data": {
    "version": "1.2.0",
    "announcement": "新版本上线，请更新",
    "force_update": false,
    "min_version": "1.0.0",
    "update_url": "https://example.com/download",
    "config_signature": "<RSA 签名 base64>",
    "cloud_variables": [
      { "key": "vip_level", "value": "1", "value_type": "number", "signature": "..." }
    ]
  }
}
```

**配置签名校验**：客户端用应用 RSA 公钥验签 `config_signature`，防止配置被篡改。

### 3.6 heartbeat

**功能**：设备心跳保活。

**明文载荷**：

```json
{
  "device_id": "cuid_xxx",
  "machine_code": "DEVICE_HASH"
}
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "online": true,
    "sequence": 42
  }
}
```

---

## 4. 加密细节

### 4.1 AES-256-CBC

- 密钥长度：32 字节（256 位）
- IV 长度：16 字节
- 填充：PKCS7
- 密文编码：base64

### 4.2 ECDHE PFS

- 曲线：P-256（prime256v1 / secp256r1）
- 派生：ECDH 共享密钥 → SHA-256 → AES-256 密钥
- 临时密钥对：每次 `verify_rsa` 重新生成，会话结束销毁

### 4.3 RSA-2048 签名

- 算法：SHA-256 + PKCS#1 v1.5
- 服务端验签使用 `timingSafeEqual` 常量时间比较（防时序攻击）

---

## 5. 错误码

| 错误码 | 含义 |
|---|---|
| 0 | 成功 |
| 1001 | 参数缺失 |
| 1002 | 参数格式错误 |
| 2001 | 应用不存在 |
| 2002 | AppKey 无效 |
| 2003 | 签名校验失败 |
| 2004 | 时间戳过期 |
| 2005 | Nonce 重复，疑似重放 |
| 3001 | 卡密不存在 |
| 3002 | 卡密已过期 |
| 3003 | 卡密已绑定其他设备 |
| 3004 | 卡密已被封禁 |
| 3005 | 卡密签名校验失败 |
| 4001 | 设备超过绑定上限 |
| 4002 | 设备已被封禁 |
| 5001 | 套餐余额不足 |
| 5002 | 套餐已过期 |
| 6001 | 代理邀请码无效 |
| 6002 | 代理层级超限 |
| 9001 | 系统内部错误 |
| 9002 | 服务降级中 |

---

## 6. 安全建议

### 6.1 客户端 RSA 私钥保护

- 私钥必须存储在安全位置（Android Keystore / iOS Keychain / HSM）
- 禁止硬编码在源码中
- 禁止写入日志或上传到任何服务器
- 推荐：私钥定期轮换（90 天一次）

### 6.2 服务端公钥指纹

- SDK 内置服务端 RSA 公钥指纹列表，支持多证书轮换
- 每次 `verify_rsa` 后校验返回的公钥指纹是否在白名单内
- 防止中间人替换公钥

### 6.3 防重放

- 时间戳 5 分钟有效期
- Nonce 10 分钟内去重（Redis 缓存）
- 设备序列号递增（双重保险）

### 6.4 限流

- 单设备单 action：5 次/秒
- 单 IP：100 次/分钟
- 超限触发 Redis 计数封禁

---

## 7. 多语言 SDK 对照

| 语言 | 源码路径 | 加密库 | 平台维护 |
|---|---|---|---|
| Python | `sdks/python/jicek_wlyz.py` | cryptography | 是 |
| Java | `sdks/java/.../WlyzClient.java` | JDK crypto + Gson | 是 |
| PHP | `sdks/php/JicekWlyzClient.php` | openssl + curl 扩展 | 是 |
| Node.js | `sdks/nodejs/index.js` | 内置 crypto + fetch | 是 |
| Go | `sdks/go/client.go` | 标准库 crypto/* | 是 |
| 易语言 | `sdks/e/jicek_wlyz.e` | OpenSSL DLL + 精易模块 | 是 |
| GG Lua | `examples/gglua/example.lua` | lua-openssl | 社区贡献 |
| AndroLua+ | `examples/andlua/example.lua` | Java Crypto API | 社区贡献 |
| Auto.js | `examples/autojs/example.js` | Node.js crypto | 社区贡献 |
| Shell | `examples/shell/example.sh` | curl + openssl + jq | 社区贡献 |
| 按键精灵 | `examples/anjian/example.txt` | curl + openssl | 社区贡献 |
| HTML/JS | `examples/htmljs/example.html` | Web Crypto API | 社区贡献 |

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0 | 2026-07-23 | M4 接入生态：协议规范首版，覆盖 6 actions + 加密细节 + 错误码 + 12 语言 SDK 对照 |
