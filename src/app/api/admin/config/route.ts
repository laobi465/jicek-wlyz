import { NextResponse } from 'next/server';
import { listSystemConfigs, CONFIG_GROUPS } from '@/server/modules/config/config-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/admin/config
 *
 * 系统配置列表（仅超管）
 *
 * 查询参数：
 * - group?: payment / storage / email / sms / cdn / backup / general
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
  const groupParam = url.searchParams.get('group') ?? undefined;

  let group: string | undefined;
  if (groupParam) {
    if (!CONFIG_GROUPS.includes(groupParam as (typeof CONFIG_GROUPS)[number])) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `group 参数非法，允许 ${CONFIG_GROUPS.join('/')}`),
      );
    }
    group = groupParam;
  }

  try {
    const configs = await listSystemConfigs(group);
    return NextResponse.json(createSuccessResponse({ configs }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询系统配置失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
