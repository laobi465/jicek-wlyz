import { NextResponse } from 'next/server';
import {
  listAllPackages,
  listActivePackages,
  createPackage,
} from '@/server/modules/package/package-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/packages
 *
 * 列出套餐：超管返回全部（含停用），其他用户仅返回启用套餐
 *
 * POST /api/packages
 *
 * 创建套餐（仅超管）
 *
 * 请求体：
 * - name: 套餐名称（必填）
 * - description?: 套餐描述
 * - price: 月费价格（必填，>=0）
 * - appQuota: 应用数额度（必填，>=0）
 * - cardQuota: 卡密额度（必填，>=0）
 * - sortOrder?: 排序权重（默认 0）
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

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  try {
    const packages = userRole === SUPER_ADMIN
      ? await listAllPackages()
      : await listActivePackages();
    return NextResponse.json(createSuccessResponse({ packages }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询套餐列表失败';
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
  if (userRole !== SUPER_ADMIN) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PERMISSION_DENIED, '仅超管可操作'),
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

  const { name, description, price, appQuota, cardQuota, sortOrder } = body;
  if (typeof name !== 'string' || !name) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 name 字段'),
    );
  }
  if (typeof price !== 'number' || price < 0) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'price 必须为 >= 0 的数'),
    );
  }
  if (typeof appQuota !== 'number' || !Number.isInteger(appQuota) || appQuota < 0) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'appQuota 必须为非负整数'),
    );
  }
  if (typeof cardQuota !== 'number' || !Number.isInteger(cardQuota) || cardQuota < 0) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'cardQuota 必须为非负整数'),
    );
  }
  if (sortOrder !== undefined && (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'sortOrder 必须为整数'),
    );
  }

  try {
    const pkg = await createPackage({
      name,
      ...(typeof description === 'string' ? { description } : {}),
      price,
      appQuota,
      cardQuota,
      ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
    });
    return NextResponse.json(createSuccessResponse(pkg), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建套餐失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
