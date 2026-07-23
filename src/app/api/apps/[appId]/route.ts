import { NextResponse } from 'next/server';
import {
  getAppById,
  updateApp,
  disableApp,
} from '@/server/modules/app/app-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/apps/[appId]
 *
 * 查询应用详情（校验归属）
 *
 * PATCH /api/apps/[appId]
 *
 * 更新应用配置（校验归属；配置变更后服务端自动重签）
 *
 * 请求体（均可选）：
 * - name / description / version / announcement / forceUpdate / minVersion
 * - updateUrl / heartbeatInterval / maxDevices / unbindRule
 *
 * DELETE /api/apps/[appId]
 *
 * 停用应用（status=disabled，校验归属）
 *
 * 鉴权：X-User-Id 请求头（作为 developerId）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_UNBIND_RULES = ['none', 'daily', 'manual'];

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
    return NextResponse.json(createSuccessResponse(app));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询应用失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function PATCH(
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

  const {
    name,
    description,
    version,
    announcement,
    forceUpdate,
    minVersion,
    updateUrl,
    heartbeatInterval,
    maxDevices,
    unbindRule,
  } = body;

  if (unbindRule !== undefined && (typeof unbindRule !== 'string' || !VALID_UNBIND_RULES.includes(unbindRule))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `unbindRule 参数非法，允许 ${VALID_UNBIND_RULES.join('/')}`),
    );
  }
  if (heartbeatInterval !== undefined && (typeof heartbeatInterval !== 'number' || !Number.isInteger(heartbeatInterval) || heartbeatInterval < 1)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'heartbeatInterval 必须为正整数'),
    );
  }
  if (maxDevices !== undefined && (typeof maxDevices !== 'number' || !Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 10000)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'maxDevices 必须为 1-10000 的整数'),
    );
  }
  if (forceUpdate !== undefined && typeof forceUpdate !== 'boolean') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'forceUpdate 必须为布尔值'),
    );
  }

  try {
    // 校验归属（隐藏存在性）
    const existing = await getAppById(appId, userId);
    if (!existing) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.APP_NOT_FOUND, '应用不存在或无权访问'),
      );
    }

    const app = await updateApp(appId, {
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof version === 'string' ? { version } : {}),
      ...(typeof announcement === 'string' ? { announcement } : {}),
      ...(typeof forceUpdate === 'boolean' ? { forceUpdate } : {}),
      ...(typeof minVersion === 'string' ? { minVersion } : {}),
      ...(typeof updateUrl === 'string' ? { updateUrl } : {}),
      ...(typeof heartbeatInterval === 'number' ? { heartbeatInterval } : {}),
      ...(typeof maxDevices === 'number' ? { maxDevices } : {}),
      ...(typeof unbindRule === 'string' ? { unbindRule } : {}),
    });
    return NextResponse.json(createSuccessResponse(app));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新应用失败';
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

  const { appId } = await context.params;
  if (!appId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appId 路径参数'),
    );
  }

  try {
    const app = await disableApp(appId, userId);
    return NextResponse.json(createSuccessResponse(app));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '停用应用失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在') || msg.includes('无权')) {
      code = ErrorCode.APP_NOT_FOUND;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
