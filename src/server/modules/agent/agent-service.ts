import { prisma } from '@/lib/db';
import { consumeInvitation } from '@/server/modules/invitation/invitation-service';

/**
 * 代理分销服务（PROJECT.md §2.3 + SPEC §2.6.4）
 *
 * 职责：
 * 1. 凭邀请码注册代理（建立 3 层分销关系）
 * 2. 查询代理下级树（A→B→C→D 三层）
 * 3. 计算 3 层佣金分账（D 制卡/售卡时，A/B/C 按各自 commission_rate 分润）
 *
 * 业务规则（PROJECT.md §2.3）：
 * - 3 层代理：A（一级）→ B（二级）→ C（三级）→ D（开发者）
 * - D 制卡/售卡产生订单时：C 分 3% / B 分 2% / A 分 1%（默认）
 * - 实际分账比例按每个代理的 commission_rate 字段计算（默认 0，邀请时设置）
 *
 * 安全设计：
 * - 注册走事务（消费邀请码 + 创建 Agent 档案 + 更新 User 角色）
 * - 佣金分账走事务（订单状态更新 + 代理余额累加 + 分账记录写入）
 */

/** 代理层级枚举 */
export const AGENT_LEVEL = {
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
} as const;

/** 各层级默认佣金比例（百分比，邀请注册时填入 commission_rate） */
export const DEFAULT_COMMISSION_RATE_BY_LEVEL: Record<number, number> = {
  [AGENT_LEVEL.FIRST]: 1, // 一级代理默认拿 1%（作为开发者 D 的三级上级）
  [AGENT_LEVEL.SECOND]: 2, // 二级代理默认拿 2%（作为开发者 D 的二级上级）
  [AGENT_LEVEL.THIRD]: 3, // 三级代理默认拿 3%（作为开发者 D 的直接上级）
};

/** 代理状态 */
export type AgentStatus = 'active' | 'pending' | 'frozen';

/** 佣金分账记录项（写入 Order.commission_split JSON） */
export interface CommissionSplitItem {
  /** 层级（1=直接上级 / 2=二级上级 / 3=三级上级） */
  level: number;
  /** 代理 User ID */
  agentId: string;
  /** 代理 Agent ID */
  agentRecordId: string;
  /** 分账金额 */
  amount: number;
  /** 分账比例（百分比） */
  rate: number;
}

/** 注册代理入参 */
export interface RegisterAgentParams {
  /** 已注册的 User ID（用户先用普通方式注册账号，再凭邀请码激活代理身份） */
  userId: string;
  /** 邀请码 */
  invitationCode: string;
}

/**
 * 凭邀请码注册代理
 *
 * 流程（事务）：
 * 1. 消费邀请码（绑定使用者）
 * 2. 校验目标层级合法性
 * 3. 创建 Agent 档案（level + parent_id + commission_rate）
 * 4. 更新 User：role=agent + agent_level + parent_agent_id
 *
 * @throws 邀请码无效 / 层级超限
 */
export async function registerAgent(params: RegisterAgentParams) {
  return prisma.$transaction(async (tx) => {
    // 步骤 1：消费邀请码（事务内一致性）
    const invitation = await consumeInvitation(params.invitationCode, params.userId);

    // 仅 agent 类型邀请码可用于注册代理
    if (invitation.type !== 'agent') {
      throw new Error('待接入：该邀请码类型不能用于注册代理');
    }
    if (invitation.targetLevel === null) {
      throw new Error('待接入：邀请码未指定代理层级');
    }

    const level = invitation.targetLevel;
    const validLevels: number[] = [AGENT_LEVEL.FIRST, AGENT_LEVEL.SECOND, AGENT_LEVEL.THIRD];
    if (!validLevels.includes(level)) {
      throw new Error('待接入：代理层级超限');
    }

    // 步骤 2：确定上级代理
    // level=1 由超管邀请，parent_id=null
    // level=2/3 由上级代理邀请，parent_id = 邀请人生成的 agent 记录 ID
    let parentId: string | null = null;
    if (level > AGENT_LEVEL.FIRST) {
      // 邀请人必须是已激活的代理
      const generatorAgent = await tx.agent.findUnique({
        where: { user_id: invitation.generatorId },
      });
      if (!generatorAgent) {
        throw new Error('待接入：邀请人非有效代理');
      }
      if (generatorAgent.level !== level - 1) {
        throw new Error('待接入：邀请人层级与目标层级不匹配');
      }
      if (generatorAgent.status !== 'active') {
        throw new Error('待接入：邀请人代理状态不可用');
      }
      parentId = generatorAgent.id;
    }

    // 步骤 3：创建 Agent 档案
    const commissionRate = DEFAULT_COMMISSION_RATE_BY_LEVEL[level] ?? 0;
    const agent = await tx.agent.create({
      data: {
        user_id: params.userId,
        level,
        parent_id: parentId,
        commission_rate: commissionRate,
        total_commission: 0,
        withdrawn_amount: 0,
        status: level === AGENT_LEVEL.FIRST ? 'pending' : 'active', // 一级代理需超管审核
      },
    });

    // 步骤 4：更新 User 角色与层级信息
    await tx.user.update({
      where: { id: params.userId },
      data: {
        role: 'agent',
        agent_level: level,
        parent_agent_id: invitation.generatorId,
      },
    });

    return agent;
  });
}

/**
 * 查询代理档案
 */
export async function getAgentByUserId(userId: string) {
  return prisma.agent.findUnique({
    where: { user_id: userId },
    include: {
      user: { select: { id: true, email: true, nickname: true, status: true } },
    },
  });
}

/**
 * 查询代理下级树（最多 3 层）
 *
 * @param agentUserId 代理的 User ID
 * @param depth 查询深度（默认 3）
 *
 * 实现说明：prisma 不支持递归查询，按层级逐级查询
 */
export async function getAgentTree(agentUserId: string, depth = 3) {
  const root = await prisma.agent.findUnique({
    where: { user_id: agentUserId },
  });
  if (!root) {
    throw new Error('待接入：代理不存在');
  }

  // 第 1 层：直接下级
  const level1 = await prisma.agent.findMany({
    where: { parent_id: root.id },
    include: {
      user: { select: { id: true, email: true, nickname: true, status: true } },
    },
  });

  if (depth < 2 || level1.length === 0) {
    return { level1, level2: [], level3: [] };
  }

  // 第 2 层：level1 的下级
  const level1Ids = level1.map((a) => a.id);
  const level2 = await prisma.agent.findMany({
    where: { parent_id: { in: level1Ids } },
    include: {
      user: { select: { id: true, email: true, nickname: true, status: true } },
    },
  });

  if (depth < 3 || level2.length === 0) {
    return { level1, level2, level3: [] };
  }

  // 第 3 层：level2 的下级
  const level2Ids = level2.map((a) => a.id);
  const level3 = await prisma.agent.findMany({
    where: { parent_id: { in: level2Ids } },
    include: {
      user: { select: { id: true, email: true, nickname: true, status: true } },
    },
  });

  return { level1, level2, level3 };
}

/**
 * 获取开发者（D）的上级代理链（最多 3 层）
 *
 * 返回顺序：[直接上级 C, 二级上级 B, 三级上级 A]
 *
 * 用于佣金分账时遍历
 */
export async function getAgentChainOfDeveloper(developerUserId: string) {
  const developer = await prisma.user.findUnique({
    where: { id: developerUserId },
    select: { parent_agent_id: true },
  });
  if (!developer || !developer.parent_agent_id) {
    return [];
  }

  // 直接上级
  const directParent = await prisma.agent.findUnique({
    where: { user_id: developer.parent_agent_id },
  });
  if (!directParent) return [];

  const chain = [directParent];

  // 二级上级
  if (directParent.parent_id) {
    const second = await prisma.agent.findUnique({
      where: { id: directParent.parent_id },
    });
    if (second) {
      chain.push(second);
      // 三级上级
      if (second.parent_id) {
        const third = await prisma.agent.findUnique({
          where: { id: second.parent_id },
        });
        if (third) chain.push(third);
      }
    }
  }

  return chain;
}

/**
 * 计算 3 层佣金分账（D 制卡/售卡产生订单时触发）
 *
 * 规则：
 * - 沿 D 的 parent_agent_id 链向上找 3 层
 * - 直接上级（C）拿 amount × C.commission_rate / 100
 * - 二级上级（B）拿 amount × B.commission_rate / 100
 * - 三级上级（A）拿 amount × A.commission_rate / 100
 *
 * @param developerUserId 开发者（D）的 User ID
 * @param orderAmount 订单金额（Decimal）
 * @returns 分账记录数组（已过滤 commission_rate=0 的代理）
 */
export async function computeCommission(
  developerUserId: string,
  orderAmount: number,
): Promise<CommissionSplitItem[]> {
  if (orderAmount <= 0) {
    return [];
  }

  const chain = await getAgentChainOfDeveloper(developerUserId);
  if (chain.length === 0) {
    return [];
  }

  const splits: CommissionSplitItem[] = [];
  chain.forEach((agent, idx) => {
    const rate = Number(agent.commission_rate);
    if (rate <= 0) return; // 比例 0 不分账
    const amount = Number(((orderAmount * rate) / 100).toFixed(2));
    splits.push({
      level: idx + 1, // 1=直接上级, 2=二级上级, 3=三级上级
      agentId: agent.user_id,
      agentRecordId: agent.id,
      amount,
      rate,
    });
  });

  return splits;
}

/**
 * 应用佣金分账（订单支付成功后调用）
 *
 * 事务：
 * 1. 计算分账
 * 2. 每个代理 total_commission 累加
 * 3. 分账记录 JSON 写入 Order.commission_split
 *
 * @returns 分账记录数组（用于审计 / 通知）
 */
export async function applyCommission(
  orderId: string,
  developerUserId: string,
  orderAmount: number,
): Promise<CommissionSplitItem[]> {
  const splits = await computeCommission(developerUserId, orderAmount);
  if (splits.length === 0) {
    // 无分账，仍写入空数组标记已计算
    await prisma.order.update({
      where: { id: orderId },
      data: { commission_split: JSON.stringify([]) },
    });
    return [];
  }

  return prisma.$transaction(async (tx) => {
    // 逐个代理累加佣金（避免并发覆盖）
    for (const split of splits) {
      await tx.agent.update({
        where: { id: split.agentRecordId },
        data: {
          total_commission: { increment: split.amount },
        },
      });
    }

    // 写入订单分账记录
    await tx.order.update({
      where: { id: orderId },
      data: { commission_split: JSON.stringify(splits) },
    });

    return splits;
  });
}

/**
 * 更新代理状态（超管审核 / 冻结）
 */
export async function updateAgentStatus(
  agentId: string,
  status: AgentStatus,
  reviewerId?: string,
): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: { status },
  });

  // 同步 User 状态（冻结代理时连带冻结账号）
  if (status === 'frozen') {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { user_id: true },
    });
    if (agent) {
      await prisma.user.update({
        where: { id: agent.user_id },
        data: { status: 'banned' },
      });
    }
  }

  // 审计日志
  await prisma.auditLog.create({
    data: {
      user_id: reviewerId ?? null,
      action: 'agent_status_update',
      target_type: 'agent',
      target_id: agentId,
      details: JSON.stringify({ status, reviewerId }),
    },
  });
}

/**
 * 调整代理佣金比例（超管或上级代理可调整）
 */
export async function updateCommissionRate(
  agentId: string,
  rate: number,
  operatorId: string,
): Promise<void> {
  if (rate < 0 || rate > 100) {
    throw new Error('待接入：佣金比例必须在 0~100 之间');
  }
  await prisma.agent.update({
    where: { id: agentId },
    data: { commission_rate: rate },
  });

  await prisma.auditLog.create({
    data: {
      user_id: operatorId,
      action: 'agent_commission_rate_update',
      target_type: 'agent',
      target_id: agentId,
      details: JSON.stringify({ rate, operatorId }),
    },
  });
}

/**
 * 列出某代理的直接下级
 */
export async function listSubAgents(parentAgentId: string) {
  return prisma.agent.findMany({
    where: { parent_id: parentAgentId },
    include: {
      user: { select: { id: true, email: true, nickname: true, status: true, created_at: true } },
    },
    orderBy: { created_at: 'desc' },
  });
}
