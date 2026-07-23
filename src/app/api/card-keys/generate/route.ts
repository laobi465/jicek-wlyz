import { NextResponse } from 'next/server';
import {
  generateCards,
  type CardType,
} from '@/server/modules/card-key/card-key-service';
import { getAppById } from '@/server/modules/app/app-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/card-keys/generate
 *
 * 批量生成卡密
 *
 * 请求体：
 * - appId: 应用 ID（必填）
 * - type: 卡密类型（day/week/month/year/permanent/count/custom_hour）
 * - count: 生成数量（必填，>0；>100 走异步队列）
 * - durationHours?: 自定义小时数（custom_hour 类型）
 * - maxCount?: 次数卡使用次数（count 类型）
 * - countTimeLimit?: 次数卡时间上限（秒）
 * - templateId?: 卡密模板 ID
 *
 * 鉴权：X-User-Id 请求头（作为 issuerId，并校验 appId 归属）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const CARD_TYPES = ['day', 'week', 'month', 'year', 'permanent', 'count', 'custom_hour'] as const;

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

  const { appId, type, count, durationHours, maxCount, countTimeLimit, templateId } = body;

  if (typeof appId !== 'string' || !appId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appId 字段'),
    );
  }
  if (typeof type !== 'string' || !(CARD_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `type 参数非法，允许 ${CARD_TYPES.join('/')}`),
    );
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'count 必须为正整数'),
    );
  }
  if (durationHours !== undefined && (typeof durationHours !== 'number' || durationHours <= 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'durationHours 必须为正数'),
    );
  }
  if (maxCount !== undefined && (typeof maxCount !== 'number' || !Number.isInteger(maxCount) || maxCount <= 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'maxCount 必须为正整数'),
    );
  }
  if (countTimeLimit !== undefined && (typeof countTimeLimit !== 'number' || !Number.isInteger(countTimeLimit) || countTimeLimit <= 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'countTimeLimit 必须为正整数'),
    );
  }

  try {
    // 校验应用归属
    const app = await getAppById(appId, userId);
    if (!app) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.APP_NOT_FOUND, '应用不存在或无权访问'),
      );
    }

    const result = await generateCards({
      appId,
      issuerId: userId,
      count,
      type: type as CardType,
      ...(typeof durationHours === 'number' ? { durationHours } : {}),
      ...(typeof maxCount === 'number' ? { maxCount } : {}),
      ...(typeof countTimeLimit === 'number' ? { countTimeLimit } : {}),
      ...(typeof templateId === 'string' ? { templateId } : {}),
    });

    // 异步生成返回 202
    if (!result.sync) {
      return NextResponse.json(createSuccessResponse(result), { status: 202 });
    }
    return NextResponse.json(createSuccessResponse(result), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '生成卡密失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
