// ===========================================================================
// jicek-wlyz Auto.js 示例代码（autojs / Auto.js Pro）
// 网络验证 SaaS 系统 - Android 自动化脚本示例
//
// 协议规范参考 docs/api/protocol.md：
// - verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）
// - auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密
// - check_update: Base64 编码
//
// 注：Auto.js Pro 支持 Node.js 兼容 API（crypto / http），可直接复用 Node.js SDK
// ===========================================================================

'use strict';

const BASE_URL = 'https://api.example.com';
const APP_KEY = 'YOUR_APP_KEY';
const CLIENT_RSA_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
... 你的客户端 RSA 私钥 PEM ...
-----END PRIVATE KEY-----`;

const crypto = require('crypto');
const http = require('http');

let serverRsaPublicKey = null;
let sessionKey = null;

// ---------------------------------------------------------------------------
// 1. verify_rsa
// ---------------------------------------------------------------------------
function verifyRsa() {
    return new Promise((resolve, reject) => {
        // 生成客户端 ECDHE 临时密钥对（P-256）
        const clientEcdh = crypto.createECDH('prime256v1');
        clientEcdh.generateKeys();
        const clientPubDer = clientEcdh.getPublicKey('der', 'uncompressed');
        const clientPubPem = buildPemFromEcPublicDer(clientPubDer);

        const body = JSON.stringify({
            app_key: APP_KEY,
            client_public_key: clientPubPem,
        });

        httpPost('/verify_rsa', body, null).then(resp => {
            if (resp.code !== 0) {
                reject(new Error('verify_rsa failed: ' + resp.msg));
                return;
            }
            serverRsaPublicKey = resp.data.server_public_key;

            // ECDHE 派生会话密钥
            const serverEcdhPubDer = derFromPem(resp.data.ecdhe_public_key);
            const serverEcdhPubBytes = extractEcPublicKey(serverEcdhPubDer);
            const shared = clientEcdh.computeSecret(serverEcdhPubBytes);
            sessionKey = crypto.createHash('sha256').update(shared).digest();

            resolve(resp.data);
        }).catch(reject);
    });
}

// ---------------------------------------------------------------------------
// 2. auth
// ---------------------------------------------------------------------------
function auth(cardCode, machineCode, deviceName) {
    deviceName = deviceName || '';
    return encryptedAction('/auth', {
        card_code: cardCode,
        machine_code: machineCode,
        device_name: deviceName,
    });
}

// ---------------------------------------------------------------------------
// 3. heartbeat
// ---------------------------------------------------------------------------
function heartbeat(deviceId, machineCode) {
    machineCode = machineCode || '';
    return encryptedAction('/heartbeat', {
        device_id: deviceId,
        machine_code: machineCode,
    });
}

// ---------------------------------------------------------------------------
// 4. unbind
// ---------------------------------------------------------------------------
function unbind(deviceId) {
    return encryptedAction('/unbind', { device_id: deviceId });
}

// ---------------------------------------------------------------------------
// 内部：加密 action
// ---------------------------------------------------------------------------
function encryptedAction(path, payload) {
    return new Promise((resolve, reject) => {
        if (!sessionKey) {
            reject(new Error('会话未建立，请先调用 verifyRsa'));
            return;
        }
        const plaintext = JSON.stringify(payload);
        const iv = crypto.randomBytes(16);
        const encrypted = aesEncrypt(sessionKey, iv, plaintext);

        const body = JSON.stringify({
            iv: iv.toString('hex'),
            data: encrypted,
        });

        const ts = String(Math.floor(Date.now() / 1000));
        const nonce = crypto.randomBytes(16).toString('hex');
        const signature = sign('POST', '/api/v1' + path, ts, nonce, body);
        const headers = buildHeaders(ts, nonce, signature);

        httpPost(path, body, headers).then(resp => {
            if (resp && resp.iv && resp.data) {
                const respIv = Buffer.from(resp.iv, 'hex');
                const plain = aesDecrypt(sessionKey, respIv, resp.data);
                resp = JSON.parse(plain);
            }
            if (resp.code !== 0) {
                reject(new Error('[' + resp.code + '] ' + resp.msg));
                return;
            }
            resolve(resp.data);
        }).catch(reject);
    });
}

// ---------------------------------------------------------------------------
// 加密与签名工具
// ---------------------------------------------------------------------------
function sign(method, path, ts, nonce, body) {
    const source = [method, path, ts, nonce, body].join('\n');
    const sig = crypto.sign('sha256', Buffer.from(source, 'utf8'), {
        key: CLIENT_RSA_PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_PADDING,
    });
    return sig.toString('base64');
}

function buildHeaders(ts, nonce, signature) {
    return {
        'X-App-Key': APP_KEY,
        'X-Timestamp': ts,
        'X-Nonce': nonce,
        'X-Signature': signature,
        'Content-Type': 'application/json',
    };
}

function aesEncrypt(key, iv, data) {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('base64');
}

function aesDecrypt(key, iv, encrypted) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
    ]).toString('utf8');
}

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

function extractEcPublicKey(der) {
    for (let i = 0; i < der.length - 64; i++) {
        if (der[i] === 0x04) {
            const candidate = der.subarray(i, i + 65);
            if (candidate.length === 65) return candidate;
        }
    }
    throw new Error('ECDHE 公钥解析失败');
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function httpPost(path, body, headers) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + '/api/v1' + path);
        const options = {
            method: 'POST',
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
        };
        const req = http.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('响应非 JSON: ' + data.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// 主流程（Auto.js 异步入口）
// ---------------------------------------------------------------------------
async function main() {
    // Auto.js 读取 Android 设备唯一标识
    const machineCode = device.getAndroidId() || device.getIMEI();

    await verifyRsa();
    const result = await auth(
        'XXXX-XXXX-XXXX-XXXX',
        machineCode,
        'Auto.js Device'
    );
    toastLog('验证成功，token: ' + result.token);

    // 后台心跳线程
    threads.start(function () {
        while (true) {
            sleep(result.heartbeat_interval * 1000);
            try {
                heartbeat(result.device_id, machineCode);
            } catch (e) {
                toastLog('心跳失败，需重新验证');
                break;
            }
        }
    });
}

main();
