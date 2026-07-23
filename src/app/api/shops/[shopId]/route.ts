import { NextResponse } from 'next/server';
import {
  getShop,
  updateShop,
  deleteShop,
  type ShopStatus,
} from '@/server/modules/shop/shop-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/shops/[shopId]
 *
 * 查询店铺详情（校验归属）
 *
 * PATCH /api/shops/[shopId]
 *
 * 更新店铺（校验归属）
 *
 * 请求体（均可选）：name / description / url / status
 *
 * DELETE /api/shops/[shopId]
 *
 * 删除店铺（校验归属；仍有在售商品时拒绝）
 *
 * 鉴权：X-User-Id 请求头（作为 developerId）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_STATUSES: ShopStatus[] = ['open', 'closed'];

interface RouteContext {
  params: Promise<{ shopId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { shopId } = await context.params;
  if (!shopId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 shopId 路径参数'),
    );
  }

  try {
    const shop = await getShop(shopId, userId);
    if (!shop) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PERMISSION_DENIED, '店铺不存在或无权访问'),
      );
    }
    return NextResponse.json(createSuccessResponse(shop));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询店铺失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { shopId } = await context.params;
  if (!shopId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 shopId 路径参数'),
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

  const { name, description, url, status } = body;
  if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.includes(status as ShopStatus))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
    );
  }

  try {
    const shop = await updateShop(shopId, userId, {
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof url === 'string' ? { url } : {}),
      ...(typeof status === 'string' ? { status: status as ShopStatus } : {}),
    });
    return NextResponse.json(createSuccessResponse(shop));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新店铺失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在') || msg.includes('无权')) {
      code = ErrorCode.PERMISSION_DENIED;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { shopId } = await context.params;
  if (!shopId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 shopId 路径参数'),
    );
  }

  try {
    await deleteShop(shopId, userId);
    return NextResponse.json(createSuccessResponse({ deleted: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除店铺失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在') || msg.includes('无权')) {
      code = ErrorCode.PERMISSION_DENIED;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
