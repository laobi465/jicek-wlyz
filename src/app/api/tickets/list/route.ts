import { NextResponse } from 'next/server';
import {
  listTickets,
  type TicketStatus,
  type TicketCategory,
} from '@/server/modules/ticket/ticket-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/tickets
 *
 * 列出工单
 *
 * 查询参数：
 * - status?: 工单状态（open/in_progress/resolved/closed）
 * - category?: 工单类型（bug/feature/billing/other）
 * - limit?: 每页数量（默认 20，最大 100）
 * - offset?: 偏移量（默认 0）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - 普通用户仅能查看自己提交的工单
 * - 超管可查看全部工单
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_CATEGORIES = ['bug', 'feature', 'billing', 'other'];

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const categoryParam = url.searchParams.get('category');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let status: TicketStatus | undefined;
  if (statusParam) {
    if (!VALID_STATUSES.includes(statusParam)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
      );
    }
    status = statusParam as TicketStatus;
  }

  let category: TicketCategory | undefined;
  if (categoryParam) {
    if (!VALID_CATEGORIES.includes(categoryParam)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `category 参数非法，允许 ${VALID_CATEGORIES.join('/')}`),
      );
    }
    category = categoryParam as TicketCategory;
  }

  let limit = 20;
  if (limitParam) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'limit 参数非法，允许 1-100'),
      );
    }
    limit = n;
  }

  let offset = 0;
  if (offsetParam) {
    const n = Number(offsetParam);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'offset 参数非法，必须为非负整数'),
      );
    }
    offset = n;
  }

  try {
    const result = await listTickets({
      userId,
      userRole,
      status,
      category,
      limit,
      offset,
    });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询工单列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
