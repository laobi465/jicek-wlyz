import { NextResponse } from 'next/server';
import { listNotifications } from '@/server/modules/notification/notification-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/notifications
 *
 * 列出当前用户的通知
 *
 * 查询参数：
 * - isRead?: 是否已读过滤（true/false）
 * - limit?: 每页数量（默认 20，最大 100）
 * - offset?: 偏移量（默认 0）
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

  const url = new URL(request.url);
  const isReadParam = url.searchParams.get('isRead');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let isRead: boolean | undefined;
  if (isReadParam !== null) {
    if (isReadParam !== 'true' && isReadParam !== 'false') {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'isRead 参数非法，允许 true/false'),
      );
    }
    isRead = isReadParam === 'true';
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
    const result = await listNotifications({ userId, isRead, limit, offset });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询通知列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
