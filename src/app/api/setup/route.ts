import { NextResponse } from 'next/server';
import {
  checkNeedsSetup,
  createFirstSuperAdmin,
  SetupError,
} from '@/server/modules/setup/setup-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * 首次安装向导 API
 *
 * GET  /api/setup        → 查询是否需要初始化 { needsSetup: boolean }
 * POST /api/setup        → 创建首个超管 { email, password, name } → { userId }
 *
 * 安全：
 * - 公开接口（无需鉴权，部署后首次访问）
 * - POST 内部二次校验无超管，防止向导被二次利用提权
 * - 邮箱/密码/用户名手写校验，非 zod
 */

/** 邮箱格式校验（RFC 简化版） */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 32;

export async function GET(): Promise<NextResponse> {
  try {
    const needsSetup = await checkNeedsSetup();
    return NextResponse.json(createSuccessResponse({ needsSetup }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '检查初始化状态失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { email, password, name } = body;

  // 参数校验
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '邮箱格式不正确'),
    );
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `密码至少 ${PASSWORD_MIN_LENGTH} 位`),
    );
  }
  if (typeof name !== 'string' || name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `用户名长度 ${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH}`),
    );
  }

  try {
    const result = await createFirstSuperAdmin(email, password, name);
    return NextResponse.json(
      createSuccessResponse(result, '超管账号创建成功，请使用该账号登录'),
    );
  } catch (e) {
    if (e instanceof SetupError) {
      return NextResponse.json(createErrorResponse(ErrorCode.PERMISSION_DENIED, e.message));
    }
    const msg = e instanceof Error ? e.message : '创建超管账号失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
