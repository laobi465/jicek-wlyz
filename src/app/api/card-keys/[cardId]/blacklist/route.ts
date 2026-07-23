import { NextResponse } from 'next/server';
import {
  getCardById,
  addToBlacklist,
} from '@/server/modules/card-key/card-key-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/card-keys/[cardId]/blacklist
 *
 * 将卡密加入黑名单池（status=blacklisted，全局拦截）。校验归属。
 *
 * 鉴权：X-User-Id 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

interface RouteContext {
  params: Promise<{ cardId: string }>;
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

  const { cardId } = await context.params;
  if (!cardId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 cardId 路径参数'),
    );
  }

  try {
    const card = await getCardById(cardId);
    if (!card || card.app.developer_id !== userId) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.CARD_NOT_FOUND, '卡密不存在或无权访问'),
      );
    }
    await addToBlacklist(cardId);
    return NextResponse.json(createSuccessResponse({ blacklisted: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '加黑名单失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
