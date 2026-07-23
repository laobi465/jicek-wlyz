import { NextResponse } from 'next/server';
import { validateInvitation } from '@/server/modules/invitation/invitation-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/invitations/validate
 *
 * 校验邀请码有效性（不消费）
 *
 * 查询参数：
 * - code: 邀请码（必填）
 *
 * 返回：{ valid: boolean }
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 code 查询参数'),
    );
  }

  try {
    const valid = await validateInvitation(code);
    return NextResponse.json(createSuccessResponse({ valid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '校验邀请码失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
