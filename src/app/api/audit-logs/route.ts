import { NextResponse } from 'next/server';
import { listAuditLogs } from '@/server/modules/audit/audit-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/audit-logs
 *
 * 查询审计日志（仅超管）
 *
 * 查询参数：
 * - userId?: 操作者 ID 过滤
 * - action?: 操作类型过滤
 * - targetType?: 目标类型过滤
 * - startTime?: 开始时间（ISO 8601）
 * - endTime?: 结束时间（ISO 8601）
 * - limit?: 每页数量（默认 50，最大 200）
 * - offset?: 偏移量（默认 0）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头（仅 super_admin 可访问）
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

  // 仅超管可查询审计日志
  if (userRole !== 'super_admin') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '仅超管可查询审计日志'),
    );
  }

  const url = new URL(request.url);
  const userIdParam = url.searchParams.get('userId') ?? undefined;
  const action = url.searchParams.get('action') ?? undefined;
  const targetType = url.searchParams.get('targetType') ?? undefined;
  const startTimeParam = url.searchParams.get('startTime');
  const endTimeParam = url.searchParams.get('endTime');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let startTime: Date | undefined;
  let endTime: Date | undefined;
  if (startTimeParam) {
    const d = new Date(startTimeParam);
    if (isNaN(d.getTime())) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'startTime 参数非法（需 ISO 8601）'),
      );
    }
    startTime = d;
  }
  if (endTimeParam) {
    const d = new Date(endTimeParam);
    if (isNaN(d.getTime())) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'endTime 参数非法（需 ISO 8601）'),
      );
    }
    endTime = d;
  }

  let limit = 50;
  if (limitParam) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'limit 参数非法，允许 1-200'),
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
    const result = await listAuditLogs({
      userId: userIdParam,
      action,
      targetType,
      startTime,
      endTime,
      limit,
      offset,
    });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询审计日志失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
