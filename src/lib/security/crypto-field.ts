import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { ErrorCode } from '@/lib/security/error-code';

/**
 * 敏感字段加密服务（M7 安全加固 - §2.6.4 第 14 项）
 *
 * 职责：
 * - 手机号 / 真实姓名 / 邮箱等敏感字段 AES-256-GCM 加密存储
 * - 密码使用 bcrypt 单向哈希（不在本模块处理）
 *
 * 安全设计：
 * - 算法：AES-256-GCM（带认证标签，防篡改）
 * - 密钥派生：scrypt 从主密钥 + 固定 salt 派生 32 字节密钥
 * - IV：每条记录随机 12 字节 IV，密文格式 = iv(12B) + ciphertext + authTag(16B)
 * - 密钥来源：环境变量 FIELD_ENCRYPTION_KEY（32+ 字符）
 *
 * 密文存储格式（base64）：base64(iv | ciphertext | authTag)
 */

/** 加密算法 */
const ALGORITHM = 'aes-256-gcm';
/** IV 长度（字节） */
const IV_LENGTH = 12;
/** AuthTag 长度（字节） */
const AUTH_TAG_LENGTH = 16;
/** Salt 长度（字节） */
const SALT_LENGTH = 16;
/** 派生密钥长度（字节） */
const KEY_LENGTH = 32;
/** scrypt 计算成本 */
const SCRYPT_N = 16384;

/** 固定 salt（用于密钥派生，与密钥分离存储在代码中） */
const DERIVATION_SALT = Buffer.from(
  'wlyz-field-encryption-salt-v1',
  'utf8',
);

/** 缓存派生密钥，避免重复 scrypt 计算 */
let derivedKeyCache: Buffer | null = null;

/**
 * 获取派生密钥
 *
 * 从环境变量 FIELD_ENCRYPTION_KEY 派生 32 字节 AES 密钥
 */
function getDerivedKey(): Buffer {
  if (derivedKeyCache) {
    return derivedKeyCache;
  }

  const masterKey = process.env.FIELD_ENCRYPTION_KEY;
  if (!masterKey || masterKey.length < 32) {
    throw new Error(
      '待接入：环境变量 FIELD_ENCRYPTION_KEY 未配置或长度不足 32 字符',
    );
  }

  derivedKeyCache = scryptSync(masterKey, DERIVATION_SALT, KEY_LENGTH, {
    N: SCRYPT_N,
  });
  return derivedKeyCache;
}

/**
 * 加密敏感字段
 *
 * @param plaintext 明文（字符串）
 * @returns base64 编码的密文（iv + ciphertext + authTag）
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  try {
    const key = getDerivedKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // 拼接 iv + ciphertext + authTag，base64 编码
    const combined = Buffer.concat([iv, ciphertext, authTag]);
    return combined.toString('base64');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`待接入：敏感字段加密失败 - ${msg}`);
  }
}

/**
 * 解密敏感字段
 *
 * @param encrypted base64 编码的密文
 * @returns 明文字符串
 */
export function decryptField(encrypted: string): string {
  if (!encrypted) {
    return encrypted;
  }

  try {
    const key = getDerivedKey();
    const combined = Buffer.from(encrypted, 'base64');

    // 校验最小长度（iv + authTag 至少 28 字节）
    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('密文长度不足');
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(
      IV_LENGTH,
      combined.length - AUTH_TAG_LENGTH,
    );

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`待接入：敏感字段解密失败 - ${msg}`);
  }
}

/**
 * 批量解密敏感字段（用于列表展示时脱敏返回）
 *
 * @param encrypted 加密字段值
 * @param maskMode 脱敏模式：'none' 不脱敏 / 'phone' 手机号脱敏 / 'name' 姓名脱敏 / 'email' 邮箱脱敏
 * @returns 脱敏后的字符串
 */
export function decryptFieldWithMask(
  encrypted: string | null | undefined,
  maskMode: 'none' | 'phone' | 'name' | 'email',
): string {
  if (!encrypted) {
    return '';
  }

  let plaintext: string;
  try {
    plaintext = decryptField(encrypted);
  } catch {
    return '***';
  }

  switch (maskMode) {
    case 'phone':
      // 138****8888
      if (plaintext.length >= 11) {
        return plaintext.slice(0, 3) + '****' + plaintext.slice(-4);
      }
      return '***';
    case 'name':
      // 张*（仅保留首字）
      if (plaintext.length >= 1) {
        return plaintext[0] + '*'.repeat(Math.max(plaintext.length - 1, 1));
      }
      return '***';
    case 'email':
      // z***@example.com
      {
        const atIndex = plaintext.indexOf('@');
        if (atIndex > 0) {
          return plaintext[0] + '***' + plaintext.slice(atIndex);
        }
      }
      return '***';
    case 'none':
    default:
      return plaintext;
  }
}

/**
 * 判断字段是否已加密（base64 且长度合理）
 *
 * 用于兼容旧数据（明文存储）
 */
export function isEncryptedField(value: string): boolean {
  if (!value) return false;
  // base64 字符集校验 + 最小长度（iv 12 + authTag 16 = 28 字节 → base64 至少 40 字符）
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 40;
}

// 抑制未使用的导入告警（SALT_LENGTH 保留供未来密钥轮换使用）
void SALT_LENGTH;
void ErrorCode;
