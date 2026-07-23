<?php
/**
 * jicek-wlyz PHP SDK
 * 网络验证 SaaS 系统 PHP 客户端
 *
 * 协议规范参考 docs/api/protocol.md：
 * - verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）
 * - auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密
 * - check_update: Base64 编码
 *
 * 安全设计（SPEC §2.6.1）：
 * - 请求头 RSA-2048 签名（METHOD\nPATH\nTS\nNONCE\nBODY）
 * - 时间戳 5 分钟有效期，Nonce 32 位随机串
 * - AES-256-CBC 业务加密 + 响应解密
 * - ECDHE PFS 完美前向保密
 *
 * 依赖：PHP 7.4+，openssl 扩展，curl 扩展
 */

namespace Jicek\Wlyz;

use Exception;

class WlyzException extends Exception
{
    public int $code;
    public $data;

    public function __construct(int $code, string $msg, $data = null)
    {
        parent::__construct("[$code] $msg");
        $this->code = $code;
        $this->data = $data;
    }
}

class ClientConfig
{
    public string $baseUrl;
    public string $appKey;
    public string $clientRsaPrivateKey;  // PEM
    public ?string $serverRsaPublicKey = null;
    public ?string $sessionKey = null;   // hex（ECDHE 派生）
    public int $timeout = 10;

    public function __construct(string $baseUrl, string $appKey, string $clientRsaPrivateKey)
    {
        $this->baseUrl = $baseUrl;
        $this->appKey = $appKey;
        $this->clientRsaPrivateKey = $clientRsaPrivateKey;
    }
}

class WlyzClient
{
    private ClientConfig $config;
    private string $apiBase;

    public function __construct(ClientConfig $config)
    {
        $this->config = $config;
        $this->apiBase = rtrim($config->baseUrl, '/') . '/api/v1';
    }

    /**
     * 1. verify_rsa - 获取服务端 RSA 公钥 + ECDHE 会话密钥协商
     */
    public function verifyRsa(): array
    {
        // 生成客户端 ECDHE 临时密钥对（P-256）
        $clientKey = openssl_pkey_new([
            'ec_key_type' => 'EC',
            'ec_curve_name' => 'prime256v1',
        ]);
        $clientPubKeyDetails = openssl_pkey_get_details($clientKey);
        $clientPubPem = $clientPubKeyDetails['key'];

        $body = json_encode([
            'app_key' => $this->config->appKey,
            'client_public_key' => $clientPubPem,
        ]);

        $resp = $this->httpPost('/verify_rsa', $body, null);
        $data = $this->checkResponse($resp);

        $this->config->serverRsaPublicKey = $data['server_public_key'];

        // ECDHE 派生会话密钥
        $serverEcdhPub = openssl_pkey_get_public($data['ecdhe_public_key']);
        $sharedSecret = openssl_pkey_derive($clientKey, $serverEcdhPub, 32);
        // SHA-256 派生 AES-256 密钥
        $this->config->sessionKey = hash('sha256', $sharedSecret, false);

        return $data;
    }

    /**
     * 2. auth - 验证卡密并激活设备
     */
    public function auth(string $cardCode, string $machineCode, string $deviceName = ''): array
    {
        return $this->encryptedAction('/auth', [
            'card_code' => $cardCode,
            'machine_code' => $machineCode,
            'device_name' => $deviceName,
        ]);
    }

    /**
     * 3. use - 次数卡扣减
     */
    public function use(string $deviceId, string $cardCode): array
    {
        return $this->encryptedAction('/use', [
            'device_id' => $deviceId,
            'card_code' => $cardCode,
        ]);
    }

    /**
     * 4. unbind - 解绑设备
     */
    public function unbind(string $deviceId): array
    {
        return $this->encryptedAction('/unbind', [
            'device_id' => $deviceId,
        ]);
    }

    /**
     * 5. check_update - 检查更新和云配置
     */
    public function checkUpdate(): array
    {
        if ($this->config->serverRsaPublicKey === null) {
            throw new WlyzException(2003, '未获取服务端公钥，请先调用 verifyRsa');
        }
        $ts = (string) time();
        $nonce = bin2hex(random_bytes(16));
        $body = '';
        $path = '/api/v1/check_update';
        $signature = $this->sign('POST', $path, $ts, $nonce, $body);

        $headers = $this->buildHeaders($ts, $nonce, $signature);
        $resp = $this->httpPost('/check_update', $body, $headers);
        return $this->checkResponse($resp);
    }

    /**
     * 6. heartbeat - 心跳保活
     */
    public function heartbeat(string $deviceId, string $machineCode = ''): array
    {
        return $this->encryptedAction('/heartbeat', [
            'device_id' => $deviceId,
            'machine_code' => $machineCode,
        ]);
    }

    // ---------------------------------------------------------------------
    // 内部：加密 action
    // ---------------------------------------------------------------------
    private function encryptedAction(string $path, array $payload): array
    {
        if ($this->config->sessionKey === null || $this->config->serverRsaPublicKey === null) {
            throw new WlyzException(2003, '会话未建立，请先调用 verifyRsa');
        }

        $plaintext = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $iv = random_bytes(16);
        $encrypted = $this->aesEncrypt($this->config->sessionKey, $iv, $plaintext);

        $bodyObj = [
            'iv' => bin2hex($iv),
            'data' => $encrypted,
        ];
        $body = json_encode($bodyObj, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $ts = (string) time();
        $nonce = bin2hex(random_bytes(16));
        $signature = $this->sign('POST', '/api/v1' . $path, $ts, $nonce, $body);
        $headers = $this->buildHeaders($ts, $nonce, $signature);

        $resp = $this->httpPost($path, $body, $headers);

        if (isset($resp['iv']) && isset($resp['data'])) {
            $respIv = hex2bin($resp['iv']);
            $plainResp = $this->aesDecrypt($this->config->sessionKey, $respIv, $resp['data']);
            $resp = json_decode($plainResp, true);
        }

        return $this->checkResponse($resp);
    }

    private function checkResponse(array $resp): array
    {
        $code = $resp['code'] ?? 9001;
        if ($code !== 0) {
            throw new WlyzException($code, $resp['msg'] ?? '未知错误', $resp['data'] ?? null);
        }
        return $resp['data'] ?? [];
    }

    // ---------------------------------------------------------------------
    // 加密与签名
    // ---------------------------------------------------------------------
    private function sign(string $method, string $path, string $ts, string $nonce, string $body): string
    {
        $source = implode("\n", [$method, $path, $ts, $nonce, $body]);
        openssl_sign($source, $signature, $this->config->clientRsaPrivateKey, OPENSSL_ALGO_SHA256);
        return base64_encode($signature);
    }

    private function buildHeaders(string $ts, string $nonce, string $signature): array
    {
        return [
            'X-App-Key: ' . $this->config->appKey,
            'X-Timestamp: ' . $ts,
            'X-Nonce: ' . $nonce,
            'X-Signature: ' . $signature,
            'Content-Type: application/json',
        ];
    }

    private function aesEncrypt(string $keyHex, string $iv, string $data): string
    {
        $key = hex2bin($keyHex);
        $padded = $this->pkcs7Pad($data, 16);
        $encrypted = openssl_encrypt(
            $padded,
            'AES-256-CBC',
            $key,
            OPENSSL_RAW_DATA | OPENSSL_NO_PADDING,
            $iv
        );
        return base64_encode($encrypted);
    }

    private function aesDecrypt(string $keyHex, string $iv, string $encrypted): string
    {
        $key = hex2bin($keyHex);
        $decrypted = openssl_decrypt(
            base64_decode($encrypted),
            'AES-256-CBC',
            $key,
            OPENSSL_RAW_DATA | OPENSSL_NO_PADDING,
            $iv
        );
        return $this->pkcs7Unpad($decrypted);
    }

    private function pkcs7Pad(string $data, int $blockSize): string
    {
        $padLen = $blockSize - (strlen($data) % $blockSize);
        return $data . str_repeat(chr($padLen), $padLen);
    }

    private function pkcs7Unpad(string $data): string
    {
        $padLen = ord($data[strlen($data) - 1]);
        return substr($data, 0, -$padLen);
    }

    // ---------------------------------------------------------------------
    // HTTP
    // ---------------------------------------------------------------------
    private function httpPost(string $path, string $body, ?array $headers): array
    {
        $url = $this->apiBase . $path;
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $this->config->timeout);
        $h = ['Content-Type: application/json'];
        if ($headers !== null) {
            $h = array_merge($h, $headers);
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $h);

        $raw = curl_exec($ch);
        if (curl_errno($ch)) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new WlyzException(9001, "网络错误: $err");
        }
        curl_close($ch);

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new WlyzException(9001, '响应非合法 JSON');
        }
        return $decoded;
    }
}
