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
 * 确保所有预定义配置项存在（首次访问自动补建空值行，幂等）
 *
 * 超管打开 /admin/config 页面时自动调用：若数据库中配置项总数小于
 * CONFIG_META 预定义数量，则逐项检查并补建缺失的空值行。
 * 这样超管无需手动点"初始化默认配置"按钮，一进来就能看到全部 32 项
 * 配置并直接编辑。
 *
 * 不写审计日志（自动行为，非用户操作）；已存在的不覆盖。
 */
async function ensureDefaultConfigsExist(): Promise<void> {
  const totalKeys = Object.keys(CONFIG_META).length;
  const existingCount = await prisma.systemConfig.count();
  if (existingCount >= totalKeys) {
    return; // 配置项已齐全，无需补建
  }
  for (const [key, meta] of Object.entries(CONFIG_META)) {
    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    if (existing) continue;
    await prisma.systemConfig.create({
      data: {
        key,
        value: '',
        group: meta.group,
        encrypted: meta.encrypted,
        description: meta.description,
      },
    });
  }
}

/**
 * 按分组查询系统配置列表
 *
 * 查询前自动补建缺失的预定义配置项（确保超管一打开页面就能看到
 * 全部 7 分组 32 项配置并直接编辑，无需手动初始化）。
 *
 * @param group 配置分组，不传则返回全部
 */
export async function listSystemConfigs(
  group?: string,
): Promise<SystemConfigView[]> {
  await ensureDefaultConfigsExist();
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
 * 已知的配置项元信息（key → 分组 + 加密标记 + 描述）
 *
 * 覆盖全部 7 个分组：payment / storage / email / sms / cdn / backup / general。
 * 用于 upsert 首次创建时设置 group/encrypted/description 元信息。
 * 非敏感配置（如 host / port / bucket）encrypted=false 明文存储，
 * 敏感配置（如密码 / SecretKey）encrypted=true 加密存储。
 *
 * 超管在 /admin/config 页面可通过"初始化默认配置"一键创建全部预定义项，
 * 或通过"新增配置"手动输入 key（会自动匹配元信息归类）。
 */
const CONFIG_META: Record<string, { group: string; encrypted: boolean; description: string }> = {
  // ===== payment 分组：彩虹易支付 =====
  epay_pid: { group: 'payment', encrypted: false, description: '彩虹易支付商户 ID' },
  epay_key: { group: 'payment', encrypted: true, description: '彩虹易支付商户密钥（加密存储）' },
  epay_api_url: { group: 'payment', encrypted: false, description: '彩虹易支付接口地址（如 https://pay.example.com）' },

  // ===== storage 分组：对象存储 =====
  storage_provider: { group: 'storage', encrypted: false, description: '对象存储服务商（aliyun_oss / tencent_cos / qiniu_kodo）' },
  storage_access_key: { group: 'storage', encrypted: false, description: '对象存储 AccessKey' },
  storage_secret_key: { group: 'storage', encrypted: true, description: '对象存储 SecretKey（加密存储）' },
  storage_bucket: { group: 'storage', encrypted: false, description: '对象存储桶名' },
  storage_region: { group: 'storage', encrypted: false, description: '对象存储区域（如 oss-cn-hangzhou）' },
  storage_endpoint: { group: 'storage', encrypted: false, description: '对象存储自定义端点（可选）' },
  storage_cdn_domain: { group: 'storage', encrypted: false, description: '对象存储 CDN 域名（可选）' },

  // ===== email 分组：SMTP 邮件 =====
  smtp_host: { group: 'email', encrypted: false, description: 'SMTP 服务器地址（如 smtp.qq.com）' },
  smtp_port: { group: 'email', encrypted: false, description: 'SMTP 端口（465 SSL / 587 TLS / 25 明文）' },
  smtp_user: { group: 'email', encrypted: false, description: 'SMTP 用户名（邮箱地址）' },
  smtp_pass: { group: 'email', encrypted: true, description: 'SMTP 密码或授权码（加密存储）' },
  smtp_from: { group: 'email', encrypted: false, description: '发件人地址（如 noreply@example.com）' },
  smtp_secure: { group: 'email', encrypted: false, description: '是否启用 SSL/TLS（true / false）' },

  // ===== sms 分组：短信服务 =====
  sms_provider: { group: 'sms', encrypted: false, description: '短信服务商（aliyun / tencent）' },
  sms_access_key: { group: 'sms', encrypted: false, description: '短信服务 AccessKey' },
  sms_secret_key: { group: 'sms', encrypted: true, description: '短信服务 SecretKey（加密存储）' },
  sms_sign_name: { group: 'sms', encrypted: false, description: '短信签名名称' },
  sms_template_code: { group: 'sms', encrypted: false, description: '短信模板代码' },

  // ===== cdn 分组：CDN 加速 =====
  cdn_domain: { group: 'cdn', encrypted: false, description: 'CDN 加速域名（如 https://cdn.example.com）' },
  cdn_access_key: { group: 'cdn', encrypted: false, description: 'CDN 服务 AccessKey' },
  cdn_secret_key: { group: 'cdn', encrypted: true, description: 'CDN 服务 SecretKey（加密存储）' },

  // ===== backup 分组：数据库备份 =====
  backup_schedule: { group: 'backup', encrypted: false, description: '备份周期（cron 表达式，如 0 3 * * * 每天凌晨 3 点）' },
  backup_retention_days: { group: 'backup', encrypted: false, description: '备份保留天数（如 30）' },
  backup_storage_type: { group: 'backup', encrypted: false, description: '备份存储位置（local / oss）' },
  backup_path: { group: 'backup', encrypted: false, description: '本地备份目录（如 /opt/jicek-wlyz/backups）' },

  // ===== general 分组：通用站点配置 =====
  site_name: { group: 'general', encrypted: false, description: '站点名称' },
  site_url: { group: 'general', encrypted: false, description: '站点访问地址（如 https://example.com）' },
  site_icp: { group: 'general', encrypted: false, description: 'ICP 备案号（可选）' },
  site_contact_email: { group: 'general', encrypted: false, description: '站点联系邮箱' },
};

/**
 * 初始化所有预定义配置项（空值）
 *
 * 超管在 /admin/config 页面点"初始化默认配置"按钮调用此函数，
 * 为 CONFIG_META 中所有预定义项创建空值行（已存在的不覆盖）。
 * 创建后超管只需逐项编辑填入实际值即可。
 *
 * @param operatorId 操作者（超管）ID，用于审计日志
 * @returns 新创建的配置项数量
 */
export async function initializeDefaultConfigs(operatorId: string): Promise<number> {
  let created = 0;
  for (const [key, meta] of Object.entries(CONFIG_META)) {
    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    if (existing) {
      continue;
    }
    await prisma.systemConfig.create({
      data: {
        key,
        value: '',
        group: meta.group,
        encrypted: meta.encrypted,
        description: meta.description,
      },
    });
    created++;
  }

  if (created > 0) {
    await writeAuditLog({
      userId: operatorId,
      action: AuditAction.CONFIG_UPDATE,
      targetType: 'system_config',
      targetId: 'batch_init',
      details: { action: 'initialize', count: created },
    });
  }

  return created;
}

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
