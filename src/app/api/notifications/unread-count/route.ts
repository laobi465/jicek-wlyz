import { NextResponse } from 'next/server';
import { countUnreadNotifications } from '@/server/modules/notification/notification-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/notifications/unread-count
 *
 * 统计当前用户的未读通知数量（用于导航栏红点）
 *
 * 鉴权：X-User-Id 请求头
 */

function getAuth(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

export async function GET(request: Request): Promise<NextResponse> {
  const userId = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  try {
    const count = await countUnreadNotifications(userId);
    return NextResponse.json(createSuccessResponse({ count }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '统计未读通知失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
