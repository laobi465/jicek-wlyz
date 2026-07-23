import { prisma } from '@/lib/db';

/**
 * 店铺与商品服务（PROJECT.md §2.1 模块 7 发卡业务）
 *
 * 职责：
 * 1. 店铺管理（开发者创建/更新店铺）
 * 2. 商品管理（创建/更新/上下架，关联卡密模板）
 * 3. 库存管理（-1 表示无限库存，下单时扣减）
 *
 * 业务规则：
 * - 商品可关联 CardTemplate（购买后自动分配该模板的卡密）
 * - 库存 = -1 表示无限
 * - 商品状态：on_sale 在售 / off_shelf 下架
 *
 * 安全设计：
 * - 操作前校验资源归属（开发者只能管理自己的店铺/商品）
 * - 库存扣减走事务 + 二次校验，防止超卖
 */

/** 店铺状态 */
export type ShopStatus = 'open' | 'closed';

/** 商品状态 */
export type ProductStatus = 'on_sale' | 'off_shelf';

/** 创建店铺入参 */
export interface CreateShopParams {
  developerId: string;
  name: string;
  description?: string;
  url?: string;
}

/** 更新店铺入参 */
export interface UpdateShopParams {
  name?: string;
  description?: string;
  url?: string;
  status?: ShopStatus;
}

/** 创建商品入参 */
export interface CreateProductParams {
  shopId: string;
  cardTemplateId?: string;
  name: string;
  description?: string;
  price: number;
  stock: number; // -1 表示无限
}

/** 更新商品入参 */
export interface UpdateProductParams {
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
  status?: ProductStatus;
}

/**
 * 创建店铺
 */
export async function createShop(params: CreateShopParams) {
  if (!params.name) {
    throw new Error('待接入：店铺名称必填');
  }
  return prisma.shop.create({
    data: {
      developer_id: params.developerId,
      name: params.name,
      description: params.description ?? null,
      url: params.url ?? null,
      status: 'open',
    },
  });
}

/**
 * 更新店铺（校验归属）
 */
export async function updateShop(
  shopId: string,
  developerId: string,
  params: UpdateShopParams,
) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) {
    throw new Error('待接入：店铺不存在');
  }
  if (shop.developer_id !== developerId) {
    throw new Error('待接入：无权操作他人店铺');
  }

  return prisma.shop.update({
    where: { id: shopId },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.url !== undefined ? { url: params.url } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
    },
  });
}

/**
 * 列出开发者的店铺
 */
export async function listShopsByDeveloper(developerId: string) {
  return prisma.shop.findMany({
    where: { developer_id: developerId },
    include: { _count: { select: { products: true } } },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * 创建商品
 *
 * 校验：
 * - 店铺归属
 * - 价格 > 0
 * - stock >= -1
 * - cardTemplateId 归属同一开发者
 */
export async function createProduct(
  developerId: string,
  params: CreateProductParams,
) {
  // 校验店铺归属
  const shop = await prisma.shop.findUnique({ where: { id: params.shopId } });
  if (!shop) {
    throw new Error('待接入：店铺不存在');
  }
  if (shop.developer_id !== developerId) {
    throw new Error('待接入：无权在他人店铺创建商品');
  }

  if (params.price <= 0) {
    throw new Error('待接入：商品价格必须 > 0');
  }
  if (params.stock < -1) {
    throw new Error('待接入：库存必须 ≥ -1（-1 表示无限）');
  }

  // 校验卡密模板归属（如指定）
  if (params.cardTemplateId) {
    const template = await prisma.cardTemplate.findUnique({
      where: { id: params.cardTemplateId },
      select: { app: { select: { developer_id: true } } },
    });
    if (!template) {
      throw new Error('待接入：卡密模板不存在');
    }
    if (template.app.developer_id !== developerId) {
      throw new Error('待接入：无权引用他人卡密模板');
    }
  }

  return prisma.product.create({
    data: {
      shop_id: params.shopId,
      card_template_id: params.cardTemplateId ?? null,
      name: params.name,
      description: params.description ?? null,
      price: params.price,
      stock: params.stock,
      status: 'on_sale',
    },
  });
}

/**
 * 更新商品（校验归属）
 */
export async function updateProduct(
  productId: string,
  developerId: string,
  params: UpdateProductParams,
) {
  // 通过商品查店铺，校验归属
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { shop: { select: { developer_id: true } } },
  });
  if (!product) {
    throw new Error('待接入：商品不存在');
  }
  if (product.shop.developer_id !== developerId) {
    throw new Error('待接入：无权操作他人商品');
  }

  if (params.price !== undefined && params.price <= 0) {
    throw new Error('待接入：商品价格必须 > 0');
  }
  if (params.stock !== undefined && params.stock < -1) {
    throw new Error('待接入：库存必须 ≥ -1');
  }

  return prisma.product.update({
    where: { id: productId },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.price !== undefined ? { price: params.price } : {}),
      ...(params.stock !== undefined ? { stock: params.stock } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
    },
  });
}

/**
 * 列出店铺商品
 */
export async function listProducts(shopId: string, onlyOnSale = false) {
  return prisma.product.findMany({
    where: {
      shop_id: shopId,
      ...(onlyOnSale ? { status: 'on_sale' } : {}),
    },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * 获取商品详情
 */
export async function getProduct(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    include: { shop: true },
  });
}

/**
 * 扣减库存（订单创建时调用，事务内）
 *
 * 规则：
 * - stock = -1（无限）→ 不扣减
 * - stock > 0 → 扣减，不足抛错
 * - stock = 0 → 已售罄
 *
 * 必须在事务内调用，防止并发超卖
 */
export async function decreaseStock(
  tx: Parameters<Parameters<typeof prisma['$transaction']>[0]>[0],
  productId: string,
  count = 1,
): Promise<void> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { stock: true, status: true },
  });
  if (!product) {
    throw new Error('待接入：商品不存在');
  }
  if (product.status !== 'on_sale') {
    throw new Error('待接入：商品已下架');
  }

  // 无限库存不扣减
  if (product.stock === -1) return;

  if (product.stock < count) {
    throw new Error('待接入：库存不足');
  }

  await tx.product.update({
    where: { id: productId },
    data: { stock: { decrement: count } },
  });
}

/**
 * 恢复库存（订单失败/退款时调用）
 */
export async function increaseStock(
  tx: Parameters<Parameters<typeof prisma['$transaction']>[0]>[0],
  productId: string,
  count = 1,
): Promise<void> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { stock: true },
  });
  if (!product) return;

  // 无限库存不恢复
  if (product.stock === -1) return;

  await tx.product.update({
    where: { id: productId },
    data: { stock: { increment: count } },
  });
}

/**
 * 查询店铺详情（可选校验归属）
 *
 * 传入 developerId 时归属不匹配返回 null。include 商品计数。
 */
export async function getShop(
  shopId: string,
  developerId?: string,
) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: { _count: { select: { products: true } } },
  });
  if (!shop) return null;
  if (developerId && shop.developer_id !== developerId) {
    return null;
  }
  return shop;
}

/**
 * 删除店铺（校验归属；仍有在售商品时抛错）
 */
export async function deleteShop(shopId: string, developerId: string): Promise<void> {
  const shop = await getShop(shopId, developerId);
  if (!shop) {
    throw new Error('待接入：店铺不存在或无权操作');
  }
  const onSaleCount = await prisma.product.count({
    where: { shop_id: shopId, status: 'on_sale' },
  });
  if (onSaleCount > 0) {
    throw new Error('待接入：店铺仍有在售商品，无法删除');
  }
  await prisma.shop.delete({ where: { id: shopId } });
}

/**
 * 删除商品（通过 product.shop.developer_id 校验归属）
 */
export async function deleteProduct(productId: string, developerId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { shop: { select: { developer_id: true } } },
  });
  if (!product) {
    throw new Error('待接入：商品不存在');
  }
  if (product.shop.developer_id !== developerId) {
    throw new Error('待接入：无权操作他人商品');
  }
  await prisma.product.delete({ where: { id: productId } });
}
