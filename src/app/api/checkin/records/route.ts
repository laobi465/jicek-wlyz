import { NextResponse } from 'next/server';
import { listCheckinRecords } from '@/server/modules/checkin/checkin-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/checkin/records
 *
 * 查询签到记录（按日期倒序）
 *
 * 查询参数：
 * - limit?: 每页数量（默认 30，最大 365）
 * - offset?: 偏移量（默认 0）
 *
 * 鉴权：X-User-Id 请求头
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

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let limit = 30;
  if (limitParam) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'limit 参数非法，允许 1-365'),
      );
    }
    limit = n;
  }

  let offset = 0;
  if (offsetParam) {
    const n = Number(offsetParam);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'offset 参数非法，必须为非负整数'),
      );
    }
    offset = n;
  }

  try {
    const result = await listCheckinRecords({ userId, limit, offset });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询签到记录失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
