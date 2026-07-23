import { NextResponse } from 'next/server';
import {
  getCardById,
  revokeCard,
} from '@/server/modules/card-key/card-key-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/card-keys/[cardId]/revoke
 *
 * 作废卡密（远程失效，status=disabled）。校验归属。
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
    await revokeCard(cardId);
    return NextResponse.json(createSuccessResponse({ revoked: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '作废卡密失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
