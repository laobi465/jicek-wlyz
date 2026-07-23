import { NextResponse } from 'next/server';
import {
  setVariable,
  deleteVariable,
} from '@/server/modules/cloud-variable/cloud-variable-service';
import { getAppById } from '@/server/modules/app/app-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * PUT /api/apps/[appId]/cloud-variables/[key]
 *
 * 更新云变量（upsert，服务端自动重签）。校验 app 归属。
 *
 * 请求体：
 * - value: 变量值（必填）
 * - valueType?: 值类型（string/number/boolean/json）
 * - isPublic?: 是否对客户端可见
 *
 * DELETE /api/apps/[appId]/cloud-variables/[key]
 *
 * 删除云变量（不存在不报错）。校验 app 归属。
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
  params: Promise<{ appId: string; key: string }>;
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { appId, key } = await context.params;
  if (!appId || !key) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appId 或 key 路径参数'),
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

  const { value, valueType, isPublic } = body;
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
    return NextResponse.json(createSuccessResponse(variable));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新云变量失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { appId, key } = await context.params;
  if (!appId || !key) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appId 或 key 路径参数'),
    );
  }

  try {
    const app = await getAppById(appId, userId);
    if (!app) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.APP_NOT_FOUND, '应用不存在或无权访问'),
      );
    }
    await deleteVariable(appId, key);
    return NextResponse.json(createSuccessResponse({ deleted: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除云变量失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
