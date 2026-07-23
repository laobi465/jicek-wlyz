import { NextResponse } from 'next/server';
import {
  checkIn,
  getTodayCheckinStatus,
} from '@/server/modules/checkin/checkin-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/checkin
 *
 * 执行每日签到
 *
 * 鉴权：X-User-Id 请求头
 * - 每日仅可签到一次
 * - 连续签到奖励自动入账 balance
 *
 * GET /api/checkin
 *
 * 查询今日签到状态
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

  try {
    const result = await checkIn(userId);
    return NextResponse.json(createSuccessResponse(result), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '签到失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('已签到')) {
      code = ErrorCode.CHECKIN_ALREADY;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const userId = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  try {
    const status = await getTodayCheckinStatus(userId);
    return NextResponse.json(createSuccessResponse(status));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询签到状态失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
