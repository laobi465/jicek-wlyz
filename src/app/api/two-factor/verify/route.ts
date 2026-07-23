import { NextResponse } from 'next/server';
import { verifyTwoFactorCode } from '@/server/modules/auth/two-factor-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/two-factor/verify
 *
 * 验证两步验证码（登录二次校验）
 *
 * 请求体：{ code: string }
 * 返回：{ verified: boolean }
 */

function getAuth(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

export async function POST(request: Request): Promise<NextResponse> {
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
    const verified = await verifyTwoFactorCode(userId, code);
    if (!verified) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.TWO_FACTOR_INVALID, '两步验证码错误'),
      );
    }
    return NextResponse.json(createSuccessResponse({ verified: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '两步验证失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
