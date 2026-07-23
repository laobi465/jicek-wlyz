import { NextResponse } from 'next/server';
import { getTicketDetail } from '@/server/modules/ticket/ticket-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/tickets/[ticketId]
 *
 * 查询工单详情（含回复列表）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - 仅提交者或超管可查看
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

interface RouteContext {
  params: Promise<{ ticketId: string }>;
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

  const { ticketId } = await context.params;
  if (!ticketId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 ticketId 路径参数'),
    );
  }

  try {
    const ticket = await getTicketDetail(ticketId, userId, userRole);
    if (!ticket) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.TICKET_NOT_FOUND, '工单不存在或无权访问'),
      );
    }
    return NextResponse.json(createSuccessResponse(ticket));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询工单失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
