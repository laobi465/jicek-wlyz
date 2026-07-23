import { NextResponse } from 'next/server';
import { updateUserStatus, USER_STATUSES } from '@/server/modules/user/user-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * PATCH /api/admin/users/[userId]/status
 *
 * 变更用户状态（仅超管）
 *
 * 请求体：
 * - status: active / banned / pending（必填）
 *
 * 鉴权：X-User-Role === super_admin
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }
  if (userRole !== SUPER_ADMIN) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '仅超管可操作'),
    );
  }

  const { userId: targetUserId } = await context.params;
  if (!targetUserId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 userId 路径参数'),
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

  const { status } = body;
  if (typeof status !== 'string' || !USER_STATUSES.includes(status as (typeof USER_STATUSES)[number])) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${USER_STATUSES.join('/')}`),
    );
  }

  // 不允许超管封禁自己
  if (targetUserId === userId && status !== 'active') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '不允许变更自己的状态'),
    );
  }

  try {
    await updateUserStatus(targetUserId, status as (typeof USER_STATUSES)[number], userId);
    return NextResponse.json(createSuccessResponse(null));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '变更用户状态失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
