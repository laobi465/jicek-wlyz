import { NextResponse } from 'next/server';
import {
  createApp,
  listAppsByDeveloper,
} from '@/server/modules/app/app-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/apps
 *
 * 列出当前开发者的应用
 *
 * 查询参数：
 * - status?: 应用状态（active/disabled）
 * - limit?: 每页数量（默认 20，最大 100）
 * - offset?: 偏移量（默认 0）
 *
 * POST /api/apps
 *
 * 创建应用（生成 AppKey + client_secret + RSA 密钥对）
 *
 * 请求体：
 * - name: 应用名称（必填）
 * - description?: 应用描述
 *
 * 鉴权：X-User-Id 请求头（作为 developerId）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_STATUSES = ['active', 'disabled'];

export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const url = new URL(request.url);
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
    const result = await listAppsByDeveloper(userId, { status, limit, offset });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询应用列表失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { name, description } = body;
  if (typeof name !== 'string' || !name) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 name 字段'),
    );
  }
  if (description !== undefined && typeof description !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'description 必须为字符串'),
    );
  }

  try {
    const result = await createApp(userId, name, description || undefined);
    return NextResponse.json(createSuccessResponse(result), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建应用失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
