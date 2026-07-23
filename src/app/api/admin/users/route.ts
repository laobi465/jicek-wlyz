import { NextResponse } from 'next/server';
import { listUsers, USER_ROLES, USER_STATUSES } from '@/server/modules/user/user-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/admin/users
 *
 * 全平台用户列表（仅超管）
 *
 * 查询参数：
 * - role?: super_admin / agent / developer
 * - status?: active / banned / pending
 * - keyword?: 邮箱或昵称模糊匹配
 * - limit?: 默认 20，最大 100
 * - offset?: 默认 0
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

export async function GET(request: Request): Promise<NextResponse> {
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

  const url = new URL(request.url);
  const roleParam = url.searchParams.get('role');
  const statusParam = url.searchParams.get('status');
  const keyword = url.searchParams.get('keyword') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let role: string | undefined;
  if (roleParam) {
    if (!USER_ROLES.includes(roleParam as (typeof USER_ROLES)[number])) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `role 参数非法，允许 ${USER_ROLES.join('/')}`),
      );
    }
    role = roleParam;
  }

  let status: string | undefined;
  if (statusParam) {
    if (!USER_STATUSES.includes(statusParam as (typeof USER_STATUSES)[number])) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${USER_STATUSES.join('/')}`),
      );
    }
    status = statusParam;
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
    const result = await listUsers({ role, status, keyword, limit, offset });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询用户列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
