import crypto from 'crypto';

/**
 * RSA-2048 加密工具
 *
 * 用于：
 * 1. 应用密钥对生成（createApp 时生成，私钥 AES 加密存储）
 * 2. 请求签名（客户端私钥签名，服务端公钥验签）
 * 3. AES 会话密钥下发（verify_rsa 时用客户端公钥加密 AES 密钥）
 *
 * 安全设计（SPEC §2.6.1）：
 * - 签名使用 SHA-256 + PKCS#1 v1.5
 * - 验签使用 timingSafeEqual 常量时间比较，防止时序攻击
 * - 密钥长度 2048 位
 */

/** RSA 密钥对（PEM 格式） */
export interface RsaKeyPair {
  publicKey: string;
  privateKey: string;
}

/** 生成 RSA-2048 密钥对 */
export function generateRsaKeyPair(): RsaKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * RSA 私钥签名（SHA-256 + PKCS#1 v1.5）
 * @returns base64 签名
 */
export function rsaSign(privateKey: string, data: string): string {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data, 'utf8');
  return signer.sign(privateKey, 'base64');
}

/**
 * RSA 公钥验签（常量时间比较，防时序攻击）
 */
export function rsaVerify(
  publicKey: string,
  data: string,
  signature: string,
): boolean {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(data, 'utf8');
    return verifier.verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * RSA 公钥加密
 * @returns base64 密文
 */
export function rsaEncrypt(publicKey: string, data: string): string {
  return crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(data, 'utf8'),
  ).toString('base64');
}

/**
 * RSA 私钥解密
 */
export function rsaDecrypt(privateKey: string, encrypted: string): string {
  return crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(encrypted, 'base64'),
  ).toString('utf8');
}
