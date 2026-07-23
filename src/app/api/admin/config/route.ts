import { NextResponse } from 'next/server';
import { listSystemConfigs, initializeDefaultConfigs, CONFIG_GROUPS } from '@/server/modules/config/config-service';
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

/**
 * POST /api/admin/config
 *
 * 初始化所有预定义配置项（空值行）
 *
 * 为 CONFIG_META 中全部预定义项（payment/storage/email/sms/cdn/backup/general
 * 共 30+ 项）创建空值行，已存在的不覆盖。创建后超管在 /admin/config 页面
 * 逐项编辑填入实际值即可。
 *
 * 鉴权：X-User-Role === super_admin
 */
export async function POST(request: Request): Promise<NextResponse> {
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

  try {
    const created = await initializeDefaultConfigs(userId);
    return NextResponse.json(
      createSuccessResponse({ created }, created > 0 ? `已初始化 ${created} 项配置` : '所有配置已存在，无需初始化'),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '初始化配置失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
