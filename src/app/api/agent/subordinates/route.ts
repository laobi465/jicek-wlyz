import { NextResponse } from 'next/server';
import { listSubAgents, getAgentByUserId } from '@/server/modules/agent/agent-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/agent/subordinates
 *
 * 查询当前代理的直接下级（service 不支持分页，故无分页参数）
 *
 * 鉴权：X-User-Id 请求头（锁定归属）
 *
 * 实现说明：Agent.parent_id 存储的是上级 Agent 的档案 ID（Agent.id），
 * 而 X-User-Id 是 User ID。listSubAgents 入参 parentAgentId 期望 Agent.id，
 * 故先按 user_id 取当前代理档案，再用其 id 列下级，保证查询语义正确。
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
    if (!agent) {
      // 无代理档案视为无下级，返回空列表
      return NextResponse.json(createSuccessResponse({ subordinates: [] }));
    }
    const subordinates = await listSubAgents(agent.id);
    return NextResponse.json(createSuccessResponse({ subordinates }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询下级代理失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
