import { NextResponse } from 'next/server';
import { getAgentByUserId } from '@/server/modules/agent/agent-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/agent/profile
 *
 * 查询当前用户代理档案
 *
 * 鉴权：X-User-Id 请求头（作为 userId 锁定归属）
 * - 无档案时返回 data: null（非错误，普通用户/开发者无代理档案属正常）
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
    const agent = await getAgentByUserId(userId);
    return NextResponse.json(createSuccessResponse(agent));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询代理档案失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
