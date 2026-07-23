import { NextResponse } from 'next/server';
import {
  getAppById,
  regenerateConfigSignature,
} from '@/server/modules/app/app-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/apps/[appId]/regenerate-signature
 *
 * 重新生成应用配置签名（防篡改）。校验应用归属。
 *
 * 鉴权：X-User-Id 请求头（作为 developerId）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

interface RouteContext {
  params: Promise<{ appId: string }>;
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

  try {
    const app = await getAppById(appId, userId);
    if (!app) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.APP_NOT_FOUND, '应用不存在或无权访问'),
      );
    }
    const signature = await regenerateConfigSignature(appId);
    return NextResponse.json(createSuccessResponse({ signature }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '重签失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在')) {
      code = ErrorCode.APP_NOT_FOUND;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
