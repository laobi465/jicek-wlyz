import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeAuditLog, AuditAction } from '@/server/modules/audit/audit-service';

/**
 * 用户管理服务（M8.3 超管用户管理）
 *
 * 职责：
 * 1. 全平台用户列表（超管视角，支持 role/status/keyword 筛选）
 * 2. 用户详情查询
 * 3. 用户状态变更（active/banned/pending，写审计日志）
 * 4. 用户角色变更（super_admin/agent/developer，写审计日志）
 *
 * 安全设计：
 * - 列表/详情查询排除 password_hash / two_factor_secret 等敏感字段
 * - 状态/角色变更写审计日志（AuditAction.USER_STATUS_CHANGE / USER_ROLE_CHANGE）
 * - Decimal 字段（balance）由 Prisma 序列化为 string，前端 Number() 转换
 */

/** 用户角色枚举 */
export const USER_ROLES = ['super_admin', 'agent', 'developer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 用户状态枚举 */
export const USER_STATUSES = ['active', 'banned', 'pending'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** 列表/详情返回的用户字段（排除敏感字段） */
export interface AdminUserView {
  id: string;
  email: string;
  nickname: string | null;
  role: string;
  status: string;
  agent_level: number | null;
  parent_agent_id: string | null;
  two_factor_enabled: boolean;
  /** Decimal 字段，JSON 序列化为 string，前端 Number() 转换 */
  balance: Prisma.Decimal;
  created_at: Date;
  last_login_at: Date | null;
}

/** 列表查询选项 */
export interface ListUsersOptions {
  role?: string;
  status?: string;
  /** 关键词：邮箱或昵称模糊匹配 */
  keyword?: string;
  limit?: number;
  offset?: number;
}

/**
 * 全平台用户列表（仅超管）
 */
export async function listUsers(
  options: ListUsersOptions,
): Promise<{ users: AdminUserView[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const where: {
    role?: string;
    status?: string;
    OR?: Array<{ email?: { contains: string; mode: 'insensitive' }; nickname?: { contains: string; mode: 'insensitive' } }>;
  } = {};
  if (options.role) where.role = options.role;
  if (options.status) where.status = options.status;
  if (options.keyword && options.keyword.trim()) {
    const kw = options.keyword.trim();
    where.OR = [
      { email: { contains: kw, mode: 'insensitive' } },
      { nickname: { contains: kw, mode: 'insensitive' } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        nickname: true,
        role: true,
        status: true,
        agent_level: true,
        parent_agent_id: true,
        two_factor_enabled: true,
        balance: true,
        created_at: true,
        last_login_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.user.count({ where }),
  ]);

  return { users: users as AdminUserView[], total };
}

/**
 * 按 ID 查询用户详情（仅超管）
 */
export async function getUserById(userId: string): Promise<AdminUserView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      nickname: true,
      role: true,
      status: true,
      agent_level: true,
      parent_agent_id: true,
      two_factor_enabled: true,
      balance: true,
      created_at: true,
      last_login_at: true,
    },
  });
  return user as AdminUserView | null;
}

/**
 * 变更用户状态（仅超管）
 *
 * @param userId 目标用户 ID
 * @param status 新状态：active / banned / pending
 * @param operatorId 操作者（超管）ID，用于审计日志
 */
export async function updateUserStatus(
  userId: string,
  status: UserStatus,
  operatorId: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { status },
  });

  await writeAuditLog({
    userId: operatorId,
    action: AuditAction.USER_STATUS_CHANGE,
    targetType: 'user',
    targetId: userId,
    details: { newStatus: status },
  });
}

/**
 * 变更用户角色（仅超管）
 *
 * @param userId 目标用户 ID
 * @param role 新角色：super_admin / agent / developer
 * @param operatorId 操作者（超管）ID，用于审计日志
 */
export async function updateUserRole(
  userId: string,
  role: UserRole,
  operatorId: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { role },
  });

  await writeAuditLog({
    userId: operatorId,
    action: AuditAction.USER_ROLE_CHANGE,
    targetType: 'user',
    targetId: userId,
    details: { newRole: role },
  });
}
