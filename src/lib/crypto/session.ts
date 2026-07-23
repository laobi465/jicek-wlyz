import crypto from 'crypto';

/**
 * ECDHE 完美前向保密（PFS）会话密钥协商（SPEC §2.6.1 第 6 项）
 *
 * 每次 verify_rsa 时：
 * 1. 服务端生成 ECDHE 临时密钥对（P-256 / prime256v1）
 * 2. 客户端也生成临时密钥对，发送公钥
 * 3. 双方用 ECDH 计算共享密钥 → SHA-256 派生 AES-256 会话密钥
 * 4. 会话结束销毁临时密钥对，实现 PFS
 */

/** ECDH 曲线：P-256（prime256v1），NIST 标准曲线 */
const ECDH_CURVE = 'prime256v1';

/** ECDHE 临时密钥对 */
export interface EcdhKeyPair {
  /** PEM 格式公钥 */
  publicKey: string;
  /** PEM 格式私钥 */
  privateKey: string;
}

/**
 * 生成 ECDHE 临时密钥对（P-256）
 */
export function generateEphemeralKeyPair(): EcdhKeyPair {
  const ecdh = crypto.createECDH(ECDH_CURVE);
  ecdh.generateKeys();
  // 使用 KeyObject 导出 PEM，便于存储与传输
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: ECDH_CURVE,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * 从 ECDHE 私钥与对端公钥派生会话密钥
 *
 * 流程：ECDH 计算共享密钥 → SHA-256 → 32 字节 AES-256 密钥
 *
 * @param privateKey 本方 ECDHE 私钥（PEM）
 * @param peerPublicKey 对端 ECDHE 公钥（PEM）
 * @returns 32 字节 AES-256 会话密钥
 */
export function deriveSessionKey(
  privateKey: string,
  peerPublicKey: string,
): Buffer {
  // 创建 ECDH 对象并导入私钥
  const ecdh = crypto.createECDH(ECDH_CURVE);
  // 从 KeyObject 提取原始私钥点
  const privKeyObj = crypto.createPrivateKey({
    key: privateKey,
    format: 'pem',
    type: 'pkcs8',
  });
  // 导出原始私钥字节（DER → 提取 d 参数）
  const privDer = privKeyObj.export({ type: 'sec1', format: 'der' });
  ecdh.setPrivateKey(extractEcPrivateKey(privDer));

  // 导入对端公钥
  const pubKeyObj = crypto.createPublicKey({
    key: peerPublicKey,
    format: 'pem',
    type: 'spki',
  });
  const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  const peerPubBytes = extractEcPublicKey(pubDer);

  // ECDH 计算共享密钥（只需本方私钥 + 对端公钥，公钥自动派生）
  const sharedSecret = ecdh.computeSecret(peerPubBytes);
  // SHA-256 派生 AES-256 密钥
  return crypto.createHash('sha256').update(sharedSecret).digest();
}

/**
 * 从 SEC1 DER 中提取 EC 私钥字节（d 参数）
 * SEC1 格式：前缀 + 1 字节 04 + 私钥
 */
function extractEcPrivateKey(der: Buffer): Buffer {
  // SEC1 DER 中私钥 d 是最后一个字段，简化处理：查找 04 标记后的 32 字节
  for (let i = der.length - 33; i >= 0; i--) {
    if (der[i] === 0x04 && i + 33 <= der.length) {
      return der.subarray(i + 1, i + 33);
    }
  }
  throw new Error('待接入：ECDHE 私钥解析失败');
}

/**
 * 从 SPKI DER 中提取 EC 公钥点（未压缩格式：04 + X + Y，共 65 字节）
 */
function extractEcPublicKey(der: Buffer): Buffer {
  // SPKI 格式：算法标识 + 04 + 32 字节 X + 32 字节 Y
  for (let i = 0; i < der.length - 64; i++) {
    if (der[i] === 0x04) {
      const candidate = der.subarray(i, i + 65);
      if (candidate.length === 65) return candidate;
    }
  }
  throw new Error('待接入：ECDHE 公钥解析失败');
}
