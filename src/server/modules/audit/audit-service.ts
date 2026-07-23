import { prisma } from '@/lib/db';

/**
 * 统一审计日志服务（M7 安全加固 - §2.6.4 第 12 项）
 *
 * 职责：
 * - 提供统一的审计日志写入接口，替代各模块内联写入
 * - 记录所有敏感操作：用户/卡密/代理/提现/配置/更新/工单/APK 注入
 * - 支持查询审计日志（超管后台）
 * - 异常告警（待接入）
 *
 * 安全设计：
 * - 审计日志不可篡改（仅追加，不提供更新/删除接口）
 * - details 字段自动脱敏（密码/密钥/token 不入库）
 * - IP 和 User-Agent 自动采集
 */

/** 审计操作类型枚举（常用） */
export const AuditAction = {
  // 用户相关
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_REGISTER: 'user_register',
  USER_PASSWORD_CHANGE: 'user_password_change',
  USER_STATUS_CHANGE: 'user_status_change',
  USER_ROLE_CHANGE: 'user_role_change',
  // 卡密相关
  CARD_GENERATE: 'card_generate',
  CARD_REVOKE: 'card_revoke',
  CARD_DISABLE: 'card_disable',
  // 代理相关
  AGENT_APPROVE: 'agent_approve',
  AGENT_REJECT: 'agent_reject',
  AGENT_FREEZE: 'agent_freeze',
  AGENT_COMMISSION_ADJUST: 'agent_commission_adjust',
  // 提现相关
  WITHDRAWAL_REQUEST: 'withdrawal_request',
  WITHDRAWAL_APPROVE: 'withdrawal_approve',
  WITHDRAWAL_REJECT: 'withdrawal_reject',
  WITHDRAWAL_PAID: 'withdrawal_paid',
  // 配置相关
  CONFIG_UPDATE: 'config_update',
  APP_UPDATE: 'app_update',
  CLOUD_VARIABLE_UPDATE: 'cloud_variable_update',
  // APK 注入
  APK_INJECTION_CREATE: 'apk_injection_create',
  APK_INJECTION_CANCEL: 'apk_injection_cancel',
  // 系统更新
  UPDATE_TRIGGER: 'update_trigger',
  UPDATE_ROLLBACK: 'update_rollback',
  // 2FA
  TWO_FACTOR_ENABLE: 'two_factor_enable',
  TWO_FACTOR_DISABLE: 'two_factor_disable',
  TWO_FACTOR_VERIFY: 'two_factor_verify',
  // 工单
  TICKET_CREATE: 'ticket_create',
  TICKET_REPLY: 'ticket_reply',
  TICKET_CLOSE: 'ticket_close',
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

/** 需要脱敏的字段名（匹配则替换为 ***） */
const SENSITIVE_FIELDS = [
  'password',
  'password_hash',
  'client_secret',
  'rsa_private_key',
  'token',
  'access_token',
  'refresh_token',
  'two_factor_secret',
  'keystore_password',
  'key_password',
];

/**
 * 脱敏处理：递归将敏感字段值替换为 ***
 */
function sanitizeDetails(details: unknown): unknown {
  if (details === null || details === undefined) {
    return details;
  }
  if (typeof details === 'string') {
    return details;
  }
  if (Array.isArray(details)) {
    return details.map(sanitizeDetails);
  }
  if (typeof details === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f))) {
        result[key] = '***';
      } else {
        result[key] = sanitizeDetails(value);
      }
    }
    return result;
  }
  return details;
}

/**
 * 写入审计日志
 *
 * @param params 入参
 * - userId: 操作者 ID（可为 null，如匿名访问）
 * - action: 操作类型（AuditAction 枚举或自定义字符串）
 * - targetType: 目标资源类型（user/card/withdrawal/app/...）
 * - targetId: 目标资源 ID（可选）
 * - details: 操作详情（自动脱敏）
 * - ipAddress: IP 地址（可选）
 * - userAgent: User-Agent（可选）
 */
export async function writeAuditLog(params: {
  userId?: string | null;
  action: AuditActionType | string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const sanitized = params.details ? sanitizeDetails(params.details) : null;

  try {
    await prisma.auditLog.create({
      data: {
        user_id: params.userId ?? null,
        action: params.action,
        target_type: params.targetType,
        target_id: params.targetId ?? null,
        details: sanitized ? JSON.stringify(sanitized) : null,
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
      },
    });
  } catch (err) {
    // 审计日志写入失败不阻断主流程，仅记录错误
    console.error('[audit] 审计日志写入失败:', err);
  }
}

/**
 * 查询审计日志（超管后台）
 *
 * 支持按操作者、操作类型、目标类型、时间范围过滤
 */
export async function listAuditLogs(params: {
  userId?: string;
  action?: string;
  targetType?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}) {
  const { limit = 50, offset = 0 } = params;

  // 校验分页参数
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('待接入：limit 参数非法（1-200）');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('待接入：offset 参数非法（非负整数）');
  }

  const where: {
    user_id?: string;
    action?: string;
    target_type?: string;
    created_at?: { gte?: Date; lte?: Date };
  } = {};

  if (params.userId) where.user_id = params.userId;
  if (params.action) where.action = params.action;
  if (params.targetType) where.target_type = params.targetType;
  if (params.startTime || params.endTime) {
    where.created_at = {};
    if (params.startTime) where.created_at.gte = params.startTime;
    if (params.endTime) where.created_at.lte = params.endTime;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}
