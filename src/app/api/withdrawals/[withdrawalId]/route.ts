import { NextResponse } from 'next/server';
import { getWithdrawalById } from '@/server/modules/withdrawal/withdrawal-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/withdrawals/[withdrawalId]
 *
 * 查询提现详情
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - 仅本人（withdrawal.agent_id === X-User-Id）或超管可查
 * - 为隐藏存在性，无权或不存在统一返回同一错误
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';

interface RouteContext {
  params: Promise<{ withdrawalId: string }>;
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

  const { withdrawalId } = await context.params;
  if (!withdrawalId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 withdrawalId 路径参数'),
    );
  }

  try {
    const withdrawal = await getWithdrawalById(withdrawalId);
    // 隐藏存在性：不存在或非本人（且非超管）均返回同一错误
    if (!withdrawal || (withdrawal.agent_id !== userId && userRole !== SUPER_ADMIN)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.SYSTEM_ERROR, '提现记录不存在或无权访问'),
      );
    }
    return NextResponse.json(createSuccessResponse(withdrawal));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询提现详情失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
