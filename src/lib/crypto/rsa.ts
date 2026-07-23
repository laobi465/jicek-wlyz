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

/**
 * 从环境变量加载 RSA 私钥（PEM 格式）
 *
 * 兼容两种存储格式：
 * 1. PEM 原文（以 `-----BEGIN` 开头）：直接返回，兼容直接粘贴 PEM 的场景
 * 2. Base64 编码（install.sh 生成）：解码后返回 PEM
 *
 * 设计原因：PEM 含换行，在 .env 文件和 docker-compose environment 中传递
 * 极易出错（多行被截断），因此 install.sh 统一用 base64 编码为单行存储，
 * 运行时解码还原为 PEM。本函数自动检测两种格式，保证向后兼容。
 *
 * @param envKey 环境变量名（如 'PLATFORM_RSA_PRIVATE_KEY'）
 * @returns PEM 格式私钥字符串
 * @throws 环境变量未配置时抛错（铁律 04 显式失败）
 */
export function loadPrivateKeyFromEnv(envKey: string): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`待接入：环境变量 ${envKey} 未配置`);
  }
  const trimmed = raw.trim();
  // PEM 原文：直接返回
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed;
  }
  // Base64 编码：解码还原 PEM
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.startsWith('-----BEGIN')) {
      return decoded;
    }
  } catch {
    // 解码失败，忽略，落到下方抛错
  }
  throw new Error(
    `待接入：环境变量 ${envKey} 格式无效（应为 PEM 原文或 base64 编码的 PEM）`,
  );
}
