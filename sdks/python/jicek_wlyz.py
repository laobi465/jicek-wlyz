"""
jicek-wlyz Python SDK
网络验证 SaaS 系统 Python 客户端

协议规范（参考 docs/api/protocol.md）：
- verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）
- auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密
- check_update: Base64 编码

安全设计（SPEC §2.6.1）：
- 请求头 RSA-2048 签名（METHOD\nPATH\nTS\nNONCE\nBODY）
- 时间戳 5 分钟有效期，Nonce 32 位随机串
- AES-256-CBC 业务加密 + 响应解密
- ECDHE PFS 完美前向保密
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib import error, parse, request

# 第三方依赖：cryptography（提供 RSA/ECDHE/AES 实现）
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


# ---------------------------------------------------------------------------
# 异常定义
# ---------------------------------------------------------------------------
class WlyzError(Exception):
    """SDK 通用异常"""

    def __init__(self, code: int, msg: str, data: Any = None):
        super().__init__(f"[{code}] {msg}")
        self.code = code
        self.msg = msg
        self.data = data


# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
@dataclass
class ClientConfig:
    """客户端配置"""

    base_url: str  # 服务端基础 URL，如 https://api.example.com
    app_key: str  # 应用 AppKey
    client_rsa_private_key: str  # 客户端 RSA 私钥（PEM）
    server_rsa_public_key: Optional[str] = None  # 服务端 RSA 公钥（PEM，verify_rsa 后自动填充）
    timeout: int = 10  # 请求超时（秒）
    # ECDHE 会话密钥（PFS，verify_rsa 后填充）
    session_key: Optional[bytes] = field(default=None, repr=False)


# ---------------------------------------------------------------------------
# 主客户端
# ---------------------------------------------------------------------------
class WlyzClient:
    """jicek-wlyz 验证客户端"""

    def __init__(self, config: ClientConfig):
        self.config = config
        self._api_base = config.base_url.rstrip("/") + "/api/v1"

    # -------------------------------------------------------------------------
    # 1. verify_rsa - 获取服务端 RSA 公钥 + ECDHE 会话密钥协商
    # -------------------------------------------------------------------------
    def verify_rsa(self) -> dict:
        """
        获取服务端 RSA 公钥并完成 ECDHE 会话密钥协商（PFS）。

        Returns:
            dict: {
                server_public_key, ecdhe_public_key,
                encrypted_session_key, crypto_mode
            }
        """
        # 生成客户端 ECDHE 临时密钥对（P-256）
        client_ecdh_priv = ec.generate_private_key(ec.SECP256R1(), default_backend())
        client_ecdh_pub_pem = client_ecdh_priv.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")

        body = json.dumps({
            "app_key": self.config.app_key,
            "client_public_key": client_ecdh_pub_pem,
        }).encode("utf-8")

        resp = self._http_post("/verify_rsa", body, signed=False)
        if resp["code"] != 0:
            raise WlyzError(resp["code"], resp["msg"], resp.get("data"))

        data = resp["data"]
        # 保存服务端 RSA 公钥
        self.config.server_rsa_public_key = data["server_public_key"]

        # ECDHE 派生会话密钥：客户端私钥 + 服务端 ECDHE 公钥 → SHA-256 → AES-256
        server_ecdh_pub = self._load_ecdh_public_key(data["ecdhe_public_key"])
        shared_secret = client_ecdh_priv.exchange(ec.ECDH(), server_ecdh_pub)
        self.config.session_key = hashlib.sha256(shared_secret).digest()

        return data

    # -------------------------------------------------------------------------
    # 2. auth - 验证卡密并激活设备
    # -------------------------------------------------------------------------
    def auth(self, card_code: str, machine_code: str, device_name: str = "") -> dict:
        """
        验证卡密并激活设备。

        Args:
            card_code: 卡密码
            machine_code: 设备机器码
            device_name: 设备名称（可选）

        Returns:
            dict: { device_id, token, expires_at, heartbeat_interval }
        """
        return self._encrypted_action("/auth", {
            "card_code": card_code,
            "machine_code": machine_code,
            "device_name": device_name,
        })

    # -------------------------------------------------------------------------
    # 3. use - 次数卡扣减
    # -------------------------------------------------------------------------
    def use(self, device_id: str, card_code: str) -> dict:
        """次数卡扣减 1 次"""
        return self._encrypted_action("/use", {
            "device_id": device_id,
            "card_code": card_code,
        })

    # -------------------------------------------------------------------------
    # 4. unbind - 解绑设备
    # -------------------------------------------------------------------------
    def unbind(self, device_id: str) -> dict:
        """解绑设备"""
        return self._encrypted_action("/unbind", {
            "device_id": device_id,
        })

    # -------------------------------------------------------------------------
    # 5. check_update - 检查更新和云配置（Base64 编码）
    # -------------------------------------------------------------------------
    def check_update(self) -> dict:
        """
        检查应用更新和云配置。

        Returns:
            dict: { version, announcement, force_update, min_version,
                    update_url, config_signature, cloud_variables }
        """
        if not self.config.server_rsa_public_key:
            raise WlyzError(2003, "未获取服务端公钥，请先调用 verify_rsa")

        ts = str(int(time.time()))
        nonce = secrets.token_hex(16)
        # check_update 走 Base64，请求体为空字符串
        body = ""
        signature = self._sign("POST", "/api/v1/check_update", ts, nonce, body)

        headers = self._build_headers(ts, nonce, signature)
        resp = self._http_request("POST", self._api_base + "/check_update",
                                  body.encode("utf-8"), headers)
        if resp["code"] != 0:
            raise WlyzError(resp["code"], resp["msg"], resp.get("data"))
        return resp["data"]

    # -------------------------------------------------------------------------
    # 6. heartbeat - 心跳保活
    # -------------------------------------------------------------------------
    def heartbeat(self, device_id: str, machine_code: str = "") -> dict:
        """设备心跳保活"""
        return self._encrypted_action("/heartbeat", {
            "device_id": device_id,
            "machine_code": machine_code,
        })

    # -------------------------------------------------------------------------
    # 内部：加密 action（auth/use/unbind/heartbeat）
    # -------------------------------------------------------------------------
    def _encrypted_action(self, path: str, payload: dict) -> dict:
        if not self.config.session_key or not self.config.server_rsa_public_key:
            raise WlyzError(2003, "会话未建立，请先调用 verify_rsa")

        plaintext = json.dumps(payload, separators=(",", ":"))
        iv = os.urandom(16)
        encrypted = self._aes_encrypt(self.config.session_key, iv, plaintext)

        # 加密载荷：{ iv, data }
        body_obj = {
            "iv": iv.hex(),
            "data": encrypted,
        }
        body = json.dumps(body_obj, separators=(",", ":"))

        ts = str(int(time.time()))
        nonce = secrets.token_hex(16)
        signature = self._sign("POST", "/api/v1" + path, ts, nonce, body)
        headers = self._build_headers(ts, nonce, signature)

        resp = self._http_request("POST", self._api_base + path,
                                  body.encode("utf-8"), headers)
        # 响应也是加密的：{ iv, data }
        if "iv" in resp and "data" in resp:
            resp_iv = bytes.fromhex(resp["iv"])
            plaintext_resp = self._aes_decrypt(self.config.session_key,
                                               resp_iv, resp["data"])
            resp = json.loads(plaintext_resp)

        if resp.get("code") != 0:
            raise WlyzError(resp.get("code", 9001),
                            resp.get("msg", "未知错误"),
                            resp.get("data"))
        return resp["data"]

    # -------------------------------------------------------------------------
    # 工具方法
    # -------------------------------------------------------------------------
    def _sign(self, method: str, path: str, ts: str, nonce: str, body: str) -> str:
        """RSA-2048 签名：原文 = METHOD\nPATH\nTS\nNONCE\nBODY"""
        sign_source = "\n".join([method, path, ts, nonce, body])
        private_key = serialization.load_pem_private_key(
            self.config.client_rsa_private_key.encode("utf-8"),
            password=None,
            backend=default_backend(),
        )
        signature = private_key.sign(
            sign_source.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")

    def _build_headers(self, ts: str, nonce: str, signature: str) -> dict:
        return {
            "X-App-Key": self.config.app_key,
            "X-Timestamp": ts,
            "X-Nonce": nonce,
            "X-Signature": signature,
            "Content-Type": "application/json",
        }

    def _aes_encrypt(self, key: bytes, iv: bytes, data: str) -> str:
        """AES-256-CBC 加密，返回 base64"""
        cipher = Cipher(algorithms.AES(key), modes.CBC(iv),
                        backend=default_backend())
        encryptor = cipher.encryptor()
        padded = self._pkcs7_pad(data.encode("utf-8"))
        encrypted = encryptor.update(padded) + encryptor.finalize()
        return base64.b64encode(encrypted).decode("utf-8")

    def _aes_decrypt(self, key: bytes, iv: bytes, encrypted: str) -> str:
        """AES-256-CBC 解密"""
        cipher = Cipher(algorithms.AES(key), modes.CBC(iv),
                        backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted = decryptor.update(base64.b64decode(encrypted)) + decryptor.finalize()
        return self._pkcs7_unpad(decrypted).decode("utf-8")

    @staticmethod
    def _pkcs7_pad(data: bytes) -> bytes:
        pad_len = 16 - (len(data) % 16)
        return data + bytes([pad_len]) * pad_len

    @staticmethod
    def _pkcs7_unpad(data: bytes) -> bytes:
        pad_len = data[-1]
        return data[:-pad_len]

    @staticmethod
    def _load_ecdh_public_key(pem: str):
        return serialization.load_pem_public_key(
            pem.encode("utf-8"), backend=default_backend()
        )

    def _http_post(self, path: str, body: bytes, signed: bool = False) -> dict:
        url = self._api_base + path
        headers = {"Content-Type": "application/json"}
        return self._http_request("POST", url, body, headers)

    def _http_request(self, method: str, url: str, body: bytes,
                      headers: dict) -> dict:
        req = request.Request(url, data=body, method=method, headers=headers)
        try:
            with request.urlopen(req, timeout=self.config.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
        except error.URLError as e:
            raise WlyzError(9001, f"网络错误: {e.reason}")
        return json.loads(raw)


# ---------------------------------------------------------------------------
# 工具：生成客户端 RSA-2048 密钥对
# ---------------------------------------------------------------------------
def generate_client_rsa_keypair() -> tuple[str, str]:
    """生成客户端 RSA-2048 密钥对，返回 (private_pem, public_pem)"""
    private_key = rsa.generate_private_key(
        public_exponent=65537, key_size=2048, backend=default_backend()
    )
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem


# ---------------------------------------------------------------------------
# 使用示例
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # 1. 开发者后台获取：base_url + app_key + 客户端 RSA 私钥
    #    首次接入可用 generate_client_rsa_keypair() 生成密钥对，
    #    将公钥登记到开发者后台。
    private_pem, public_pem = generate_client_rsa_keypair()

    config = ClientConfig(
        base_url="https://api.example.com",
        app_key="YOUR_APP_KEY",
        client_rsa_private_key=private_pem,
    )
    client = WlyzClient(config)

    # 2. 协商会话密钥（每次启动调用一次）
    client.verify_rsa()

    # 3. 验证卡密 + 激活设备
    result = client.auth(
        card_code="XXXX-XXXX-XXXX-XXXX",
        machine_code="MACHINE_CODE_HASH",
        device_name="My Device",
    )
    print("Auth result:", result)
    device_id = result["device_id"]

    # 4. 心跳保活（按 heartbeat_interval 周期调用）
    client.heartbeat(device_id)

    # 5. 检查更新
    update_info = client.check_update()
    print("Update info:", update_info)
