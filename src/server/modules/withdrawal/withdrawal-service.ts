import { prisma } from '@/lib/db';

/**
 * 代理提现服务（PROJECT.md §2.3 + §7 已确认清单）
 *
 * 业务规则：
 * - 提现门槛：1 元起（PROJECT.md §7 "代理提现：1 元起，日结（T+1）"）
 * - 结算周期：T+1 日结
 * - 可提现金额 = total_commission - withdrawn_amount - pending 提现金额
 *
 * 流程：
 * 1. 代理发起提现申请（status=pending）
 * 2. 超管审核（approved / rejected）
 * 3. 超管打款（paid，记录 payout_trade_no）
 *
 * 安全设计：
 * - 申请时锁定金额（pending 计入冻结），防止超额提现
 * - 审核走事务（更新提现状态 + 同步 withdrawn_amount）
 * - 全程写入审计日志
 */

/** 提现状态 */
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid';

/** 收款账户类型 */
export type PayoutType = 'alipay' | 'wxpay' | 'bank';

/** 收款账户信息 */
export interface PayoutAccount {
  type: PayoutType;
  /** 支付宝账号 / 微信 openid / 银行卡号 */
  account: string;
  /** 真实姓名（实名校验） */
  name: string;
  /** 银行名称（type=bank 时必填） */
  bank?: string;
}

/** 提现申请入参 */
export interface RequestWithdrawalParams {
  agentUserId: string;
  amount: number;
  payoutAccount: PayoutAccount;
}

/** 最低提现金额（元），PROJECT.md §7 已确认 */
const MIN_WITHDRAWAL_AMOUNT = 1;

/**
 * 计算代理可提现余额
 *
 * 可提现 = total_commission - withdrawn_amount - pending 中的金额
 *
 * pending 包括 status=pending / approved（未打款）的提现
 */
export async function getAvailableBalance(agentUserId: string): Promise<{
  totalCommission: number;
  withdrawnAmount: number;
  pendingAmount: number;
  available: number;
}> {
  const agent = await prisma.agent.findUnique({
    where: { user_id: agentUserId },
  });
  if (!agent) {
    throw new Error('待接入：代理档案不存在');
  }

  // 查询 pending + approved 状态的提现总额
  const pendingResult = await prisma.withdrawal.aggregate({
    where: {
      agent_id: agentUserId,
      status: { in: ['pending', 'approved'] },
    },
    _sum: { amount: true },
  });

  const totalCommission = Number(agent.total_commission);
  const withdrawnAmount = Number(agent.withdrawn_amount);
  const pendingAmount = Number(pendingResult._sum.amount ?? 0);
  const available = totalCommission - withdrawnAmount - pendingAmount;

  return {
    totalCommission,
    withdrawnAmount,
    pendingAmount,
    available,
  };
}

/**
 * 发起提现申请
 *
 * 校验：
 * - 代理状态正常（active）
 * - 金额 ≥ 1 元
 * - 可用余额充足
 *
 * 事务：
 * 1. 二次校验可用余额（防并发）
 * 2. 创建提现记录（status=pending）
 * 3. 审计日志
 */
export async function requestWithdrawal(params: RequestWithdrawalParams) {
  if (params.amount < MIN_WITHDRAWAL_AMOUNT) {
    throw new Error(`待接入：提现金额必须 ≥ ${MIN_WITHDRAWAL_AMOUNT} 元`);
  }

  // 校验代理状态
  const agent = await prisma.agent.findUnique({
    where: { user_id: params.agentUserId },
  });
  if (!agent) {
    throw new Error('待接入：代理档案不存在');
  }
  if (agent.status !== 'active') {
    throw new Error('待接入：代理状态不可用，无法提现');
  }

  // 校验账户信息完整性
  if (!params.payoutAccount.account || !params.payoutAccount.name) {
    throw new Error('待接入：收款账户信息不完整');
  }
  if (params.payoutAccount.type === 'bank' && !params.payoutAccount.bank) {
    throw new Error('待接入：银行提现必须填写银行名称');
  }

  return prisma.$transaction(async (tx) => {
    // 二次校验余额（事务内）
    const balance = await getAvailableBalance(params.agentUserId);
    if (params.amount > balance.available) {
      throw new Error('待接入：可提现余额不足');
    }

    const withdrawal = await tx.withdrawal.create({
      data: {
        agent_id: params.agentUserId,
        amount: params.amount,
        status: 'pending',
        payout_account: JSON.stringify(params.payoutAccount),
      },
    });

    await tx.auditLog.create({
      data: {
        user_id: params.agentUserId,
        action: 'withdrawal_request',
        target_type: 'withdrawal',
        target_id: withdrawal.id,
        details: JSON.stringify({ amount: params.amount }),
      },
    });

    return withdrawal;
  });
}

/**
 * 超管审核通过提现申请
 *
 * 事务：
 * 1. 校验状态为 pending
 * 2. 更新为 approved，记录 reviewer_id / reviewed_at
 * 3. 审计日志
 */
export async function approveWithdrawal(
  withdrawalId: string,
  reviewerId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId },
    });
    if (!withdrawal) {
      throw new Error('待接入：提现记录不存在');
    }
    if (withdrawal.status !== 'pending') {
      throw new Error('待接入：提现记录状态非待审核');
    }

    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'approved',
        reviewer_id: reviewerId,
        reviewed_at: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        user_id: reviewerId,
        action: 'withdrawal_approve',
        target_type: 'withdrawal',
        target_id: withdrawalId,
        details: JSON.stringify({ amount: withdrawal.amount }),
      },
    });
  });
}

/**
 * 超管驳回提现申请
 *
 * 事务：
 * 1. 校验状态为 pending
 * 2. 更新为 rejected，记录 reviewer_id / reviewed_at / reject_reason
 * 3. 审计日志
 */
export async function rejectWithdrawal(
  withdrawalId: string,
  reviewerId: string,
  reason: string,
): Promise<void> {
  if (!reason) {
    throw new Error('待接入：驳回必须填写原因');
  }

  await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId },
    });
    if (!withdrawal) {
      throw new Error('待接入：提现记录不存在');
    }
    if (withdrawal.status !== 'pending') {
      throw new Error('待接入：提现记录状态非待审核');
    }

    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'rejected',
        reviewer_id: reviewerId,
        reviewed_at: new Date(),
        reject_reason: reason,
      },
    });

    await tx.auditLog.create({
      data: {
        user_id: reviewerId,
        action: 'withdrawal_reject',
        target_type: 'withdrawal',
        target_id: withdrawalId,
        details: JSON.stringify({ amount: withdrawal.amount, reason }),
      },
    });
  });
}

/**
 * 超管标记已打款（approved → paid）
 *
 * 事务：
 * 1. 校验状态为 approved
 * 2. 更新为 paid，记录 payout_trade_no / paid_at
 * 3. 同步 Agent.withdrawn_amount 累加
 * 4. 审计日志
 */
export async function markPaid(
  withdrawalId: string,
  reviewerId: string,
  payoutTradeNo: string,
): Promise<void> {
  if (!payoutTradeNo) {
    throw new Error('待接入：打款流水号必填');
  }

  await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId },
    });
    if (!withdrawal) {
      throw new Error('待接入：提现记录不存在');
    }
    if (withdrawal.status !== 'approved') {
      throw new Error('待接入：提现记录状态非已审核');
    }

    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'paid',
        payout_trade_no: payoutTradeNo,
        paid_at: new Date(),
      },
    });

    // 同步代理已提现金额
    await tx.agent.update({
      where: { user_id: withdrawal.agent_id },
      data: {
        withdrawn_amount: { increment: Number(withdrawal.amount) },
      },
    });

    await tx.auditLog.create({
      data: {
        user_id: reviewerId,
        action: 'withdrawal_paid',
        target_type: 'withdrawal',
        target_id: withdrawalId,
        details: JSON.stringify({
          amount: withdrawal.amount,
          payout_trade_no: payoutTradeNo,
        }),
      },
    });
  });
}

/**
 * 列出提现记录
 *
 * @param filter 过滤条件
 */
export async function listWithdrawals(filter: {
  agentUserId?: string;
  status?: WithdrawalStatus;
  limit?: number;
  offset?: number;
}) {
  const where: {
    agent_id?: string;
    status?: string;
  } = {};
  if (filter.agentUserId) where.agent_id = filter.agentUserId;
  if (filter.status) where.status = filter.status;

  return prisma.withdrawal.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: filter.limit ?? 20,
    skip: filter.offset ?? 0,
  });
}
