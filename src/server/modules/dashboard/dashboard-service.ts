import { prisma } from '@/lib/db';

/**
 * 数据看板服务（M6 运营能力）
 *
 * 按角色返回不同维度的统计数据：
 *
 * 【开发者 dashboard】
 * - 应用总数 / 卡密总数 / 设备总数
 * - 今日新增设备 / 在线设备数
 * - 工单统计（待处理 / 已解决）
 * - 未读通知数
 * - 今日签到状态
 *
 * 【代理 dashboard】
 * - 下级代理数 / 邀请码统计
 * - 佣金余额 / 累计佣金
 * - 提现统计（pending / 已打款）
 * - 未读通知数
 * - 今日签到状态
 *
 * 【超管 dashboard】
 * - 全平台用户数 / 开发者数 / 代理数
 * - 应用总数 / 卡密总数 / 订单总数
 * - 收入统计（今日 / 本月）
 * - 工单统计（待处理 / 处理中 / 已解决 / 已关闭）
 * - 提现审核统计（pending 金额）
 * - APK 注入任务统计
 *
 * 安全设计：
 * - 严格按角色返回数据，开发者无法看到他人数据
 * - 统计查询使用 prisma count/aggregate，避免全表扫描
 */

/** 通用统计响应 */
export interface DashboardData {
  role: string;
  [key: string]: unknown;
}

/**
 * 获取开发者看板数据
 */
async function getDeveloperDashboard(userId: string): Promise<DashboardData> {
  // 当前用户的应用 IDs（用于卡密/设备统计过滤）
  const apps = await prisma.app.findMany({
    where: { developer_id: userId },
    select: { id: true },
  });
  const appIds = apps.map((a) => a.id);
  const appCount = appIds.length;

  // 并行查询各项统计
  const [
    cardCount,
    deviceCount,
    todayNewDevices,
    onlineDevices,
    pendingTickets,
    resolvedTickets,
    unreadNotifications,
    todayCheckin,
  ] = await Promise.all([
    // 卡密总数
    prisma.cardKey.count({ where: { app_id: { in: appIds } } }),
    // 设备总数
    prisma.device.count({ where: { app_id: { in: appIds } } }),
    // 今日新增设备
    prisma.device.count({
      where: {
        app_id: { in: appIds },
        created_at: { gte: startOfToday() },
      },
    }),
    // 在线设备数
    prisma.device.count({
      where: {
        app_id: { in: appIds },
        status: 'online',
      },
    }),
    // 待处理工单数
    prisma.ticket.count({
      where: {
        submitter_id: userId,
        status: { in: ['open', 'in_progress'] },
      },
    }),
    // 已解决工单数
    prisma.ticket.count({
      where: {
        submitter_id: userId,
        status: { in: ['resolved', 'closed'] },
      },
    }),
    // 未读通知数
    prisma.notification.count({
      where: { user_id: userId, is_read: false },
    }),
    // 今日签到状态
    prisma.checkIn.findUnique({
      where: {
        user_id_checkin_date: {
          user_id: userId,
          checkin_date: startOfTodayUtcDate(),
        },
      },
      select: { id: true, continuous_days: true, reward_amount: true },
    }),
  ]);

  return {
    role: 'developer',
    apps: { total: appCount },
    cards: { total: cardCount },
    devices: {
      total: deviceCount,
      todayNew: todayNewDevices,
      online: onlineDevices,
    },
    tickets: {
      pending: pendingTickets,
      resolved: resolvedTickets,
    },
    notifications: { unread: unreadNotifications },
    checkin: {
      checkedInToday: !!todayCheckin,
      continuousDays: todayCheckin?.continuous_days ?? 0,
      rewardAmount: todayCheckin?.reward_amount?.toString() ?? '0',
    },
  };
}

/**
 * 获取代理看板数据
 */
async function getAgentDashboard(userId: string): Promise<DashboardData> {
  // 查询代理档案
  const agentProfile = await prisma.agent.findUnique({
    where: { user_id: userId },
    select: {
      id: true,
      total_commission: true,
      withdrawn_amount: true,
      level: true,
    },
  });

  // 下级代理：parent_agent_id = userId
  const subAgentsCount = await prisma.user.count({
    where: { parent_agent_id: userId, role: 'agent' },
  });

  // 邀请码统计
  const [invitationGenerated, invitationUsed] = await Promise.all([
    prisma.invitationCode.count({
      where: { generator_id: userId },
    }),
    prisma.invitationCode.count({
      where: { generator_id: userId, user_id: { not: null } },
    }),
  ]);

  // 提现统计
  const [pendingWithdrawals, paidWithdrawalsCount] = await Promise.all([
    prisma.withdrawal.count({
      where: { agent_id: userId, status: 'pending' },
    }),
    prisma.withdrawal.count({
      where: { agent_id: userId, status: 'paid' },
    }),
  ]);

  // 未读通知 + 今日签到
  const [unreadNotifications, todayCheckin] = await Promise.all([
    prisma.notification.count({
      where: { user_id: userId, is_read: false },
    }),
    prisma.checkIn.findUnique({
      where: {
        user_id_checkin_date: {
          user_id: userId,
          checkin_date: startOfTodayUtcDate(),
        },
      },
      select: { id: true, continuous_days: true, reward_amount: true },
    }),
  ]);

  return {
    role: 'agent',
    agent: agentProfile
      ? {
          level: agentProfile.level,
          totalCommission: agentProfile.total_commission.toString(),
          withdrawnAmount: agentProfile.withdrawn_amount.toString(),
          availableBalance: agentProfile.total_commission
            .minus(agentProfile.withdrawn_amount)
            .toString(),
        }
      : null,
    subAgents: { count: subAgentsCount },
    invitations: {
      generated: invitationGenerated,
      used: invitationUsed,
    },
    withdrawals: {
      pending: pendingWithdrawals,
      paid: paidWithdrawalsCount,
    },
    notifications: { unread: unreadNotifications },
    checkin: {
      checkedInToday: !!todayCheckin,
      continuousDays: todayCheckin?.continuous_days ?? 0,
      rewardAmount: todayCheckin?.reward_amount?.toString() ?? '0',
    },
  };
}

/**
 * 获取超管看板数据
 */
async function getSuperAdminDashboard(): Promise<DashboardData> {
  // 用户统计
  const [totalUsers, developerCount, agentCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'developer' } }),
    prisma.user.count({ where: { role: 'agent' } }),
  ]);

  // 业务统计
  const [appCount, cardCount, orderCount] = await Promise.all([
    prisma.app.count(),
    prisma.cardKey.count(),
    prisma.order.count(),
  ]);

  // 收入统计
  const now = new Date();
  const startOfTodayDate = startOfToday();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [todayPayments, monthPayments] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        status: 'success',
        created_at: { gte: startOfTodayDate },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        status: 'success',
        created_at: { gte: startOfMonth },
      },
      _sum: { amount: true },
    }),
  ]);

  // 工单统计
  const [openTickets, inProgressTickets, resolvedTickets, closedTickets] = await Promise.all([
    prisma.ticket.count({ where: { status: 'open' } }),
    prisma.ticket.count({ where: { status: 'in_progress' } }),
    prisma.ticket.count({ where: { status: 'resolved' } }),
    prisma.ticket.count({ where: { status: 'closed' } }),
  ]);

  // 提现审核统计
  const pendingWithdrawals = await prisma.withdrawal.aggregate({
    where: { status: 'pending' },
    _sum: { amount: true },
    _count: true,
  });

  // APK 注入任务统计
  const [apkPending, apkProcessing, apkSuccess, apkFailed] = await Promise.all([
    prisma.apkInjectionTask.count({ where: { status: 'pending' } }),
    prisma.apkInjectionTask.count({ where: { status: 'processing' } }),
    prisma.apkInjectionTask.count({ where: { status: 'success' } }),
    prisma.apkInjectionTask.count({ where: { status: 'failed' } }),
  ]);

  return {
    role: 'super_admin',
    users: {
      total: totalUsers,
      developers: developerCount,
      agents: agentCount,
    },
    business: {
      apps: appCount,
      cards: cardCount,
      orders: orderCount,
    },
    revenue: {
      today: todayPayments._sum.amount?.toString() ?? '0',
      thisMonth: monthPayments._sum.amount?.toString() ?? '0',
    },
    tickets: {
      open: openTickets,
      inProgress: inProgressTickets,
      resolved: resolvedTickets,
      closed: closedTickets,
    },
    withdrawals: {
      pendingCount: pendingWithdrawals._count,
      pendingAmount: pendingWithdrawals._sum.amount?.toString() ?? '0',
    },
    apkInjection: {
      pending: apkPending,
      processing: apkProcessing,
      success: apkSuccess,
      failed: apkFailed,
    },
  };
}

/**
 * 获取看板数据（按角色分发）
 */
export async function getDashboardData(
  userId: string,
  userRole: string,
): Promise<DashboardData> {
  switch (userRole) {
    case 'developer':
      return getDeveloperDashboard(userId);
    case 'agent':
      return getAgentDashboard(userId);
    case 'super_admin':
      return getSuperAdminDashboard();
    default:
      throw new Error(`待接入：未知用户角色 ${userRole}`);
  }
}

// ---------------------------------------------------------------------------
// 时间工具
// ---------------------------------------------------------------------------

/** 今日 0 点（UTC+8）对应的 Date（用于 created_at >= 过滤） */
function startOfToday(): Date {
  const now = new Date();
  const utc8Ms = now.getTime() + 8 * 60 * 60 * 1000;
  const utc8Date = new Date(utc8Ms);
  const y = utc8Date.getUTCFullYear();
  const m = utc8Date.getUTCMonth();
  const d = utc8Date.getUTCDate();
  // UTC+8 当日 0 点对应的 UTC 时间（减 8 小时）
  return new Date(Date.UTC(y, m, d) - 8 * 60 * 60 * 1000);
}

/** 今日日期（UTC+8），仅日期部分，用于 CheckIn 唯一约束查询 */
function startOfTodayUtcDate(): Date {
  const now = new Date();
  const utc8Ms = now.getTime() + 8 * 60 * 60 * 1000;
  const utc8Date = new Date(utc8Ms);
  const y = utc8Date.getUTCFullYear();
  const m = utc8Date.getUTCMonth();
  const d = utc8Date.getUTCDate();
  return new Date(Date.UTC(y, m, d));
}
