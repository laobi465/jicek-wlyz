import { NextResponse } from 'next/server';
import { getInvitationByCode } from '@/server/modules/invitation/invitation-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/invitations/[code]
 *
 * 查询邀请码详情（含生成者信息）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - 不存在时返回 data: null（非错误，便于前端引导）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  const { code } = await context.params;
  if (!code) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 code 路径参数'),
    );
  }

  try {
    const invitation = await getInvitationByCode(code);
    return NextResponse.json(createSuccessResponse(invitation));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询邀请码详情失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
