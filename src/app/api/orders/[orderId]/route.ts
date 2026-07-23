import { NextResponse } from 'next/server';
import { getOrderDetail } from '@/server/modules/order/order-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/orders/[orderId]
 *
 * 查询订单详情（含商品/店铺/买家信息）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - 仅买家本人或超管可查看
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  const { orderId } = await context.params;
  if (!orderId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 orderId 路径参数'),
    );
  }

  try {
    const order = await getOrderDetail(orderId);
    // 隐藏存在性：不存在或非本人（且非超管）均返回同一错误
    if (!order || (order.buyer_id !== userId && userRole !== SUPER_ADMIN)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.SYSTEM_ERROR, '订单不存在或无权访问'),
      );
    }
    return NextResponse.json(createSuccessResponse(order));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询订单失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
