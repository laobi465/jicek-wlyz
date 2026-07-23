import { NextResponse } from 'next/server';
import {
  getShop,
  listProducts,
  createProduct,
} from '@/server/modules/shop/shop-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/shops/[shopId]/products
 *
 * 列出店铺商品（校验店铺归属）
 *
 * POST /api/shops/[shopId]/products
 *
 * 创建商品（校验店铺归属 + 卡密模板归属）
 *
 * 请求体：
 * - name: 商品名称（必填）
 * - description?: 商品描述
 * - price: 价格（必填，>0）
 * - stock: 库存（必填，-1 表示无限）
 * - cardTemplateId?: 关联卡密模板 ID
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
  params: Promise<{ shopId: string }>;
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

  const { shopId } = await context.params;
  if (!shopId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 shopId 路径参数'),
    );
  }

  try {
    const shop = await getShop(shopId, userId);
    if (!shop) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PERMISSION_DENIED, '店铺不存在或无权访问'),
      );
    }
    const products = await listProducts(shopId);
    return NextResponse.json(createSuccessResponse({ products }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询商品列表失败';
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

  const { shopId } = await context.params;
  if (!shopId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 shopId 路径参数'),
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

  const { name, description, price, stock, cardTemplateId } = body;
  if (typeof name !== 'string' || !name) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 name 字段'),
    );
  }
  if (typeof price !== 'number' || price <= 0) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'price 必须为大于 0 的数'),
    );
  }
  if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < -1) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'stock 必须为整数且 ≥ -1'),
    );
  }
  if (cardTemplateId !== undefined && typeof cardTemplateId !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'cardTemplateId 必须为字符串'),
    );
  }

  try {
    // 校验店铺归属（隐藏存在性）
    const shop = await getShop(shopId, userId);
    if (!shop) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PERMISSION_DENIED, '店铺不存在或无权访问'),
      );
    }

    const product = await createProduct(userId, {
      shopId,
      name,
      ...(typeof description === 'string' ? { description } : {}),
      price,
      stock,
      ...(typeof cardTemplateId === 'string' ? { cardTemplateId } : {}),
    });
    return NextResponse.json(createSuccessResponse(product), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建商品失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在') || msg.includes('无权')) {
      code = ErrorCode.PERMISSION_DENIED;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
