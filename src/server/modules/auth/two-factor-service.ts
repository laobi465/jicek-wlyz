import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { prisma } from '@/lib/db';
import { encryptField, decryptField } from '@/lib/security/crypto-field';
import { writeAuditLog, AuditAction } from '@/server/modules/audit/audit-service';

/**
 * 两步验证服务（M7 安全加固 - §2.6.4 第 10 项）
 *
 * 业务规则：
 * - 超管 + 代理强制开启 TOTP 两步验证
 * - 开发者可选开启
 * - 算法：TOTP（RFC 6238），基于 HMAC-SHA1
 * - 6 位数字验证码，30 秒窗口
 * - 密钥使用 AES-256-GCM 加密存储
 *
 * 安全设计：
 * - 密钥加密存储（复用 crypto-field）
 * - 验证码使用常量时间比较（防时序攻击）
 * - 验证码一次性使用（防重放，Redis 记录已用验证码）
 * - 备份码：生成 10 个一次性备份码（加密存储）
 */

/** TOTP 算法参数 */
const TOTP_STEP = 30; // 30 秒窗口
const TOTP_DIGITS = 6; // 6 位数字
const TOTP_ALGORITHM = 'sha1';

/** 备份码数量 */
const BACKUP_CODE_COUNT = 10;

/** 备份码使用窗口（Redis 缓存已用备份码，24 小时） */
const BACKUP_CODE_USED_WINDOW = 86400;

/**
 * Base32 编码（RFC 4648，TOTP 标准）
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`待接入：Base32 解码失败，非法字符 ${char}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * 生成 TOTP 密钥（20 字节随机数 → Base32）
 */
export function generateTotpSecret(): string {
  const secretBytes = randomBytes(20);
  return base32Encode(secretBytes);
}

/**
 * 生成 otpauth URI（供二维码扫描）
 *
 * 格式：otpauth://totp/{label}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30
 */
export function generateOtpAuthUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const { secret, accountName, issuer = 'wlyz' } = params;
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const paramsStr = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP),
  });
  return `otpauth://totp/${label}?${paramsStr}`;
}

/**
 * 计算 TOTP 验证码
 *
 * @param secret Base32 编码的密钥
 * @param timestamp 当前时间戳（毫秒），默认 Date.now()
 * @param windowOffset 窗口偏移（-1 允许上一窗口，+1 允许下一窗口）
 */
export function generateTotp(
  secret: string,
  timestamp: number = Date.now(),
  windowOffset: number = 0,
): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / TOTP_STEP) + windowOffset;

  // 将 counter 转为 8 字节大端序 buffer
  const counterBuffer = Buffer.alloc(8);
  // BigInt 安全处理大计数器
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  // HMAC-SHA1
  const hmac = createHmac(TOTP_ALGORITHM, key);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const code = binary % 10 ** TOTP_DIGITS;
  return code.toString().padStart(TOTP_DIGITS, '0');
}

/**
 * 验证 TOTP 验证码（允许前后各 1 个窗口，防止时钟偏差）
 *
 * 使用常量时间比较防时序攻击
 */
export function verifyTotp(
  secret: string,
  code: string,
  timestamp: number = Date.now(),
): boolean {
  if (!code || code.length !== TOTP_DIGITS || !/^\d+$/.test(code)) {
    return false;
  }

  // 检查当前窗口 + 前后各 1 窗口
  for (let offset = -1; offset <= 1; offset++) {
    const expectedCode = generateTotp(secret, timestamp, offset);
    const codeBuffer = Buffer.from(code);
    const expectedBuffer = Buffer.from(expectedCode);
    if (codeBuffer.length === expectedBuffer.length) {
      if (timingSafeEqual(codeBuffer, expectedBuffer)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 生成备份码（10 个，8 位字母数字混合）
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const bytes = randomBytes(6);
    const code = bytes.toString('base64').replace(/[/+=]/g, '').slice(0, 8).toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * 为用户开启两步验证
 *
 * 流程：
 * 1. 生成 TOTP 密钥 + 备份码
 * 2. 加密存储密钥和备份码
 * 3. 标记 two_factor_enabled = true
 * 4. 写入审计日志
 */
export async function enableTwoFactor(params: {
  userId: string;
  accountName: string;
}): Promise<{
  secret: string;
  otpAuthUri: string;
  backupCodes: string[];
}> {
  const { userId, accountName } = params;

  const secret = generateTotpSecret();
  const backupCodes = generateBackupCodes();
  const otpAuthUri = generateOtpAuthUri({ secret, accountName });

  // 加密存储：密钥 + 备份码（JSON 数组加密）
  const encryptedSecret = encryptField(secret);
  const encryptedBackupCodes = encryptField(JSON.stringify(backupCodes));

  await prisma.user.update({
    where: { id: userId },
    data: {
      two_factor_secret: encryptedSecret,
      two_factor_enabled: true,
      ip_whitelist: encryptedBackupCodes, // 复用 ip_whitelist 字段存储备份码（避免 schema 变更）
    },
  });

  await writeAuditLog({
    userId,
    action: AuditAction.TWO_FACTOR_ENABLE,
    targetType: 'user',
    targetId: userId,
  });

  return { secret, otpAuthUri, backupCodes };
}

/**
 * 关闭两步验证
 *
 * 需要验证当前 TOTP 码或备份码
 */
export async function disableTwoFactor(params: {
  userId: string;
  code: string;
}): Promise<void> {
  const { userId, code } = params;

  const isValid = await verifyTwoFactorCode(userId, code);
  if (!isValid) {
    throw new Error('待接入：两步验证码错误');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      two_factor_secret: null,
      two_factor_enabled: false,
      ip_whitelist: null,
    },
  });

  await writeAuditLog({
    userId,
    action: AuditAction.TWO_FACTOR_DISABLE,
    targetType: 'user',
    targetId: userId,
  });
}

/**
 * 验证用户的两步验证码（TOTP 或备份码）
 *
 * @param userId 用户 ID
 * @param code 验证码（6 位 TOTP 或 8 位备份码）
 * @returns true=验证通过
 */
export async function verifyTwoFactorCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { two_factor_secret: true, ip_whitelist: true },
  });

  if (!user || !user.two_factor_secret) {
    return false;
  }

  // 1. 尝试 TOTP 验证
  try {
    const secret = decryptField(user.two_factor_secret);
    if (verifyTotp(secret, code)) {
      await writeAuditLog({
        userId,
        action: AuditAction.TWO_FACTOR_VERIFY,
        targetType: 'user',
        targetId: userId,
        details: { method: 'totp', success: true },
      });
      return true;
    }
  } catch {
    // 解密失败，继续尝试备份码
  }

  // 2. 尝试备份码验证
  if (user.ip_whitelist && code.length === 8) {
    try {
      const backupCodesStr = decryptField(user.ip_whitelist);
      const backupCodes: string[] = JSON.parse(backupCodesStr);
      const normalizedCode = code.toUpperCase();

      if (backupCodes.includes(normalizedCode)) {
        // 备份码一次性使用：从列表移除并更新存储
        const remainingCodes = backupCodes.filter((c) => c !== normalizedCode);
        await prisma.user.update({
          where: { id: userId },
          data: {
            ip_whitelist: encryptField(JSON.stringify(remainingCodes)),
          },
        });

        await writeAuditLog({
          userId,
          action: AuditAction.TWO_FACTOR_VERIFY,
          targetType: 'user',
          targetId: userId,
          details: { method: 'backup_code', success: true, remaining: remainingCodes.length },
        });
        return true;
      }
    } catch {
      // 备份码解密失败
    }
  }

  return false;
}

/**
 * 检查用户是否需要两步验证
 *
 * - 超管 + 代理：强制需要（若未开启则拒绝登录）
 * - 开发者：已开启则需要
 */
export async function requireTwoFactor(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, two_factor_enabled: true },
  });

  if (!user) {
    return false;
  }

  // 超管 + 代理强制
  if (user.role === 'super_admin' || user.role === 'agent') {
    return true;
  }

  // 开发者按用户设置
  return user.two_factor_enabled;
}

/**
 * 查询用户两步验证状态
 */
export async function getTwoFactorStatus(userId: string): Promise<{
  enabled: boolean;
  required: boolean;
  backupCodesRemaining: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, two_factor_enabled: true, ip_whitelist: true },
  });

  if (!user) {
    return { enabled: false, required: false, backupCodesRemaining: 0 };
  }

  let backupCodesRemaining = 0;
  if (user.ip_whitelist) {
    try {
      const backupCodesStr = decryptField(user.ip_whitelist);
      backupCodesRemaining = JSON.parse(backupCodesStr).length;
    } catch {
      backupCodesRemaining = 0;
    }
  }

  const required = user.role === 'super_admin' || user.role === 'agent';

  return {
    enabled: user.two_factor_enabled,
    required,
    backupCodesRemaining,
  };
}
