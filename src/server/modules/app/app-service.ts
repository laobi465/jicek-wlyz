import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { generateRsaKeyPair, rsaSign } from '@/lib/crypto/rsa';
import { deriveAesKey, aesEncrypt, generateAesIv } from '@/lib/crypto/aes';

/**
 * 应用管理服务（SPEC §2.1 模块 1）
 *
 * 职责：
 * 1. 开发者创建应用 → 生成 AppKey + client_secret + RSA 密钥对
 * 2. 查询应用（SDK 请求时按 AppKey 查询）
 * 3. 更新应用配置（版本/公告/心跳间隔/设备策略）
 * 4. 配置签名（服务端私钥签名，SDK 读取时校验防篡改）
 *
 * 安全设计：
 * - RSA 私钥使用环境变量 MASTER_KEY 进行 AES 加密后存储
 * - client_secret 同样加密存储
 * - AppKey 全局唯一，使用 cuid + 随机前缀
 */

/** 应用 RSA 私钥加密密钥（从环境变量读取，禁止硬编码） */
function getMasterKey(): string {
  const key = process.env.MASTER_KEY;
  if (!key) {
    throw new Error('待接入：环境变量 MASTER_KEY 未配置（用于加密 RSA 私钥）');
  }
  return key;
}

/** 用主密钥加密敏感数据 */
function encryptSecret(plaintext: string): string {
  const key = deriveAesKey(getMasterKey());
  const iv = generateAesIv();
  return `${iv.toString('hex')}:${aesEncrypt(key, iv, plaintext)}`;
}

/** 用主密钥解密敏感数据 */
function decryptSecret(encrypted: string): string {
  const key = deriveAesKey(getMasterKey());
  const [ivHex, ciphertext] = encrypted.split(':');
  // aesDecrypt 在此处引入避免循环依赖
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { aesDecrypt } = require('@/lib/crypto/aes') as typeof import('@/lib/crypto/aes');
  return aesDecrypt(key, Buffer.from(ivHex, 'hex'), ciphertext);
}

/** 生成全局唯一 AppKey */
function generateAppKey(): string {
  return `ak_${crypto.randomBytes(12).toString('hex')}`;
}

/** 生成 client_secret */
function generateClientSecret(): string {
  return `cs_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * 创建应用
 *
 * 生成 AppKey + client_secret + RSA-2048 密钥对，私钥加密存储。
 */
export async function createApp(
  developerId: string,
  name: string,
  description?: string,
) {
  const { publicKey, privateKey } = generateRsaKeyPair();
  const appKey = generateAppKey();
  const clientSecret = generateClientSecret();

  const app = await prisma.app.create({
    data: {
      developer_id: developerId,
      name,
      description: description ?? null,
      app_key: appKey,
      client_secret: encryptSecret(clientSecret),
      rsa_public_key: publicKey,
      rsa_private_key: encryptSecret(privateKey),
      status: 'active',
    },
  });

  // 生成配置签名
  const signature = regenerateConfigSignature(app.id);

  return { app, clientSecret, privateKey, configSignature: await signature };
}

/**
 * 按 AppKey 查询应用（SDK 请求入口）
 */
export async function getAppByKey(appKey: string) {
  return prisma.app.findUnique({
    where: { app_key: appKey },
  });
}

/**
 * 获取应用的 RSA 公钥（明文存储，可直接返回）
 */
export async function getAppPublicKey(appId: string): Promise<string | null> {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: { rsa_public_key: true },
  });
  return app?.rsa_public_key ?? null;
}

/**
 * 获取应用的 RSA 私钥（解密后返回，仅服务端内部使用）
 */
export async function getAppPrivateKey(appId: string): Promise<string | null> {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: { rsa_private_key: true },
  });
  if (!app) return null;
  return decryptSecret(app.rsa_private_key);
}

/**
 * 更新应用配置
 */
export async function updateApp(
  appId: string,
  updates: {
    name?: string;
    description?: string;
    version?: string;
    announcement?: string;
    forceUpdate?: boolean;
    minVersion?: string;
    updateUrl?: string;
    heartbeatInterval?: number;
    maxDevices?: number;
    unbindRule?: string;
  },
) {
  const app = await prisma.app.update({
    where: { id: appId },
    data: {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.version !== undefined ? { version: updates.version } : {}),
      ...(updates.announcement !== undefined ? { announcement: updates.announcement } : {}),
      ...(updates.forceUpdate !== undefined ? { force_update: updates.forceUpdate } : {}),
      ...(updates.minVersion !== undefined ? { min_version: updates.minVersion } : {}),
      ...(updates.updateUrl !== undefined ? { update_url: updates.updateUrl } : {}),
      ...(updates.heartbeatInterval !== undefined ? { heartbeat_interval: updates.heartbeatInterval } : {}),
      ...(updates.maxDevices !== undefined ? { max_devices: updates.maxDevices } : {}),
      ...(updates.unbindRule !== undefined ? { unbind_rule: updates.unbindRule } : {}),
    },
  });

  // 配置变更后重新签名
  await regenerateConfigSignature(appId);
  return app;
}

/**
 * 重新生成应用配置签名（防篡改）
 *
 * 签名原文 = 版本号 + 心跳间隔 + 最大设备数 + 解绑规则
 * 使用应用 RSA 私钥签名，SDK 读取配置时用公钥验签。
 */
export async function regenerateConfigSignature(appId: string): Promise<string> {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: {
      version: true,
      heartbeat_interval: true,
      max_devices: true,
      unbind_rule: true,
      rsa_private_key: true,
    },
  });
  if (!app) throw new Error('待接入：应用不存在');

  const privateKey = decryptSecret(app.rsa_private_key);
  const original = `${app.version}|${app.heartbeat_interval}|${app.max_devices}|${app.unbind_rule}`;
  const signature = rsaSign(privateKey, original);

  await prisma.app.update({
    where: { id: appId },
    data: { config_signature: signature },
  });

  return signature;
}

/**
 * 列出开发者的应用（开发者后台用）
 *
 * 按 developer_id 查询，支持 status 过滤与分页，include 设备/卡密计数。
 */
export async function listAppsByDeveloper(
  developerId: string,
  options?: { status?: string; limit?: number; offset?: number },
): Promise<{ apps: Awaited<ReturnType<typeof prisma.app.findMany>>; total: number }> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  const where: { developer_id: string; status?: string } = { developer_id: developerId };
  if (options?.status) {
    where.status = options.status;
  }

  const [apps, total] = await Promise.all([
    prisma.app.findMany({
      where,
      include: { _count: { select: { devices: true, card_keys: true } } },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.app.count({ where }),
  ]);

  return { apps, total };
}

/**
 * 按 ID 查询应用（可选校验归属）
 *
 * 传入 developerId 时，归属不匹配返回 null（隐藏存在性）。
 */
export async function getAppById(appId: string, developerId?: string) {
  const app = await prisma.app.findUnique({ where: { id: appId } });
  if (!app) return null;
  if (developerId && app.developer_id !== developerId) {
    return null;
  }
  return app;
}

/**
 * 停用应用（校验归属后置 status='disabled'）
 */
export async function disableApp(appId: string, developerId: string) {
  const app = await getAppById(appId, developerId);
  if (!app) {
    throw new Error('待接入：应用不存在或无权操作');
  }
  return prisma.app.update({
    where: { id: appId },
    data: { status: 'disabled' },
  });
}
