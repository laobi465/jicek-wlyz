import { NextResponse } from 'next/server';
import {
  getPackage,
  updatePackage,
} from '@/server/modules/package/package-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/packages/[packageId]
 *
 * 查询套餐详情
 *
 * PATCH /api/packages/[packageId]
 *
 * 更新套餐（仅超管）
 *
 * 请求体（均可选）：name / description / price / appQuota / cardQuota / sortOrder / status
 *
 * DELETE /api/packages/[packageId]
 *
 * 停用套餐（仅超管，置 status=disabled）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const SUPER_ADMIN = 'super_admin';
const VALID_STATUSES = ['active', 'disabled'];

interface RouteContext {
  params: Promise<{ packageId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  const { packageId } = await context.params;
  if (!packageId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 packageId 路径参数'),
    );
  }

  try {
    const pkg = await getPackage(packageId);
    if (!pkg) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PACKAGE_EXPIRED, '套餐不存在'),
      );
    }
    return NextResponse.json(createSuccessResponse(pkg));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询套餐失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }
  if (userRole !== SUPER_ADMIN) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '仅超管可操作'),
    );
  }

  const { packageId } = await context.params;
  if (!packageId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 packageId 路径参数'),
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

  const { name, description, price, appQuota, cardQuota, sortOrder, status } = body;
  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'price 必须为 >= 0 的数'),
    );
  }
  if (appQuota !== undefined && (typeof appQuota !== 'number' || !Number.isInteger(appQuota) || appQuota < 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'appQuota 必须为非负整数'),
    );
  }
  if (cardQuota !== undefined && (typeof cardQuota !== 'number' || !Number.isInteger(cardQuota) || cardQuota < 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'cardQuota 必须为非负整数'),
    );
  }
  if (sortOrder !== undefined && (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'sortOrder 必须为整数'),
    );
  }
  if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.includes(status))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
    );
  }

  try {
    const pkg = await updatePackage(packageId, {
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof price === 'number' ? { price } : {}),
      ...(typeof appQuota === 'number' ? { appQuota } : {}),
      ...(typeof cardQuota === 'number' ? { cardQuota } : {}),
      ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
      ...(typeof status === 'string' ? { status } : {}),
    });
    return NextResponse.json(createSuccessResponse(pkg));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新套餐失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }
  if (userRole !== SUPER_ADMIN) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '仅超管可操作'),
    );
  }

  const { packageId } = await context.params;
  if (!packageId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 packageId 路径参数'),
    );
  }

  try {
    const pkg = await updatePackage(packageId, { status: 'disabled' });
    return NextResponse.json(createSuccessResponse(pkg));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '停用套餐失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
