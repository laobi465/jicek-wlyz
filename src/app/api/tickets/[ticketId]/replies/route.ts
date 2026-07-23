import { NextResponse } from 'next/server';
import { replyTicket } from '@/server/modules/ticket/ticket-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/tickets/[ticketId]/replies
 *
 * 回复工单
 *
 * 请求体（JSON）：
 * - content: 回复内容（必填，1-2000 字符）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - 仅提交者或超管可回复
 * - closed 状态不允许回复
 * - 客服（超管）回复时自动将状态置为 in_progress
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

export async function POST(
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

  let body: { content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { content } = body;
  if (typeof content !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 content 字段'),
    );
  }

  try {
    const reply = await replyTicket({
      ticketId,
      userId,
      userRole,
      content,
    });
    return NextResponse.json(createSuccessResponse(reply), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '回复工单失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在')) {
      code = ErrorCode.TICKET_NOT_FOUND;
    } else if (msg.includes('已关闭')) {
      code = ErrorCode.TICKET_CLOSED;
    } else if (msg.includes('无权')) {
      code = ErrorCode.TICKET_FORBIDDEN;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
