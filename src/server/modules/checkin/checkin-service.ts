import { prisma } from '@/lib/db';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * 签到服务（M6 运营能力 - 每日签到 + 连续签到奖励）
 *
 * 业务规则：
 * - 每日可签到一次（UTC+8 当日 00:00-23:59）
 * - 连续签到奖励规则：
 *   - 第 1 天：0.10 元
 *   - 第 2 天：0.15 元
 *   - 第 3 天：0.20 元
 *   - 第 4 天：0.25 元
 *   - 第 5 天：0.30 元
 *   - 第 6 天：0.35 元
 *   - 第 7 天及以上：0.50 元（封顶）
 * - 断签后连续天数重置为 1
 * - 奖励金额直接入账 balance（事务：签到记录 + 余额增加）
 *
 * 安全设计：
 * - 数据库唯一约束 (user_id, checkin_date) 防重复签到
 * - 事务保证签到记录与余额更新原子性
 * - 日期计算使用 UTC+8 时区
 */

/**
 * 根据连续签到天数计算奖励金额（元）
 */
function calcReward(continuousDays: number): number {
  if (continuousDays <= 0) return 0;
  if (continuousDays === 1) return 0.10;
  if (continuousDays === 2) return 0.15;
  if (continuousDays === 3) return 0.20;
  if (continuousDays === 4) return 0.25;
  if (continuousDays === 5) return 0.30;
  if (continuousDays === 6) return 0.35;
  return 0.50; // 7 天及以上封顶 0.50
}

/**
 * 获取 UTC+8 当日日期（YYYY-MM-DD，去掉时区部分）
 *
 * 返回 Date 对象，但仅日期部分有效（时间归零）
 */
function getTodayInUtc8(): Date {
  const now = new Date();
  // UTC+8 偏移 8 小时
  const utc8Ms = now.getTime() + 8 * 60 * 60 * 1000;
  const utc8Date = new Date(utc8Ms);
  // 取 YYYY-MM-DD 部分（构造一个仅含日期的 Date，对应 UTC 0 点）
  const y = utc8Date.getUTCFullYear();
  const m = utc8Date.getUTCMonth();
  const d = utc8Date.getUTCDate();
  return new Date(Date.UTC(y, m, d));
}

/**
 * 获取昨天的日期（UTC+8）
 */
function getYesterdayInUtc8(): Date {
  const today = getTodayInUtc8();
  return new Date(today.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * 执行每日签到
 *
 * 流程：
 * 1. 检查今日是否已签到（唯一约束兜底）
 * 2. 查询昨日签到记录，判断连续天数
 * 3. 事务：写入签到记录 + 增加用户余额
 */
export async function checkIn(userId: string) {
  const today = getTodayInUtc8();

  // 1. 检查今日是否已签到
  const existing = await prisma.checkIn.findUnique({
    where: {
      user_id_checkin_date: {
        user_id: userId,
        checkin_date: today,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error('待接入：今日已签到');
  }

  // 2. 查询昨日签到记录，判断连续天数
  const yesterday = getYesterdayInUtc8();
  const yesterdayCheckin = await prisma.checkIn.findUnique({
    where: {
      user_id_checkin_date: {
        user_id: userId,
        checkin_date: yesterday,
      },
    },
    select: { continuous_days: true },
  });

  // 昨日有签到 → 连续天数 +1；否则重置为 1
  const continuousDays = yesterdayCheckin ? yesterdayCheckin.continuous_days + 1 : 1;
  const rewardAmount = calcReward(continuousDays);

  // 3. 事务：写入签到记录 + 增加用户余额
  const [checkin] = await prisma.$transaction([
    prisma.checkIn.create({
      data: {
        user_id: userId,
        checkin_date: today,
        continuous_days: continuousDays,
        reward_amount: new Decimal(rewardAmount),
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        balance: { increment: new Decimal(rewardAmount) },
      },
    }),
  ]);

  return {
    checkin,
    rewardAmount,
    continuousDays,
  };
}

/**
 * 查询今日签到状态
 */
export async function getTodayCheckinStatus(userId: string) {
  const today = getTodayInUtc8();
  const checkin = await prisma.checkIn.findUnique({
    where: {
      user_id_checkin_date: {
        user_id: userId,
        checkin_date: today,
      },
    },
  });

  return {
    checkedInToday: !!checkin,
    checkin,
  };
}

/**
 * 查询签到记录（按日期倒序）
 */
export async function listCheckinRecords(params: {
  userId: string;
  limit?: number;
  offset?: number;
}) {
  const { userId, limit = 30, offset = 0 } = params;

  // 校验分页参数
  if (!Number.isInteger(limit) || limit < 1 || limit > 365) {
    throw new Error('待接入：limit 参数非法（1-365）');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('待接入：offset 参数非法（非负整数）');
  }

  const [records, total] = await Promise.all([
    prisma.checkIn.findMany({
      where: { user_id: userId },
      orderBy: { checkin_date: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.checkIn.count({ where: { user_id: userId } }),
  ]);

  return { records, total };
}
