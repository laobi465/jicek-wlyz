import crypto from 'crypto';

/**
 * AES-256-CBC 加密工具
 *
 * 用于业务数据加密（SPEC §2.6.1 第 2/7 项）：
 * - 会话密钥由 verify_rsa 动态下发，单会话单密钥
 * - 请求体与响应体均 AES 加密（双向加密）
 * - PKCS7 填充
 */

/** AES-256 密钥长度（字节） */
export const AES_KEY_LENGTH = 32;
/** AES IV 长度（字节） */
export const AES_IV_LENGTH = 16;

/**
 * AES-256-CBC 加密
 * @param key 32 字节密钥
 * @param iv 16 字节 IV
 * @param data 明文
 * @returns base64 密文
 */
export function aesEncrypt(key: Buffer, iv: Buffer, data: string): string {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

/**
 * AES-256-CBC 解密
 * @param key 32 字节密钥
 * @param iv 16 字节 IV
 * @param encrypted base64 密文
 * @returns 明文
 */
export function aesDecrypt(key: Buffer, iv: Buffer, encrypted: string): string {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * 从种子字符串派生 AES-256 密钥（SHA-256）
 * 用于将任意长度种子（如 ECDHE 共享密钥）转为固定长度 AES 密钥
 */
export function deriveAesKey(seed: string | Buffer): Buffer {
  return crypto.createHash('sha256').update(seed).digest();
}

/** 生成随机 AES IV */
export function generateAesIv(): Buffer {
  return crypto.randomBytes(AES_IV_LENGTH);
}

/** 生成随机 AES-256 密钥 */
export function generateAesKey(): Buffer {
  return crypto.randomBytes(AES_KEY_LENGTH);
}
