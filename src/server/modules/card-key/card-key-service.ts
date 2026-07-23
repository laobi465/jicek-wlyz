import { prisma } from '@/lib/db';
import { createQueue, QueueName } from '@/lib/queue';
import { generateCardCode } from './card-code-generator';
import { rsaSign } from '@/lib/crypto/rsa';
import { deriveAesKey, aesEncrypt, generateAesIv } from '@/lib/crypto/aes';

/**
 * 卡密管理服务（SPEC §2.6.2 卡密安全 13 项）
 *
 * 职责：
 * 1. 批量生成卡密（同步 ≤100 张，>100 走 BullMQ 异步）
 * 2. 卡密包含：明文卡号 + CRC32 校验位 + RSA 签名 + AES 开发者 ID 水印
 * 3. 作废卡密（远程失效）
 * 4. 加入黑名单池
 *
 * 安全设计：
 * - RSA 签名（平台私钥，SDK 校验后才提交）
 * - 开发者 ID 水印（AES 加密，泄露追溯）
 * - 黑名单池全局拦截
 */

/** 同步生成阈值（超过此数量走 BullMQ 异步） */
const SYNC_THRESHOLD = 100;

/** 卡密类型 */
export type CardType = 'day' | 'week' | 'month' | 'year' | 'permanent' | 'count' | 'custom_hour';

/** 生成卡密入参 */
export interface GenerateCardsParams {
  appId: string;
  templateId?: string;
  issuerId: string;
  count: number;
  type: CardType;
  durationHours?: number;
  maxCount?: number;
  countTimeLimit?: number;
}

/** 平台主密钥（用于开发者水印 AES 加密） */
function getMasterKey(): string {
  const key = process.env.MASTER_KEY;
  if (!key) throw new Error('待接入：环境变量 MASTER_KEY 未配置');
  return key;
}

/** 生成开发者 ID 水印（AES 加密） */
function generateDeveloperWatermark(developerId: string): string {
  const key = deriveAesKey(getMasterKey());
  const iv = generateAesIv();
  return `${iv.toString('hex')}:${aesEncrypt(key, iv, developerId)}`;
}

/** 平台 RSA 私钥（用于卡密签名） */
function getPlatformPrivateKey(): string {
  const key = process.env.PLATFORM_RSA_PRIVATE_KEY;
  if (!key) throw new Error('待接入：环境变量 PLATFORM_RSA_PRIVATE_KEY 未配置');
  return key;
}

/**
 * 批量生成卡密
 *
 * - count ≤ 100：同步生成并写入数据库
 * - count > 100：投递到 BullMQ 异步队列，返回 jobId
 */
export async function generateCards(params: GenerateCardsParams) {
  if (params.count <= 0) {
    throw new Error('待接入：生成数量必须大于 0');
  }

  // 异步批量生成
  if (params.count > SYNC_THRESHOLD) {
    const queue = createQueue(QueueName.CARD_GENERATION);
    const job = await queue.add('generate', params);
    return { sync: false, jobId: job.id };
  }

  // 同步生成
  const privateKey = getPlatformPrivateKey();
  const cards = [];

  for (let i = 0; i < params.count; i++) {
    const code = generateCardCode();
    const crc32 = code.replace(/-/g, '').slice(12);
    const signature = rsaSign(privateKey, code);
    const watermark = generateDeveloperWatermark(params.issuerId);

    cards.push({
      app_id: params.appId,
      template_id: params.templateId ?? null,
      issuer_id: params.issuerId,
      code,
      crc32_checksum: crc32,
      rsa_signature: signature,
      developer_watermark: watermark,
      status: 'unused',
      ...(params.type === 'count' && params.maxCount !== undefined
        ? { remaining_count: params.maxCount }
        : {}),
    });
  }

  await prisma.cardKey.createMany({ data: cards });
  return { sync: true, count: cards.length };
}

/**
 * 作废卡密（远程失效，SDK 下次心跳拒绝服务）
 */
export async function revokeCard(cardId: string): Promise<void> {
  await prisma.cardKey.update({
    where: { id: cardId },
    data: { status: 'disabled', revoked: true },
  });
}

/**
 * 将卡密加入黑名单池（被共享/破解的卡密自动入库，全局拦截）
 */
export async function addToBlacklist(cardId: string): Promise<void> {
  await prisma.cardKey.update({
    where: { id: cardId },
    data: { status: 'blacklisted', revoked: true },
  });
}

/**
 * 按卡密码查询卡密（含应用信息）
 */
export async function getCardByCode(code: string) {
  return prisma.cardKey.findUnique({
    where: { code },
    include: { app: true },
  });
}

/**
 * 按卡密 ID 查询
 */
export async function getCardById(cardId: string) {
  return prisma.cardKey.findUnique({
    where: { id: cardId },
    include: { app: true },
  });
}

/**
 * 列出卡密（开发者后台用，多条件过滤）
 *
 * 支持 appId / issuerId / status / templateId 过滤，include app，按 created_at desc。
 */
export async function listCards(options: {
  appId?: string;
  issuerId?: string;
  status?: string;
  templateId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ cards: Awaited<ReturnType<typeof prisma.cardKey.findMany>>; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const where: {
    app_id?: string;
    issuer_id?: string;
    status?: string;
    template_id?: string;
  } = {};
  if (options.appId) where.app_id = options.appId;
  if (options.issuerId) where.issuer_id = options.issuerId;
  if (options.status) where.status = options.status;
  if (options.templateId) where.template_id = options.templateId;

  const [cards, total] = await Promise.all([
    prisma.cardKey.findMany({
      where,
      include: { app: true },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.cardKey.count({ where }),
  ]);

  return { cards, total };
}

/**
 * 物理删除卡密（仅 unused 状态可删，其他状态抛错）
 */
export async function deleteCard(cardId: string): Promise<void> {
  const card = await prisma.cardKey.findUnique({
    where: { id: cardId },
    select: { status: true },
  });
  if (!card) {
    throw new Error('待接入：卡密不存在');
  }
  if (card.status !== 'unused') {
    throw new Error('待接入：仅未使用卡密可删除');
  }
  await prisma.cardKey.delete({ where: { id: cardId } });
}
