import { prisma } from '@/lib/db';

/**
 * 通知服务（M6 运营能力 - 站内信）
 *
 * 业务规则：
 * - 通知类型：ticket 工单 / payment 支付 / withdrawal 提现 / system 系统 / apk APK 注入 / agent 代理
 * - 每个用户拥有独立通知列表
 * - 未读通知可统计数量（用于导航栏红点）
 * - 支持单条/全部标记已读
 *
 * 安全设计：
 * - 用户仅能查看/操作自己的通知
 * - 通知内容由系统内部生成，不接收外部用户输入
 * - 标题长度限制 100，内容长度限制 500
 */

/** 通知类型 */
export type NotificationType =
  | 'ticket'
  | 'payment'
  | 'withdrawal'
  | 'system'
  | 'apk'
  | 'agent';

/** 合法通知类型白名单 */
const VALID_TYPES: NotificationType[] = [
  'ticket',
  'payment',
  'withdrawal',
  'system',
  'apk',
  'agent',
];

/** 标题最大长度 */
const MAX_TITLE_LENGTH = 100;
/** 内容最大长度 */
const MAX_CONTENT_LENGTH = 500;

/**
 * 发送通知（内部调用，不暴露 API）
 *
 * 供其他模块调用：工单回复、支付成功、提现审核、APK 注入完成等
 */
export async function sendNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  relatedId?: string;
  relatedType?: string;
}) {
  const { userId, type, title, content } = params;

  // 校验类型
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`待接入：通知类型非法，允许 ${VALID_TYPES.join('/')}`);
  }

  // 校验标题
  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new Error(`待接入：通知标题长度非法（1-${MAX_TITLE_LENGTH} 字符）`);
  }

  // 校验内容
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`待接入：通知内容长度非法（1-${MAX_CONTENT_LENGTH} 字符）`);
  }

  const notification = await prisma.notification.create({
    data: {
      user_id: userId,
      type,
      title,
      content,
      related_id: params.relatedId ?? null,
      related_type: params.relatedType ?? null,
      is_read: false,
    },
  });

  return notification;
}

/**
 * 列出当前用户的通知
 *
 * - 默认按创建时间倒序
 * - 支持按 is_read 过滤
 * - 仅能查看自己的通知
 */
export async function listNotifications(params: {
  userId: string;
  isRead?: boolean;
  limit?: number;
  offset?: number;
}) {
  const { userId, limit = 20, offset = 0 } = params;

  // 校验分页参数
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('待接入：limit 参数非法（1-100）');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('待接入：offset 参数非法（非负整数）');
  }

  const where: { user_id: string; is_read?: boolean } = { user_id: userId };
  if (params.isRead !== undefined) {
    where.is_read = params.isRead;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total };
}

/**
 * 统计未读通知数量
 */
export async function countUnreadNotifications(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      user_id: userId,
      is_read: false,
    },
  });
}

/**
 * 标记单条通知为已读
 */
export async function markNotificationAsRead(
  notificationId: string,
  userId: string,
) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, user_id: true, is_read: true },
  });

  if (!notification) {
    throw new Error('待接入：通知不存在');
  }

  // 权限校验：仅能操作自己的通知
  if (notification.user_id !== userId) {
    throw new Error('待接入：无权操作他人通知');
  }

  // 已读则幂等返回
  if (notification.is_read) {
    return notification;
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      is_read: true,
      read_at: new Date(),
    },
  });

  return updated;
}

/**
 * 标记当前用户全部通知为已读
 */
export async function markAllNotificationsAsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      user_id: userId,
      is_read: false,
    },
    data: {
      is_read: true,
      read_at: new Date(),
    },
  });

  return result.count;
}
