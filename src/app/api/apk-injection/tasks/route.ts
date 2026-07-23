import { NextResponse } from 'next/server';
import {
  listInjectionTasks,
  type ApkTaskStatus,
} from '@/server/modules/apk-injection/apk-injection-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/apk-injection/tasks
 *
 * APK 注入 - 列出当前用户的注入任务
 *
 * 查询参数：
 * - status?: 任务状态过滤（pending/processing/success/failed）
 * - limit?: 每页数量（默认 20，最大 100）
 * - offset?: 偏移量（默认 0）
 *
 * 鉴权：开发者角色，X-User-Id 请求头
 */

function getAuthenticatedUserId(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

const VALID_STATUSES: ApkTaskStatus[] = ['pending', 'processing', 'success', 'failed'];

export async function GET(request: Request): Promise<NextResponse> {
  const submitterId = getAuthenticatedUserId(request);
  if (!submitterId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  // 校验 status
  let status: ApkTaskStatus | undefined;
  if (statusParam) {
    if (!VALID_STATUSES.includes(statusParam as ApkTaskStatus)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许值：${VALID_STATUSES.join('/')}`),
      );
    }
    status = statusParam as ApkTaskStatus;
  }

  // 校验 limit
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

  // 校验 offset
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
    const result = await listInjectionTasks(submitterId, { status, limit, offset });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询任务列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
