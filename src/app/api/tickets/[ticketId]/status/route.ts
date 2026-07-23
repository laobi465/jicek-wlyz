import { NextResponse } from 'next/server';
import {
  updateTicketStatus,
  type TicketStatus,
} from '@/server/modules/ticket/ticket-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * PATCH /api/tickets/[ticketId]/status
 *
 * 更新工单状态（关闭/解决）
 *
 * 请求体（JSON）：
 * - status: 目标状态（open/in_progress/resolved/closed）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - 超管：可将任意状态置为 resolved 或 closed
 * - 提交者：可将工单置为 closed（主动关闭）
 * - 已 closed 工单不允许再变更
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

interface RouteContext {
  params: Promise<{ ticketId: string }>;
}

export async function PATCH(
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

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { status } = body;
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
    );
  }

  try {
    const updated = await updateTicketStatus({
      ticketId,
      userId,
      userRole,
      status: status as TicketStatus,
    });
    return NextResponse.json(createSuccessResponse(updated));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新工单状态失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在')) {
      code = ErrorCode.TICKET_NOT_FOUND;
    } else if (msg.includes('已关闭')) {
      code = ErrorCode.TICKET_CLOSED;
    } else if (msg.includes('无权') || msg.includes('仅客服')) {
      code = ErrorCode.TICKET_FORBIDDEN;
    } else if (msg.includes('非法')) {
      code = ErrorCode.TICKET_STATUS_INVALID;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
