import { NextResponse } from 'next/server';
import { getActiveUserPackage } from '@/server/modules/package/package-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/user-packages/active
 *
 * 查询当前用户的有效套餐（取最新一条 active 且未过期的记录）
 *
 * 返回 data.userPackage 为 null 表示无有效套餐（非错误）
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
    const userPackage = await getActiveUserPackage(userId);
    return NextResponse.json(createSuccessResponse({ userPackage }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询有效套餐失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
