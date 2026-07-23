import { NextResponse } from 'next/server';
import {
  getAllVariables,
  setVariable,
} from '@/server/modules/cloud-variable/cloud-variable-service';
import { getAppById } from '@/server/modules/app/app-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/apps/[appId]/cloud-variables
 *
 * 列出应用全部云变量（校验 app 归属）
 *
 * POST /api/apps/[appId]/cloud-variables
 *
 * 新增/更新云变量（upsert，服务端自动签名防篡改）
 *
 * 请求体：
 * - key: 变量名（必填）
 * - value: 变量值（必填）
 * - valueType?: 值类型（string/number/boolean/json，默认 string）
 * - isPublic?: 是否对客户端可见（默认 false）
 *
 * 鉴权：X-User-Id 请求头（校验 app 归属）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_VALUE_TYPES = ['string', 'number', 'boolean', 'json'];

interface RouteContext {
  params: Promise<{ appId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { appId } = await context.params;
  if (!appId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appId 路径参数'),
    );
  }

  try {
    const app = await getAppById(appId, userId);
    if (!app) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.APP_NOT_FOUND, '应用不存在或无权访问'),
      );
    }
    const variables = await getAllVariables(appId);
    return NextResponse.json(createSuccessResponse({ variables }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询云变量失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { appId } = await context.params;
  if (!appId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appId 路径参数'),
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

  const { key, value, valueType, isPublic } = body;
  if (typeof key !== 'string' || !key) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 key 字段'),
    );
  }
  if (typeof value !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 value 字段'),
    );
  }
  if (valueType !== undefined && (typeof valueType !== 'string' || !VALID_VALUE_TYPES.includes(valueType))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `valueType 参数非法，允许 ${VALID_VALUE_TYPES.join('/')}`),
    );
  }
  if (isPublic !== undefined && typeof isPublic !== 'boolean') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'isPublic 必须为布尔值'),
    );
  }

  try {
    const app = await getAppById(appId, userId);
    if (!app) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.APP_NOT_FOUND, '应用不存在或无权访问'),
      );
    }
    const variable = await setVariable(
      appId,
      key,
      value,
      valueType || 'string',
      isPublic === true,
    );
    return NextResponse.json(createSuccessResponse(variable), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '设置云变量失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
