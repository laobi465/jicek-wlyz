import { NextResponse } from 'next/server';
import { subscribePackage } from '@/server/modules/package/package-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/packages/[packageId]/subscribe
 *
 * 订阅套餐（任何登录用户可订阅）
 *
 * 鉴权：X-User-Id 请求头
 */

function getAuthenticatedUserId(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

interface RouteContext {
  params: Promise<{ packageId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { packageId } = await context.params;
  if (!packageId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 packageId 路径参数'),
    );
  }

  try {
    const userPackage = await subscribePackage(userId, packageId);
    return NextResponse.json(createSuccessResponse(userPackage), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '订阅套餐失败';
    // 套餐不存在 / 已停用均复用 PACKAGE_EXPIRED（无专用错误码）
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在') || msg.includes('停用')) {
      code = ErrorCode.PACKAGE_EXPIRED;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
