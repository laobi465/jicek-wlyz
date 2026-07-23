import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { writeAuditLog, AuditAction } from '@/server/modules/audit/audit-service';

/**
 * 系统配置服务（M8.3 超管系统配置）
 *
 * 职责：
 * 1. 按分组查询系统配置（payment/storage/email/sms/cdn/backup/general）
 * 2. 按 key 查询单条配置
 * 3. 更新配置值（写审计日志）
 *
 * 业务规则（PROJECT.md §4.2）：
 * - 易支付商户号、对象存储、邮件 SMTP、短信、CDN、备份周期均由超管后台配置
 * - 配置存于 SystemConfig 表，敏感配置（如密钥）encrypted=true
 * - 与 epay-service.getEpayConfig() 读取同一张表，确保配置一处管理
 *
 * 安全设计：
 * - 更新操作写审计日志（AuditAction.CONFIG_UPDATE）
 * - encrypted=true 的配置（如 epay_key）写入前用 MASTER_KEY 派生 AES-256-CBC
 *   加密，存储格式 ivHex:cipherBase64（与 app-service.encryptSecret 一致），
 *   读取时由 epay-service.decryptEpayKey 解密
 * - 配置值统一以字符串存储（SystemConfig.value @db.Text）
 */

/**
 * 用 MASTER_KEY 加密敏感配置值
 *
 * 格式：ivHex:cipherBase64（与 app-service.encryptSecret / card-key-service 一致）
 * 经 SHA-256 派生 AES-256 密钥，与 epay-service.decryptEpayKey 解密逻辑对称
 */
function encryptConfigValue(plaintext: string): string {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) {
    throw new Error('待接入：环境变量 MASTER_KEY 未配置（用于加密敏感配置）');
  }
  const key = crypto.createHash('sha256').update(masterKey).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('base64')}`;
}

/** 配置分组枚举 */
export const CONFIG_GROUPS = [
  'payment',
  'storage',
  'email',
  'sms',
  'cdn',
  'backup',
  'general',
] as const;
export type ConfigGroup = (typeof CONFIG_GROUPS)[number];

/** 系统配置视图 */
export interface SystemConfigView {
  id: string;
  key: string;
  value: string;
  group: string;
  description: string | null;
  encrypted: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * 按分组查询系统配置列表
 *
 * @param group 配置分组，不传则返回全部
 */
export async function listSystemConfigs(
  group?: string,
): Promise<SystemConfigView[]> {
  const configs = await prisma.systemConfig.findMany({
    where: group ? { group } : undefined,
    orderBy: [{ group: 'asc' }, { key: 'asc' }],
  });
  return configs as SystemConfigView[];
}

/**
 * 按 key 查询单条配置
 */
export async function getSystemConfig(
  key: string,
): Promise<SystemConfigView | null> {
  const config = await prisma.systemConfig.findUnique({
    where: { key },
  });
  return config as SystemConfigView | null;
}

/**
 * 已知的敏感配置元信息（key → 加密标记 + 分组 + 描述）
 *
 * 用于 upsert 首次创建时设置 group/encrypted/description 元信息。
 * 非敏感配置（如 epay_pid / epay_api_url）encrypted=false 明文存储。
 *
 * 注意：仅 epay_key 走加密通道，pid 和 api_url 是非敏感的连接参数，
 * 明文存储便于排查（epay-service.getEpayConfig 也不解密这两项）。
 */
const CONFIG_META: Record<string, { group: string; encrypted: boolean; description: string }> = {
  epay_pid: { group: 'payment', encrypted: false, description: '彩虹易支付商户 ID' },
  epay_key: { group: 'payment', encrypted: true, description: '彩虹易支付商户密钥（加密存储）' },
  epay_api_url: { group: 'payment', encrypted: false, description: '彩虹易支付接口地址（如 https://pay.example.com）' },
};

/**
 * 更新或创建配置值（仅超管）
 *
 * 使用 upsert：配置行已存在则更新，不存在则按 CONFIG_META 元信息创建。
 * 这样超管首次配置易支付时无需先在数据库手动插行，直接在 /admin/config
 * 页面编辑保存即可生效。
 *
 * 加密处理：
 * - encrypted=true 的配置（如 epay_key）：写入前用 MASTER_KEY AES 加密，
 *   存储格式 ivHex:cipherBase64，与 epay-service.decryptEpayKey 对称
 * - encrypted=false 的配置（如 epay_pid / epay_api_url）：明文存储
 *
 * @param key 配置键
 * @param value 新配置值（明文，超管在后台输入）
 * @param operatorId 操作者（超管）ID，用于审计日志
 * @returns 更新后的配置（加密配置返回的 value 是密文，前端展示时已掩码）
 */
export async function updateSystemConfig(
  key: string,
  value: string,
  operatorId: string,
): Promise<SystemConfigView> {
  const meta = CONFIG_META[key];
  const isEncrypted = meta?.encrypted ?? false;
  const storedValue = isEncrypted ? encryptConfigValue(value) : value;

  const updated = await prisma.systemConfig.upsert({
    where: { key },
    update: { value: storedValue },
    create: {
      key,
      value: storedValue,
      group: meta?.group ?? 'general',
      encrypted: isEncrypted,
      description: meta?.description ?? null,
    },
  });

  await writeAuditLog({
    userId: operatorId,
    action: AuditAction.CONFIG_UPDATE,
    targetType: 'system_config',
    targetId: key,
    details: { key, encrypted: isEncrypted },
  });

  return updated as SystemConfigView;
}
