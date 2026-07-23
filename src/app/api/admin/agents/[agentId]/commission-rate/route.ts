import { NextResponse } from 'next/server';
import { updateCommissionRate } from '@/server/modules/agent/agent-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * PATCH /api/admin/agents/[agentId]/commission-rate
 *
 * 调整代理佣金比例（仅超管）
 *
 * 请求体（JSON）：
 * - rate: 佣金比例（必填，0-100）
 *
 * 鉴权：X-User-Role === super_admin，operatorId 取 X-User-Id
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

  let body: { rate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { rate } = body;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'rate 必须为 0-100 之间的数'),
    );
  }

  try {
    await updateCommissionRate(agentId, rate, userId);
    return NextResponse.json(createSuccessResponse({ updated: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '调整佣金比例失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('佣金比例') || msg.includes('0~100')) {
      code = ErrorCode.PARAM_FORMAT;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
