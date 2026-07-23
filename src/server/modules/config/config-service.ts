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
 * - 配置值统一以 JSON 字符串存储（SystemConfig.value @db.Text）
 */

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
 * 更新配置值（仅超管）
 *
 * @param key 配置键
 * @param value 新配置值（JSON 字符串）
 * @param operatorId 操作者（超管）ID，用于审计日志
 * @returns 更新后的配置
 */
export async function updateSystemConfig(
  key: string,
  value: string,
  operatorId: string,
): Promise<SystemConfigView> {
  const updated = await prisma.systemConfig.update({
    where: { key },
    data: { value },
  });

  await writeAuditLog({
    userId: operatorId,
    action: AuditAction.CONFIG_UPDATE,
    targetType: 'system_config',
    targetId: key,
    details: { key },
  });

  return updated as SystemConfigView;
}
