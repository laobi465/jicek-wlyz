import { NextResponse } from 'next/server';
import { listCards } from '@/server/modules/card-key/card-key-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/card-keys
 *
 * 列出卡密（开发者后台用）
 *
 * 查询参数：
 * - appId?: 应用 ID
 * - status?: 卡密状态（unused/active/expired/disabled/blacklisted）
 * - templateId?: 卡密模板 ID
 * - limit?: 每页数量（默认 20，最大 100）
 * - offset?: 偏移量（默认 0）
 *
 * issuerId 取自 X-User-Id（仅列出本人生成的卡密）
 *
 * 鉴权：X-User-Id 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_STATUSES = ['unused', 'active', 'expired', 'disabled', 'blacklisted'];

export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const url = new URL(request.url);
  const appId = url.searchParams.get('appId') ?? undefined;
  const templateId = url.searchParams.get('templateId') ?? undefined;
  const statusParam = url.searchParams.get('status');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let status: string | undefined;
  if (statusParam) {
    if (!VALID_STATUSES.includes(statusParam)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
      );
    }
    status = statusParam;
  }

  let limit = 20;
  if (limitParam) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'limit 参数非法，允许 1-100'),
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
    const result = await listCards({
      appId,
      issuerId: userId,
      status,
      templateId,
      limit,
      offset,
    });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询卡密列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
