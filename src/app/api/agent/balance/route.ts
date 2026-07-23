import { NextResponse } from 'next/server';
import { getAvailableBalance } from '@/server/modules/withdrawal/withdrawal-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/agent/balance
 *
 * 查询当前代理可提现余额
 *
 * 鉴权：X-User-Id 请求头（作为 agentUserId 锁定归属）
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

  try {
    const balance = await getAvailableBalance(userId);
    return NextResponse.json(createSuccessResponse(balance));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询可提现余额失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
