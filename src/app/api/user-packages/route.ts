import { NextResponse } from 'next/server';
import { listUserPackages } from '@/server/modules/package/package-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/user-packages
 *
 * 列出当前用户的套餐记录（含套餐详情，按创建时间倒序）
 *
 * 鉴权：X-User-Id 请求头
 */

function getAuthenticatedUserId(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

export async function GET(request: Request): Promise<NextResponse> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  try {
    const userPackages = await listUserPackages(userId);
    return NextResponse.json(createSuccessResponse({ userPackages }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询套餐记录失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
