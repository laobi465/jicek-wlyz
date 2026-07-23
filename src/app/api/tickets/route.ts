import { NextResponse } from 'next/server';
import {
  createTicket,
  type TicketCategory,
  type TicketPriority,
} from '@/server/modules/ticket/ticket-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/tickets
 *
 * 创建工单
 *
 * 请求体（JSON）：
 * - title: 标题（必填，1-100 字符）
 * - content: 内容（必填，1-5000 字符）
 * - category?: 类型（bug/feature/billing/other，默认 other）
 * - priority?: 优先级（low/medium/high/urgent，默认 medium）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_CATEGORIES = ['bug', 'feature', 'billing', 'other'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export async function POST(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { title, content, category, priority } = body;

  if (typeof title !== 'string' || typeof content !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 title 或 content 字段'),
    );
  }

  // 校验枚举字段
  if (category !== undefined && (typeof category !== 'string' || !VALID_CATEGORIES.includes(category))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `category 参数非法，允许 ${VALID_CATEGORIES.join('/')}`),
    );
  }
  if (priority !== undefined && (typeof priority !== 'string' || !VALID_PRIORITIES.includes(priority))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `priority 参数非法，允许 ${VALID_PRIORITIES.join('/')}`),
    );
  }

  try {
    const ticket = await createTicket({
      submitterId: userId,
      title,
      content,
      category: category as TicketCategory | undefined,
      priority: priority as TicketPriority | undefined,
    });
    return NextResponse.json(createSuccessResponse(ticket), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建工单失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
