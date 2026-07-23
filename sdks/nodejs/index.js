/**
 * jicek-wlyz Node.js SDK
 * 网络验证 SaaS 系统 Node.js 客户端
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
 * 依赖：Node.js 18+（内置 fetch + crypto + webcrypto）
 */

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 异常
// ---------------------------------------------------------------------------
class WlyzError extends Error {
  constructor(code, msg, data) {
    super(`[${code}] ${msg}`);
    this.name = 'WlyzError';
    this.code = code;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
class ClientConfig {
  /**
   * @param {Object} opts
   * @param {string} opts.baseUrl - 服务端基础 URL
   * @param {string} opts.appKey - 应用 AppKey
   * @param {string} opts.clientRsaPrivateKey - 客户端 RSA 私钥（PEM）
   * @param {string} [opts.serverRsaPublicKey] - 服务端 RSA 公钥（PEM）
   * @param {number} [opts.timeout=10] - 超时（秒）
   */
  constructor(opts) {
    this.baseUrl = opts.baseUrl;
    this.appKey = opts.appKey;
    this.clientRsaPrivateKey = opts.clientRsaPrivateKey;
    this.serverRsaPublicKey = opts.serverRsaPublicKey || null;
    this.timeout = opts.timeout || 10;
    /** @type {Buffer|null} ECDHE 派生会话密钥 */
    this.sessionKey = null;
  }
}

// ---------------------------------------------------------------------------
// 主客户端
// ---------------------------------------------------------------------------
class WlyzClient {
  constructor(config) {
    this.config = config;
    this.apiBase = config.baseUrl.replace(/\/+$/, '') + '/api/v1';
  }

  // -------------------------------------------------------------------------
  // 1. verify_rsa
  // -------------------------------------------------------------------------
  async verifyRsa() {
    // 客户端 ECDHE 临时密钥对（P-256）
    const clientEcdh = crypto.createECDH('prime256v1');
    clientEcdh.generateKeys();
    const clientPubPem = buildPemFromEcPublicDer(
      clientEcdh.getPublicKey('der', 'uncompressed')
    );

    const body = JSON.stringify({
      app_key: this.config.appKey,
      client_public_key: clientPubPem,
    });

    const resp = await this.httpPost('/verify_rsa', body, null);
    const data = this.checkResponse(resp);

    this.config.serverRsaPublicKey = data.server_public_key;

    // ECDHE 派生：客户端私钥 + 服务端 ECDHE 公钥 → SHA-256 → AES-256
    const serverEcdhPubDer = derFromPem(data.ecdhe_public_key);
    // 提取未压缩公钥点（04 + X + Y，共 65 字节）
    const serverEcdhPubBytes = extractEcPublicKeyFromSpki(serverEcdhPubDer);
    const sharedSecret = clientEcdh.computeSecret(serverEcdhPubBytes);
    this.config.sessionKey = crypto.createHash('sha256').update(sharedSecret).digest();

    return data;
  }

  // -------------------------------------------------------------------------
  // 2. auth
  // -------------------------------------------------------------------------
  async auth(cardCode, machineCode, deviceName = '') {
    return this.encryptedAction('/auth', {
      card_code: cardCode,
      machine_code: machineCode,
      device_name: deviceName,
    });
  }

  // -------------------------------------------------------------------------
  // 3. use
  // -------------------------------------------------------------------------
  async use(deviceId, cardCode) {
    return this.encryptedAction('/use', {
      device_id: deviceId,
      card_code: cardCode,
    });
  }

  // -------------------------------------------------------------------------
  // 4. unbind
  // -------------------------------------------------------------------------
  async unbind(deviceId) {
    return this.encryptedAction('/unbind', { device_id: deviceId });
  }

  // -------------------------------------------------------------------------
  // 5. check_update
  // -------------------------------------------------------------------------
  async checkUpdate() {
    if (!this.config.serverRsaPublicKey) {
      throw new WlyzError(2003, '未获取服务端公钥，请先调用 verifyRsa');
    }
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const body = '';
    const path = '/api/v1/check_update';
    const signature = this.sign('POST', path, ts, nonce, body);
    const headers = this.buildHeaders(ts, nonce, signature);
    const resp = await this.httpPost('/check_update', body, headers);
    return this.checkResponse(resp);
  }

  // -------------------------------------------------------------------------
  // 6. heartbeat
  // -------------------------------------------------------------------------
  async heartbeat(deviceId, machineCode = '') {
    return this.encryptedAction('/heartbeat', {
      device_id: deviceId,
      machine_code: machineCode,
    });
  }

  // -------------------------------------------------------------------------
  // 内部：加密 action
  // -------------------------------------------------------------------------
  async encryptedAction(path, payload) {
    if (!this.config.sessionKey || !this.config.serverRsaPublicKey) {
      throw new WlyzError(2003, '会话未建立，请先调用 verifyRsa');
    }
    const plaintext = JSON.stringify(payload);
    const iv = crypto.randomBytes(16);
    const encrypted = this.aesEncrypt(this.config.sessionKey, iv, plaintext);

    const bodyObj = { iv: iv.toString('hex'), data: encrypted };
    const body = JSON.stringify(bodyObj);

    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const signature = this.sign('POST', '/api/v1' + path, ts, nonce, body);
    const headers = this.buildHeaders(ts, nonce, signature);

    let resp = await this.httpPost(path, body, headers);
    if (resp && resp.iv && resp.data) {
      const respIv = Buffer.from(resp.iv, 'hex');
      const plainResp = this.aesDecrypt(this.config.sessionKey, respIv, resp.data);
      resp = JSON.parse(plainResp);
    }
    return this.checkResponse(resp);
  }

  checkResponse(resp) {
    if (!resp || resp.code !== 0) {
      throw new WlyzError(
        resp ? resp.code || 9001 : 9001,
        resp ? resp.msg || '未知错误' : '空响应',
        resp ? resp.data : null
      );
    }
    return resp.data;
  }

  // -------------------------------------------------------------------------
  // 加密与签名
  // -------------------------------------------------------------------------
  sign(method, path, ts, nonce, body) {
    const source = [method, path, ts, nonce, body].join('\n');
    const signature = crypto.sign('sha256', Buffer.from(source, 'utf8'), {
      key: this.config.clientRsaPrivateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    });
    return signature.toString('base64');
  }

  buildHeaders(ts, nonce, signature) {
    return {
      'X-App-Key': this.config.appKey,
      'X-Timestamp': ts,
      'X-Nonce': nonce,
      'X-Signature': signature,
      'Content-Type': 'application/json',
    };
  }

  aesEncrypt(key, iv, data) {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('base64');
  }

  aesDecrypt(key, iv, encrypted) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------
  async httpPost(path, body, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout * 1000);
    try {
      const resp = await fetch(this.apiBase + path, {
        method: 'POST',
        headers: headers || { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      const text = await resp.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new WlyzError(9001, `响应非合法 JSON: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new WlyzError(9001, '请求超时');
      }
      throw new WlyzError(9001, `网络错误: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function derFromPem(pem) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}

function buildPemFromEcPublicDer(der) {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

function extractEcPublicKeyFromSpki(der) {
  // SPKI 格式：算法标识 + 04 + 32 字节 X + 32 字节 Y（P-256）
  for (let i = 0; i < der.length - 64; i++) {
    if (der[i] === 0x04) {
      const candidate = der.subarray(i, i + 65);
      if (candidate.length === 65) return candidate;
    }
  }
  throw new WlyzError(2003, 'ECDHE 公钥解析失败');
}

// ---------------------------------------------------------------------------
// 工具：生成客户端 RSA-2048 密钥对
// ---------------------------------------------------------------------------
function generateClientRsaKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

// ---------------------------------------------------------------------------
// 使用示例
// ---------------------------------------------------------------------------
async function main() {
  const { privateKey } = generateClientRsaKeypair();
  const config = new ClientConfig({
    baseUrl: 'https://api.example.com',
    appKey: 'YOUR_APP_KEY',
    clientRsaPrivateKey: privateKey,
  });
  const client = new WlyzClient(config);

  await client.verifyRsa();
  const authResult = await client.auth(
    'XXXX-XXXX-XXXX-XXXX',
    'MACHINE_CODE_HASH',
    'My Device'
  );
  console.log('Auth:', authResult);

  await client.heartbeat(authResult.device_id);
  const updateInfo = await client.checkUpdate();
  console.log('Update:', updateInfo);
}

if (require.main === module) main();

module.exports = { WlyzClient, ClientConfig, WlyzError, generateClientRsaKeypair };
