import { NextResponse } from 'next/server';
import {
  getTwoFactorStatus,
  enableTwoFactor,
  disableTwoFactor,
} from '@/server/modules/auth/two-factor-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/two-factor
 *
 * 查询当前用户两步验证状态
 *
 * POST /api/two-factor
 *
 * 开启两步验证（生成密钥 + 备份码）
 * 请求体：{ accountName: string }
 *
 * DELETE /api/two-factor
 *
 * 关闭两步验证
 * 请求体：{ code: string }
 */

function getAuth(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

export async function GET(request: Request): Promise<NextResponse> {
  const userId = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  try {
    const status = await getTwoFactorStatus(userId);
    return NextResponse.json(createSuccessResponse(status));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询两步验证状态失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  let body: { accountName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { accountName } = body;
  if (typeof accountName !== 'string' || accountName.trim().length === 0) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 accountName 字段'),
    );
  }

  try {
    const result = await enableTwoFactor({ userId, accountName: accountName.trim() });
    return NextResponse.json(createSuccessResponse(result), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '开启两步验证失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const userId = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { code } = body;
  if (typeof code !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 code 字段'),
    );
  }

  try {
    await disableTwoFactor({ userId, code });
    return NextResponse.json(createSuccessResponse({ disabled: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '关闭两步验证失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('错误')) {
      code = ErrorCode.TWO_FACTOR_INVALID;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
