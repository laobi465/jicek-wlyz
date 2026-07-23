import { NextResponse } from 'next/server';
import { updateUserRole, USER_ROLES } from '@/server/modules/user/user-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * PATCH /api/admin/users/[userId]/role
 *
 * 变更用户角色（仅超管）
 *
 * 请求体：
 * - role: super_admin / agent / developer（必填）
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

  const { role } = body;
  if (typeof role !== 'string' || !USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `role 参数非法，允许 ${USER_ROLES.join('/')}`),
    );
  }

  // 不允许超管降级自己（防止误操作失去超管权限）
  if (targetUserId === userId && role !== SUPER_ADMIN) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '不允许降级自己的超管角色'),
    );
  }

  try {
    await updateUserRole(targetUserId, role as (typeof USER_ROLES)[number], userId);
    return NextResponse.json(createSuccessResponse(null));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '变更用户角色失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
