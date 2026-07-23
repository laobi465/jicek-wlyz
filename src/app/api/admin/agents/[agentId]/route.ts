import { NextResponse } from 'next/server';
import { getAgentById } from '@/server/modules/agent/agent-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/admin/agents/[agentId]
 *
 * 查询代理详情（仅超管）
 *
 * 鉴权：X-User-Role === super_admin
 * - 不存在时返回 data: null
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';

interface RouteContext {
  params: Promise<{ agentId: string }>;
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
  if (userRole !== SUPER_ADMIN) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '仅超管可操作'),
    );
  }

  const { agentId } = await context.params;
  if (!agentId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 agentId 路径参数'),
    );
  }

  try {
    const agent = await getAgentById(agentId);
    return NextResponse.json(createSuccessResponse(agent));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询代理详情失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
