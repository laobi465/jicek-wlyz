import { NextResponse } from 'next/server';
import { markPaid } from '@/server/modules/withdrawal/withdrawal-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/admin/withdrawals/[withdrawalId]/paid
 *
 * 标记提现已打款（仅超管）
 *
 * 请求体（JSON）：
 * - payoutTradeNo: 第三方打款流水号（必填）
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

interface RouteContext {
  params: Promise<{ withdrawalId: string }>;
}

export async function POST(
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

  const { withdrawalId } = await context.params;
  if (!withdrawalId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 withdrawalId 路径参数'),
    );
  }

  let body: { payoutTradeNo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { payoutTradeNo } = body;
  if (typeof payoutTradeNo !== 'string' || !payoutTradeNo) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 payoutTradeNo 字段'),
    );
  }

  try {
    await markPaid(withdrawalId, userId, payoutTradeNo);
    return NextResponse.json(createSuccessResponse({ paid: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '标记打款失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
