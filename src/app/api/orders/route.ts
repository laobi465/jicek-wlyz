import { NextResponse } from 'next/server';
import {
  listAllOrders,
  createOrder,
} from '@/server/modules/order/order-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/orders
 *
 * 列出订单：超管可查看全部（可选 buyerId 过滤），其他用户仅查看自己的订单
 *
 * 查询参数：
 * - status?: 订单状态（pending/paid/failed/refunded）
 * - buyerId?: 买家 ID（仅超管可用）
 * - limit?: 每页数量（默认 20，最大 100）
 * - offset?: 偏移量（默认 0）
 *
 * POST /api/orders
 *
 * 创建订单（任何登录用户可购买）
 *
 * 请求体：
 * - productId: 商品 ID（必填）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';
const VALID_STATUSES = ['pending', 'paid', 'failed', 'refunded'];

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const buyerIdParam = url.searchParams.get('buyerId');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let status: string | undefined;
  if (statusParam) {
    if (!VALID_STATUSES.includes(statusParam)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
      );
    }
    status = statusParam;
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

  // 非超管强制限定为自己的订单（隐藏存在性 + 越权防护）
  const buyerId = userRole === SUPER_ADMIN ? (buyerIdParam ?? undefined) : userId;

  try {
    const result = await listAllOrders({ status, buyerId, limit, offset });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询订单列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

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

  const { productId } = body;
  if (typeof productId !== 'string' || !productId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 productId 字段'),
    );
  }

  try {
    const order = await createOrder(userId, productId);
    return NextResponse.json(createSuccessResponse(order), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建订单失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
