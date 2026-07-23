import { NextResponse } from 'next/server';
import {
  createShop,
  listShopsByDeveloper,
} from '@/server/modules/shop/shop-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/shops
 *
 * 列出当前开发者的店铺
 *
 * POST /api/shops
 *
 * 创建店铺
 *
 * 请求体：
 * - name: 店铺名称（必填）
 * - description?: 店铺描述
 * - url?: 店铺域名/URL
 *
 * 鉴权：X-User-Id 请求头（作为 developerId）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  try {
    const shops = await listShopsByDeveloper(userId);
    return NextResponse.json(createSuccessResponse({ shops }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询店铺列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
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

  const { name, description, url } = body;
  if (typeof name !== 'string' || !name) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 name 字段'),
    );
  }
  if (description !== undefined && typeof description !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'description 必须为字符串'),
    );
  }
  if (url !== undefined && typeof url !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'url 必须为字符串'),
    );
  }

  try {
    const shop = await createShop({
      developerId: userId,
      name,
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof url === 'string' ? { url } : {}),
    });
    return NextResponse.json(createSuccessResponse(shop), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建店铺失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
