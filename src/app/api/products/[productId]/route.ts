import { NextResponse } from 'next/server';
import {
  getProduct,
  updateProduct,
  deleteProduct,
  type ProductStatus,
} from '@/server/modules/shop/shop-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/products/[productId]
 *
 * 查询商品详情（校验归属：product.shop.developer_id 须匹配）
 *
 * PATCH /api/products/[productId]
 *
 * 更新商品（校验归属）
 *
 * 请求体（均可选）：name / description / price / stock / status
 *
 * DELETE /api/products/[productId]
 *
 * 删除商品（校验归属）
 *
 * 鉴权：X-User-Id 请求头（作为 developerId）
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_STATUSES: ProductStatus[] = ['on_sale', 'off_shelf'];

interface RouteContext {
  params: Promise<{ productId: string }>;
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

  const { productId } = await context.params;
  if (!productId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 productId 路径参数'),
    );
  }

  try {
    const product = await getProduct(productId);
    if (!product || product.shop.developer_id !== userId) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PERMISSION_DENIED, '商品不存在或无权访问'),
      );
    }
    return NextResponse.json(createSuccessResponse(product));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询商品失败';
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

  const { productId } = await context.params;
  if (!productId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 productId 路径参数'),
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

  const { name, description, price, stock, status } = body;
  if (price !== undefined && (typeof price !== 'number' || price <= 0)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'price 必须为大于 0 的数'),
    );
  }
  if (stock !== undefined && (typeof stock !== 'number' || !Number.isInteger(stock) || stock < -1)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'stock 必须为整数且 ≥ -1'),
    );
  }
  if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.includes(status as ProductStatus))) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
    );
  }

  try {
    const product = await updateProduct(productId, userId, {
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof price === 'number' ? { price } : {}),
      ...(typeof stock === 'number' ? { stock } : {}),
      ...(typeof status === 'string' ? { status: status as ProductStatus } : {}),
    });
    return NextResponse.json(createSuccessResponse(product));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新商品失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在') || msg.includes('无权')) {
      code = ErrorCode.PERMISSION_DENIED;
    }
    return NextResponse.json(createErrorResponse(code, msg));
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

  const { productId } = await context.params;
  if (!productId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 productId 路径参数'),
    );
  }

  try {
    await deleteProduct(productId, userId);
    return NextResponse.json(createSuccessResponse({ deleted: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除商品失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在') || msg.includes('无权')) {
      code = ErrorCode.PERMISSION_DENIED;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
