import { NextResponse } from 'next/server';
import {
  listInvitationsByGenerator,
  createInvitation,
  type InvitationType,
  type UsageMode,
} from '@/server/modules/invitation/invitation-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/invitations
 *
 * 列出当前用户生成的邀请码（generatorId 强制锁定为 X-User-Id）
 *
 * POST /api/invitations
 *
 * 创建邀请码（generatorId 强制锁定为 X-User-Id，service 内校验代理层级约束）
 *
 * 请求体（JSON）：
 * - type: developer / agent（必填）
 * - targetLevel?: 1 / 2 / 3（type=agent 时必填）
 * - usageMode?: once / reusable / limited（默认 once）
 * - maxUses?: 正整数（usageMode=limited 时必填）
 * - expiresInDays?: 正数（null=永久）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_TYPES = ['developer', 'agent'];
const VALID_USAGE_MODES = ['once', 'reusable', 'limited'];
const VALID_TARGET_LEVELS = [1, 2, 3];

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  try {
    // generatorId 强制锁定为当前用户
    const invitations = await listInvitationsByGenerator(userId);
    return NextResponse.json(createSuccessResponse({ invitations }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询邀请码失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
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

  const { type, targetLevel, usageMode, maxUses, expiresInDays } = body;

  if (typeof type !== 'string' || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `type 参数非法，允许 ${VALID_TYPES.join('/')}`),
    );
  }

  if (targetLevel !== undefined) {
    if (typeof targetLevel !== 'number' || !Number.isInteger(targetLevel) || !VALID_TARGET_LEVELS.includes(targetLevel)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'targetLevel 必须为 1/2/3'),
      );
    }
  }

  if (usageMode !== undefined && (typeof usageMode !== 'string' || !VALID_USAGE_MODES.includes(usageMode))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `usageMode 参数非法，允许 ${VALID_USAGE_MODES.join('/')}`),
    );
  }

  if (maxUses !== undefined && (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses <= 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'maxUses 必须为正整数'),
    );
  }

  if (expiresInDays !== undefined && expiresInDays !== null) {
    if (typeof expiresInDays !== 'number' || !Number.isFinite(expiresInDays) || expiresInDays <= 0) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'expiresInDays 必须为正数'),
      );
    }
  }

  try {
    // generatorId 强制锁定为当前用户；service 内校验代理层级约束
    const invitation = await createInvitation({
      generatorId: userId,
      type: type as InvitationType,
      ...(typeof targetLevel === 'number' ? { targetLevel } : {}),
      ...(typeof usageMode === 'string' ? { usageMode: usageMode as UsageMode } : {}),
      ...(typeof maxUses === 'number' ? { maxUses } : {}),
      ...(expiresInDays === null ? { expiresInDays: null } : typeof expiresInDays === 'number' ? { expiresInDays } : {}),
    });
    return NextResponse.json(createSuccessResponse(invitation), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建邀请码失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('层级超限') || msg.includes('层级已超限')) {
      code = ErrorCode.AGENT_LEVEL_EXCEEDED;
    } else if (msg.includes('无权') || msg.includes('仅可生成') || msg.includes('只能邀请')) {
      code = ErrorCode.PERMISSION_DENIED;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
