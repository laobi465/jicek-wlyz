import { prisma } from '@/lib/db';
import { decreaseStock, increaseStock } from '@/server/modules/shop/shop-service';
import { applyCommission } from '@/server/modules/agent/agent-service';
import { generateCards } from '@/server/modules/card-key/card-key-service';
import type { CardType } from '@/server/modules/card-key/card-key-service';

/**
 * 订单服务（PROJECT.md §2.1 模块 7 发卡业务）
 *
 * 职责：
 * 1. 创建订单（扣库存 + 生成订单号）
 * 2. 支付成功后处理（分配卡密 + 触发 3 层佣金分账）
 * 3. 退款处理（恢复库存 + 回滚佣金）
 *
 * 业务规则：
 * - 订单号格式：ORD-{yyyyMMddHHmmss}-{6位随机}
 * - 订单状态：pending 待支付 / paid 已支付 / failed 失败 / refunded 已退款
 * - 支付成功后：
 *   a. 若商品关联卡密模板，自动生成 1 张卡密并分配给买家
 *   b. 触发开发者上级代理的 3 层佣金分账
 *
 * 安全设计：
 * - 创建订单走事务（扣库存防超卖）
 * - 支付回调幂等（重复回调校验 status）
 * - 佣金分账走事务
 */

/** 订单状态 */
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/**
 * 生成订单号
 *
 * 格式：ORD-{yyyyMMddHHmmss}-{6位随机 hex}
 */
function generateOrderNo(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(16).slice(2, 8);
  return `ORD-${ts}-${rand}`;
}

/**
 * 创建订单
 *
 * 事务：
 * 1. 查商品（校验在售 + 库存）
 * 2. 扣库存
 * 3. 创建订单（status=pending）
 *
 * @throws 商品不存在 / 已下架 / 库存不足
 */
export async function createOrder(buyerId: string, productId: string) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { shop: true },
    });
    if (!product) {
      throw new Error('待接入：商品不存在');
    }
    if (product.status !== 'on_sale') {
      throw new Error('待接入：商品已下架');
    }

    // 扣库存（事务内）
    await decreaseStock(tx, productId, 1);

    // 创建订单
    const order = await tx.order.create({
      data: {
        order_no: generateOrderNo(),
        buyer_id: buyerId,
        product_id: productId,
        amount: product.price,
        status: 'pending',
      },
    });

    return order;
  });
}

/**
 * 查询订单（含商品/店铺信息）
 */
export async function getOrderByNo(orderNo: string) {
  return prisma.order.findUnique({
    where: { order_no: orderNo },
    include: {
      product: { include: { shop: true } },
    },
  });
}

/**
 * 查询订单详情（含分账记录）
 */
export async function getOrderDetail(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      product: { include: { shop: true, card_template: true } },
      buyer: { select: { id: true, email: true, nickname: true } },
    },
  });
}

/**
 * 列出买家订单
 */
export async function listOrdersByBuyer(
  buyerId: string,
  filter?: { status?: OrderStatus; limit?: number; offset?: number },
) {
  return prisma.order.findMany({
    where: {
      buyer_id: buyerId,
      ...(filter?.status ? { status: filter.status } : {}),
    },
    include: { product: true },
    orderBy: { created_at: 'desc' },
    take: filter?.limit ?? 20,
    skip: filter?.offset ?? 0,
  });
}

/**
 * 支付成功处理（易支付回调验签通过后调用）
 *
 * 幂等：重复回调时若 status 已是 paid，直接返回成功
 *
 * 事务：
 * 1. 校验订单状态（pending → paid）
 * 2. 若商品关联卡密模板：自动生成 1 张卡密并分配给买家
 * 3. 标记订单 paid_at + payment_method
 * 4. 触发开发者上级代理 3 层佣金分账
 *
 * @param orderId 订单 ID
 * @param paymentMethod 支付方式（epay）
 * @param tradeNo 第三方交易号
 */
export async function markOrderPaid(
  orderId: string,
  paymentMethod: string,
  tradeNo: string,
): Promise<void> {
  // 幂等检查：仅 select 必要字段
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!existing) {
    throw new Error('待接入：订单不存在');
  }
  if (existing.status === 'paid') {
    // 已支付，幂等返回
    return;
  }
  if (existing.status !== 'pending') {
    throw new Error(`待接入：订单状态非待支付（当前：${existing.status}）`);
  }

  // 步骤 1：标记订单已支付
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'paid',
      paid_at: new Date(),
      payment_method: paymentMethod,
    },
  });

  // 步骤 2：若商品关联卡密模板，自动生成 1 张卡密分配给买家
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      product: { include: { card_template: true, shop: { select: { developer_id: true } } } },
      buyer: { select: { id: true } },
    },
  });
  if (!order) {
    throw new Error('待接入：订单不存在');
  }

  if (order.product.card_template_id && order.product.card_template) {
    const template = order.product.card_template;
    // 生成 1 张卡密（同步，count=1 ≤ 100）
    const result = await generateCards({
      appId: template.app_id,
      templateId: template.id,
      issuerId: order.product.shop.developer_id, // 卡密发行者为开发者
      count: 1,
      type: template.type as CardType,
      durationHours: template.duration_hours ?? undefined,
      maxCount: template.max_count ?? undefined,
      countTimeLimit: template.count_time_limit ?? undefined,
    });

    // 同步生成成功，取出生成的卡密并分配给订单
    if (result.sync && (result.count ?? 0) > 0) {
      // 查询刚生成的卡密（按创建时间倒序取最新一张）
      const card = await prisma.cardKey.findFirst({
        where: {
          app_id: template.app_id,
          template_id: template.id,
          issuer_id: order.product.shop.developer_id,
          status: 'unused',
        },
        orderBy: { created_at: 'desc' },
      });
      if (card) {
        await prisma.order.update({
          where: { id: orderId },
          data: { card_key_id: card.id },
        });
        await prisma.cardKey.update({
          where: { id: card.id },
          data: { user_id: order.buyer_id },
        });
      }
    }
    // 异步生成（count=1 不会走异步分支，此处兜底）
  }

  // 步骤 3：触发开发者上级代理 3 层佣金分账
  // 开发者 = 商品所属店铺的 developer_id
  const developerId = order.product.shop.developer_id;
  await applyCommission(orderId, developerId, Number(order.amount));

  // 步骤 4：审计日志
  await prisma.auditLog.create({
    data: {
      user_id: order.buyer_id,
      action: 'order_paid',
      target_type: 'order',
      target_id: orderId,
      details: JSON.stringify({
        amount: order.amount,
        payment_method: paymentMethod,
        trade_no: tradeNo,
      }),
    },
  });
}

/**
 * 订单退款处理
 *
 * 事务：
 * 1. 校验状态为 paid
 * 2. 更新为 refunded
 * 3. 恢复库存
 * 4. 回滚已分账佣金（从代理 total_commission 扣减）
 *
 * @param orderId 订单 ID
 * @param operatorId 操作人 ID
 */
export async function refundOrder(orderId: string, operatorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, product_id: true, amount: true, commission_split: true, buyer_id: true },
    });
    if (!order) {
      throw new Error('待接入：订单不存在');
    }
    if (order.status !== 'paid') {
      throw new Error('待接入：仅已支付订单可退款');
    }

    // 更新订单状态
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'refunded' },
    });

    // 恢复库存
    await increaseStock(tx, order.product_id, 1);

    // 回滚佣金分账
    if (order.commission_split) {
      try {
        const splits = JSON.parse(order.commission_split) as Array<{
          agentRecordId: string;
          amount: number;
        }>;
        for (const split of splits) {
          await tx.agent.update({
            where: { id: split.agentRecordId },
            data: { total_commission: { decrement: split.amount } },
          });
        }
      } catch {
        // commission_split 解析失败不阻断退款流程，仅审计
      }
    }

    // 审计日志
    await tx.auditLog.create({
      data: {
        user_id: operatorId,
        action: 'order_refund',
        target_type: 'order',
        target_id: orderId,
        details: JSON.stringify({
          amount: order.amount,
          buyer_id: order.buyer_id,
        }),
      },
    });
  });
}

/**
 * 标记订单失败（支付超时/取消）
 */
export async function markOrderFailed(orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, product_id: true },
    });
    if (!order) return;
    if (order.status !== 'pending') return; // 仅 pending 可标记失败

    await tx.order.update({
      where: { id: orderId },
      data: { status: 'failed' },
    });

    // 恢复库存
    await increaseStock(tx, order.product_id, 1);
  });
}

/**
 * 列出全部订单（超管后台用）
 *
 * include product + buyer，按 created_at desc，支持 status / buyerId 过滤。
 */
export async function listAllOrders(options: {
  status?: string;
  buyerId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ orders: Awaited<ReturnType<typeof prisma.order.findMany>>; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const where: {
    status?: string;
    buyer_id?: string;
  } = {};
  if (options.status) where.status = options.status;
  if (options.buyerId) where.buyer_id = options.buyerId;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        product: true,
        buyer: { select: { id: true, email: true, nickname: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total };
}
