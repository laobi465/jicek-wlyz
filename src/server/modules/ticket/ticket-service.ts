import { prisma } from '@/lib/db';

/**
 * 工单服务（M6 运营能力）
 *
 * 业务规则：
 * - 任何登录用户均可提交工单（开发者/代理/超管）
 * - 工单状态机：open → in_progress → resolved → closed
 * - 工单类型：bug 缺陷 / feature 需求 / billing 计费 / other 其他
 * - 优先级：low 低 / medium 中 / high 高 / urgent 紧急
 * - 仅提交者本人或超管可查看/回复工单
 * - 客服（超管）回复时自动将状态置为 in_progress
 * - closed 状态工单不允许再回复
 *
 * 安全设计：
 * - 工单编号自动生成（TK + YYYYMMDD + 6位随机串）
 * - 内容长度限制（标题 100 / 内容 5000）
 * - 回复内容长度限制（2000）
 * - 权限校验：仅提交者或超管可操作
 */

/** 工单状态 */
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** 工单类型 */
export type TicketCategory = 'bug' | 'feature' | 'billing' | 'other';

/** 工单优先级 */
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

/** 标题最大长度 */
const MAX_TITLE_LENGTH = 100;
/** 工单内容最大长度 */
const MAX_CONTENT_LENGTH = 5000;
/** 回复内容最大长度 */
const MAX_REPLY_LENGTH = 2000;

/** 合法状态白名单 */
const VALID_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_CATEGORIES: TicketCategory[] = ['bug', 'feature', 'billing', 'other'];
const VALID_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

/**
 * 创建工单
 */
export async function createTicket(params: {
  submitterId: string;
  title: string;
  content: string;
  category?: TicketCategory;
  priority?: TicketPriority;
}) {
  const { submitterId, title, content } = params;

  // 校验标题
  if (!title || title.trim().length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new Error(`待接入：标题长度非法（1-${MAX_TITLE_LENGTH} 字符）`);
  }

  // 校验内容
  if (!content || content.trim().length === 0 || content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`待接入：内容长度非法（1-${MAX_CONTENT_LENGTH} 字符）`);
  }

  // 校验类型
  const category: TicketCategory = params.category ?? 'other';
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`待接入：工单类型非法，允许 ${VALID_CATEGORIES.join('/')}`);
  }

  // 校验优先级
  const priority: TicketPriority = params.priority ?? 'medium';
  if (!VALID_PRIORITIES.includes(priority)) {
    throw new Error(`待接入：优先级非法，允许 ${VALID_PRIORITIES.join('/')}`);
  }

  // 生成工单编号
  const ticketNo = await generateTicketNo();

  const ticket = await prisma.ticket.create({
    data: {
      ticket_no: ticketNo,
      submitter_id: submitterId,
      title: title.trim(),
      content: content.trim(),
      category,
      priority,
      status: 'open',
    },
  });

  return ticket;
}

/**
 * 生成工单编号：TK + YYYYMMDD + 6位随机串
 */
async function generateTicketNo(): Promise<string> {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  // 防碰撞：循环生成直至唯一
  for (let i = 0; i < 5; i++) {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    const ticketNo = `TK${ymd}${random}`;
    const exists = await prisma.ticket.findUnique({ where: { ticket_no: ticketNo }, select: { id: true } });
    if (!exists) {
      return ticketNo;
    }
  }
  throw new Error('待接入：工单编号生成失败，请重试');
}

/**
 * 列出工单
 *
 * - 普通用户仅能查看自己提交的工单
 * - 超管可查看全部工单（支持 submitterId 过滤）
 */
export async function listTickets(params: {
  userId: string;
  userRole: string;
  status?: TicketStatus;
  category?: TicketCategory;
  limit?: number;
  offset?: number;
}) {
  const { userId, userRole, limit = 20, offset = 0 } = params;

  // 校验分页参数
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('待接入：limit 参数非法（1-100）');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('待接入：offset 参数非法（非负整数）');
  }

  const where: {
    submitter_id?: string;
    status?: string;
    category?: string;
  } = {};

  // 非超管仅能看自己的工单
  if (userRole !== 'super_admin') {
    where.submitter_id = userId;
  }

  if (params.status) {
    if (!VALID_STATUSES.includes(params.status)) {
      throw new Error(`待接入：status 参数非法，允许 ${VALID_STATUSES.join('/')}`);
    }
    where.status = params.status;
  }

  if (params.category) {
    if (!VALID_CATEGORIES.includes(params.category)) {
      throw new Error(`待接入：category 参数非法，允许 ${VALID_CATEGORIES.join('/')}`);
    }
    where.category = params.category;
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.ticket.count({ where }),
  ]);

  return { tickets, total };
}

/**
 * 查询工单详情（含回复列表）
 */
export async function getTicketDetail(ticketId: string, userId: string, userRole: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      replies: {
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!ticket) {
    return null;
  }

  // 权限校验：仅提交者或超管可查看
  if (ticket.submitter_id !== userId && userRole !== 'super_admin') {
    return null;
  }

  return ticket;
}

/**
 * 回复工单
 *
 * - 客服（超管）回复时自动将状态置为 in_progress
 * - 提交者回复时若状态为 resolved 则重新置为 in_progress
 * - closed 状态不允许回复
 */
export async function replyTicket(params: {
  ticketId: string;
  userId: string;
  userRole: string;
  content: string;
}) {
  const { ticketId, userId, userRole, content } = params;

  // 校验回复内容
  if (!content || content.trim().length === 0 || content.length > MAX_REPLY_LENGTH) {
    throw new Error(`待接入：回复内容长度非法（1-${MAX_REPLY_LENGTH} 字符）`);
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, submitter_id: true, status: true },
  });

  if (!ticket) {
    throw new Error('待接入：工单不存在');
  }

  // 权限校验：仅提交者或超管可回复
  if (ticket.submitter_id !== userId && userRole !== 'super_admin') {
    throw new Error('待接入：无权操作他人工单');
  }

  // closed 状态不允许回复
  if (ticket.status === 'closed') {
    throw new Error('待接入：工单已关闭，无法回复');
  }

  const isStaff = userRole === 'super_admin';

  // 事务：写入回复 + 更新工单状态
  const [reply] = await prisma.$transaction([
    prisma.ticketReply.create({
      data: {
        ticket_id: ticketId,
        user_id: userId,
        content: content.trim(),
        is_staff: isStaff,
      },
    }),
    prisma.ticket.update({
      where: { id: ticketId },
      data: {
        // 客服回复 → in_progress；用户回复已解决工单 → 重新打开
        status: isStaff ? 'in_progress' : (ticket.status === 'resolved' ? 'in_progress' : ticket.status),
      },
    }),
  ]);

  return reply;
}

/**
 * 更新工单状态（关闭/解决）
 *
 * 仅超管或提交者本人可操作
 * - 超管：可将任意状态置为 resolved 或 closed
 * - 提交者：可将工单置为 closed（主动关闭）
 */
export async function updateTicketStatus(params: {
  ticketId: string;
  userId: string;
  userRole: string;
  status: TicketStatus;
}) {
  const { ticketId, userId, userRole, status } = params;

  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`待接入：status 参数非法，允许 ${VALID_STATUSES.join('/')}`);
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, submitter_id: true, status: true },
  });

  if (!ticket) {
    throw new Error('待接入：工单不存在');
  }

  // 权限校验
  if (ticket.submitter_id !== userId && userRole !== 'super_admin') {
    throw new Error('待接入：无权操作他人工单');
  }

  // 已 closed 不允许再变更
  if (ticket.status === 'closed') {
    throw new Error('待接入：工单已关闭，无法变更状态');
  }

  // 提交者仅可关闭（不可置为 resolved，resolved 由客服操作）
  if (userRole !== 'super_admin' && status === 'resolved') {
    throw new Error('待接入：仅客服可将工单标记为已解决');
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status,
      closed_at: status === 'closed' ? new Date() : null,
    },
  });

  return updated;
}
