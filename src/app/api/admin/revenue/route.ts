import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/admin/revenue
 *
 * 收入明细（仅超管）
 *
 * 返回：
 * - summary: { today, thisMonth, total } 成功支付金额汇总（Decimal 序列化为 string）
 * - recentPayments: 最近 20 条成功支付记录（含 user.email + order.order_no）
 *
 * 鉴权：X-User-Role === super_admin
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';

/** UTC+8 当日 0 点对应的 UTC Date */
function startOfToday(): Date {
  const now = new Date();
  const utc8Ms = now.getTime() + 8 * 60 * 60 * 1000;
  const utc8Date = new Date(utc8Ms);
  const y = utc8Date.getUTCFullYear();
  const m = utc8Date.getUTCMonth();
  const d = utc8Date.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 8 * 60 * 60 * 1000);
}

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }
  if (userRole !== SUPER_ADMIN) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '仅超管可操作'),
    );
  }

  try {
    const now = new Date();
    const startOfTodayDate = startOfToday();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayAgg, monthAgg, totalAgg, recentPayments] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: 'success', created_at: { gte: startOfTodayDate } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'success', created_at: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'success' },
        _sum: { amount: true },
      }),
      prisma.payment.findMany({
        where: { status: 'success' },
        include: {
          user: { select: { email: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
    ]);

    return NextResponse.json(
      createSuccessResponse({
        summary: {
          today: todayAgg._sum.amount?.toString() ?? '0',
          thisMonth: monthAgg._sum.amount?.toString() ?? '0',
          total: totalAgg._sum.amount?.toString() ?? '0',
        },
        recentPayments: recentPayments.map((p) => ({
          id: p.id,
          amount: p.amount.toString(),
          method: p.method,
          trade_no: p.trade_no,
          order_id: p.order_id,
          created_at: p.created_at,
          user_email: p.user.email,
        })),
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询收入明细失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
