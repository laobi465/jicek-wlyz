import { NextResponse } from 'next/server';
import {
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/server/modules/notification/notification-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/notifications/read
 *
 * 标记通知为已读
 *
 * 请求体（JSON）：
 * - notificationId?: 通知 ID（不传或为空则标记全部已读）
 *
 * 鉴权：X-User-Id 请求头
 */

function getAuth(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  let body: { notificationId?: unknown } = {};
  // 允许空请求体（标记全部已读）
  try {
    body = await request.json();
  } catch {
    // 忽略解析错误，按标记全部已读处理
  }

  const { notificationId } = body;

  try {
    // notificationId 为空 → 标记全部已读
    if (!notificationId || typeof notificationId !== 'string') {
      const count = await markAllNotificationsAsRead(userId);
      return NextResponse.json(createSuccessResponse({ markedCount: count, all: true }));
    }

    const notification = await markNotificationAsRead(notificationId, userId);
    return NextResponse.json(createSuccessResponse({ notification, all: false }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '标记已读失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在')) {
      code = ErrorCode.NOTIFICATION_NOT_FOUND;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
