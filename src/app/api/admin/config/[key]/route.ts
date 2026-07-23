import { NextResponse } from 'next/server';
import { updateSystemConfig } from '@/server/modules/config/config-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * PUT /api/admin/config/[key]
 *
 * 更新系统配置值（仅超管）
 *
 * 请求体：
 * - value: 字符串（必填，JSON 格式由调用方保证）
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string }> },
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

  const { key } = await context.params;
  if (!key) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 key 路径参数'),
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

  const { value } = body;
  if (typeof value !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'value 参数必须为字符串'),
    );
  }

  try {
    const updated = await updateSystemConfig(key, value, userId);
    return NextResponse.json(createSuccessResponse(updated));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新系统配置失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
