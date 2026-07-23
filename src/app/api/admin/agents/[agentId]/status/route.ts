import { NextResponse } from 'next/server';
import { updateAgentStatus, type AgentStatus } from '@/server/modules/agent/agent-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * PATCH /api/admin/agents/[agentId]/status
 *
 * 更新代理状态（仅超管，审核 / 冻结）
 *
 * 请求体（JSON）：
 * - status: active / pending / frozen（必填）
 *
 * 鉴权：X-User-Role === super_admin，reviewerId 取 X-User-Id
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';
const VALID_STATUSES = ['active', 'pending', 'frozen'];

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function PATCH(
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

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { status } = body;
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
    );
  }

  try {
    await updateAgentStatus(agentId, status as AgentStatus, userId);
    return NextResponse.json(createSuccessResponse({ updated: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新代理状态失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
