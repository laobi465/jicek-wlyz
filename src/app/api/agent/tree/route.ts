import { NextResponse } from 'next/server';
import { getAgentTree } from '@/server/modules/agent/agent-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/agent/tree
 *
 * 查询当前代理的下级树（最多 3 层）
 *
 * 查询参数：
 * - depth?: 查询深度（默认 3，范围 1-3）
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

  const url = new URL(request.url);
  const depthParam = url.searchParams.get('depth');

  let depth = 3;
  if (depthParam) {
    const n = Number(depthParam);
    if (!Number.isInteger(n) || n < 1 || n > 3) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'depth 参数非法，允许 1-3'),
      );
    }
    depth = n;
  }

  try {
    const tree = await getAgentTree(userId, depth);
    return NextResponse.json(createSuccessResponse(tree));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询代理下级树失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
