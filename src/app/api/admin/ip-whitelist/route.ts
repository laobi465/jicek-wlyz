import { NextResponse } from 'next/server';
import {
  getGlobalSuperAdminWhitelist,
  getUserIpWhitelist,
  setUserIpWhitelist,
  isValidIpFormat,
} from '@/server/modules/auth/ip-whitelist-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/admin/ip-whitelist
 *   查询超管 IP 白名单（仅超管）
 *   返回：{ global: string[], user: string[] }
 *   - global: 全局白名单（来自环境变量 SUPER_ADMIN_IP_WHITELIST，只读）
 *   - user: 当前超管个人白名单（来自数据库；2FA 开启时为空数组，因字段被备份码占用）
 *
 * PUT /api/admin/ip-whitelist
 *   更新当前超管个人白名单（仅超管）
 *   请求体：{ ips: string[] }
 *   注意：开启 2FA 的超管无法设置个人白名单（字段冲突），返回 8405
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

  try {
    const [global, user] = await Promise.all([
      Promise.resolve(getGlobalSuperAdminWhitelist()),
      getUserIpWhitelist(userId),
    ]);
    return NextResponse.json(createSuccessResponse({ global, user }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询 IP 白名单失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { ips } = body;
  if (!Array.isArray(ips) || !ips.every((v) => typeof v === 'string')) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'ips 参数必须为字符串数组'),
    );
  }

  // 校验每个 IP 格式（支持 IPv4 与 CIDR）
  for (const ip of ips) {
    if (!isValidIpFormat(ip)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `IP 格式非法：${ip}`),
      );
    }
  }

  try {
    await setUserIpWhitelist(userId, ips);
    return NextResponse.json(createSuccessResponse(null));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新 IP 白名单失败';
    // setUserIpWhitelist 在 2FA 开启时会因字段冲突失效，捕获后返回明确错误
    if (msg.includes('待接入')) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.SYSTEM_ERROR, '开启 2FA 的超管无法设置个人 IP 白名单（字段冲突）'),
      );
    }
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
