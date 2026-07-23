import { prisma } from '@/lib/db';

/**
 * 套餐服务（PROJECT.md §2.1 模块 10 + §7 已确认清单）
 *
 * 职责：
 * 1. 列出/查询套餐（管理员后台自定义定价）
 * 2. 订阅套餐（事务：创建 UserPackage + 设置额度 + 30 天有效期）
 * 3. 检查额度（创建应用 / 生成卡密时调用）
 * 4. 扣减额度（创建应用 / 生成卡密成功后调用）
 * 5. 续费套餐（叠加额度 + 延长有效期）
 *
 * 业务规则：
 * - 套餐：name / price（月费）/ app_quota（应用数额度）/ card_quota（卡密额度）
 * - 用户套餐：remaining_app_quota / remaining_card_quota / expires_at
 * - 套餐到期后额度失效（status=expired）
 * - 创建应用扣 1 个 app_quota，生成卡密扣对应 card_quota
 *
 * 错误码（沿用 SPEC §2.3）：
 * - 5001 套餐余额不足
 * - 5002 套餐已过期
 */

/** 额度类型 */
export type QuotaType = 'app' | 'card';

/** 套餐订阅有效期（天），PROJECT.md §7 "套餐包月充值" */
const SUBSCRIPTION_DURATION_DAYS = 30;

/**
 * 列出所有启用的套餐（按 sort_order 排序）
 */
export async function listActivePackages() {
  return prisma.package.findMany({
    where: { status: 'active' },
    orderBy: { sort_order: 'asc' },
  });
}

/**
 * 列出全部套餐（含停用，超管后台用）
 */
export async function listAllPackages() {
  return prisma.package.findMany({
    orderBy: { sort_order: 'asc' },
  });
}

/**
 * 获取套餐详情
 */
export async function getPackage(packageId: string) {
  return prisma.package.findUnique({ where: { id: packageId } });
}

/**
 * 创建套餐（超管后台）
 */
export async function createPackage(params: {
  name: string;
  description?: string;
  price: number;
  appQuota: number;
  cardQuota: number;
  sortOrder?: number;
}) {
  if (params.price < 0) {
    throw new Error('待接入：套餐价格必须 ≥ 0');
  }
  if (params.appQuota < 0 || params.cardQuota < 0) {
    throw new Error('待接入：套餐额度必须 ≥ 0');
  }
  return prisma.package.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      price: params.price,
      app_quota: params.appQuota,
      card_quota: params.cardQuota,
      sort_order: params.sortOrder ?? 0,
      status: 'active',
    },
  });
}

/**
 * 订阅套餐（支付成功后调用）
 *
 * 事务：
 * 1. 校验套餐启用
 * 2. 创建 UserPackage（30 天有效期）
 * 3. 写入审计日志
 *
 * 注意：订阅时若用户已有同套餐未过期记录，按"叠加"处理（额度累加 + 有效期延长 30 天）
 *
 * @param userId 用户 ID
 * @param packageId 套餐 ID
 * @param paymentId 关联支付记录 ID
 */
export async function subscribePackage(
  userId: string,
  packageId: string,
  paymentId?: string,
) {
  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg) {
    throw new Error('待接入：套餐不存在');
  }
  if (pkg.status !== 'active') {
    throw new Error('待接入：套餐已停用');
  }

  return prisma.$transaction(async (tx) => {
    // 查询是否已有同套餐且未过期的记录
    const existing = await tx.userPackage.findFirst({
      where: {
        user_id: userId,
        package_id: packageId,
        status: 'active',
        expires_at: { gt: new Date() },
      },
    });

    if (existing) {
      // 叠加：额度累加 + 有效期延长 30 天
      const newExpiry = new Date(existing.expires_at);
      newExpiry.setDate(newExpiry.getDate() + SUBSCRIPTION_DURATION_DAYS);

      const updated = await tx.userPackage.update({
        where: { id: existing.id },
        data: {
          remaining_app_quota: { increment: pkg.app_quota },
          remaining_card_quota: { increment: pkg.card_quota },
          expires_at: newExpiry,
        },
      });

      await tx.auditLog.create({
        data: {
          user_id: userId,
          action: 'package_renew',
          target_type: 'user_package',
          target_id: existing.id,
          details: JSON.stringify({
            package_id: packageId,
            payment_id: paymentId,
            app_quota_added: pkg.app_quota,
            card_quota_added: pkg.card_quota,
          }),
        },
      });

      return updated;
    }

    // 新订阅
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SUBSCRIPTION_DURATION_DAYS);

    const userPackage = await tx.userPackage.create({
      data: {
        user_id: userId,
        package_id: packageId,
        remaining_app_quota: pkg.app_quota,
        remaining_card_quota: pkg.card_quota,
        status: 'active',
        expires_at: expiresAt,
      },
    });

    await tx.auditLog.create({
      data: {
        user_id: userId,
        action: 'package_subscribe',
        target_type: 'user_package',
        target_id: userPackage.id,
        details: JSON.stringify({
          package_id: packageId,
          payment_id: paymentId,
          app_quota: pkg.app_quota,
          card_quota: pkg.card_quota,
        }),
      },
    });

    return userPackage;
  });
}

/**
 * 获取用户当前有效套餐（取最新一条 active 且未过期的）
 */
export async function getActiveUserPackage(userId: string) {
  return prisma.userPackage.findFirst({
    where: {
      user_id: userId,
      status: 'active',
      expires_at: { gt: new Date() },
    },
    include: { package: true },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * 列出用户套餐记录
 */
export async function listUserPackages(userId: string) {
  return prisma.userPackage.findMany({
    where: { user_id: userId },
    include: { package: true },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * 检查额度
 *
 * @param userId 用户 ID
 * @param type 额度类型（app / card）
 * @param count 需要的额度数
 * @returns true=可用，false=不可用
 *
 * 抛错场景（业务层映射为错误码）：
 * - 无有效套餐 → ErrorCode.PACKAGE_EXPIRED (5002)
 * - 额度不足 → ErrorCode.PACKAGE_INSUFFICIENT (5001)
 */
export async function checkQuota(
  userId: string,
  type: QuotaType,
  count = 1,
): Promise<boolean> {
  const userPackage = await getActiveUserPackage(userId);
  if (!userPackage) {
    return false; // 业务层映射为 PACKAGE_EXPIRED
  }

  const remaining =
    type === 'app'
      ? userPackage.remaining_app_quota
      : userPackage.remaining_card_quota;

  return remaining >= count;
}

/**
 * 扣减额度
 *
 * 事务：
 * 1. 查询有效套餐
 * 2. 二次校验额度（防并发）
 * 3. 扣减对应额度
 * 4. 审计日志
 *
 * @throws 无有效套餐 / 额度不足
 */
export async function consumeQuota(
  userId: string,
  type: QuotaType,
  count = 1,
  operatorId?: string,
): Promise<void> {
  if (count <= 0) {
    throw new Error('待接入：扣减额度必须 > 0');
  }

  return prisma.$transaction(async (tx) => {
    const userPackage = await tx.userPackage.findFirst({
      where: {
        user_id: userId,
        status: 'active',
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!userPackage) {
      throw new Error('待接入：无有效套餐（套餐已过期或未订阅）');
    }

    if (type === 'app') {
      if (userPackage.remaining_app_quota < count) {
        throw new Error('待接入：应用额度不足');
      }
      await tx.userPackage.update({
        where: { id: userPackage.id },
        data: { remaining_app_quota: { decrement: count } },
      });
    } else {
      if (userPackage.remaining_card_quota < count) {
        throw new Error('待接入：卡密额度不足');
      }
      await tx.userPackage.update({
        where: { id: userPackage.id },
        data: { remaining_card_quota: { decrement: count } },
      });
    }

    await tx.auditLog.create({
      data: {
        user_id: operatorId ?? userId,
        action: 'quota_consume',
        target_type: 'user_package',
        target_id: userPackage.id,
        details: JSON.stringify({ type, count }),
      },
    });
  });
}

/**
 * 标记过期套餐（定时任务调用）
 *
 * 将所有 expires_at < now 且 status=active 的 UserPackage 标记为 expired
 *
 * @returns 标记的记录数
 */
export async function markExpiredPackages(): Promise<number> {
  const result = await prisma.userPackage.updateMany({
    where: {
      status: 'active',
      expires_at: { lt: new Date() },
    },
    data: { status: 'expired' },
  });
  return result.count;
}
