import { prisma } from '@/lib/db';
import { randomBytes } from 'crypto';

/**
 * 邀请码服务（SPEC §2.6.4 代理分销模块）
 *
 * 职责：
 * 1. 生成邀请码（开发者邀请开发者 / 上级代理邀请下级代理）
 * 2. 校验邀请码有效性（未使用 / 未过期 / 限量未满）
 * 3. 消费邀请码（注册时绑定使用者，事务保证一致性）
 *
 * 业务规则（PROJECT.md §2.3）：
 * - 开发者由三级代理（C）邀请，凭 agent 类型邀请码注册
 * - 一级代理（A）由超管邀请，二级（B）由 A 邀请，三级（C）由 B 邀请
 * - 邀请码类型：developer / agent
 * - 使用模式：once 一次性 / reusable 可复用 / limited 限量
 *
 * 安全设计：
 * - 邀请码 32 字节随机熵（hex 64 位），防爆破
 * - 消费走数据库事务，防止并发抢用
 */

/** 邀请码字符集（hex）+ 长度，提供 ≥ 128 bit 熵 */
const INVITE_CODE_BYTES = 16;

/** 邀请码类型 */
export type InvitationType = 'developer' | 'agent';

/** 使用模式 */
export type UsageMode = 'once' | 'reusable' | 'limited';

/** 生成邀请码入参 */
export interface GenerateInvitationParams {
  /** 生成者 ID（超管 / 代理 / 开发者） */
  generatorId: string;
  /** 类型：developer 邀请开发者 / agent 邀请代理 */
  type: InvitationType;
  /** 代理层级（type=agent 时有效，1/2/3） */
  targetLevel?: number;
  /** 使用模式 */
  usageMode?: UsageMode;
  /** 限量使用次数（usage_mode=limited 时有效） */
  maxUses?: number;
  /** 有效期（天，null=永久） */
  expiresInDays?: number | null;
}

/**
 * 生成邀请码（32 hex 字符，128 bit 熵）
 *
 * 使用 crypto.randomBytes 防止伪随机预测
 */
export function generateCode(): string {
  return randomBytes(INVITE_CODE_BYTES).toString('hex');
}

/**
 * 创建邀请码
 *
 * 校验：
 * - generatorId 必须存在
 * - type=agent 时 targetLevel 必填且 ∈ {1,2,3}
 * - usage_mode=limited 时 maxUses 必填且 > 0
 *
 * 代理层级校验（PROJECT.md §2.3）：
 * - 超管（role=super_admin）可生成 level=1 的 agent 邀请码
 * - 一级代理（agent_level=1）可生成 level=2 的 agent 邀请码
 * - 二级代理（agent_level=2）可生成 level=3 的 agent 邀请码
 * - 三级代理（agent_level=3）只能生成 developer 邀请码（不能再发展下级代理）
 */
export async function createInvitation(params: GenerateInvitationParams) {
  // 类型为 agent 时，targetLevel 必填
  if (params.type === 'agent') {
    if (params.targetLevel === undefined) {
      throw new Error('待接入：type=agent 时必须指定 targetLevel');
    }
    if (![1, 2, 3].includes(params.targetLevel)) {
      throw new Error('待接入：targetLevel 必须为 1/2/3');
    }
  }

  // limited 模式必须指定 maxUses
  if (params.usageMode === 'limited' && (!params.maxUses || params.maxUses <= 0)) {
    throw new Error('待接入：usage_mode=limited 时 maxUses 必须 > 0');
  }

  // 校验生成者权限：代理生成 agent 邀请码时，自身层级必须比 targetLevel 高一级
  if (params.type === 'agent' && params.targetLevel !== undefined) {
    const generator = await prisma.user.findUnique({
      where: { id: params.generatorId },
      select: { role: true, agent_level: true },
    });
    if (!generator) {
      throw new Error('待接入：生成者用户不存在');
    }

    // 超管可生成 level=1
    if (generator.role === 'super_admin') {
      if (params.targetLevel !== 1) {
        throw new Error('待接入：超管仅可生成一级代理邀请码');
      }
    } else if (generator.role === 'agent') {
      // 代理只能邀请比自己低一级的代理
      if (generator.agent_level === null) {
        throw new Error('待接入：生成者代理层级未设置');
      }
      if (params.targetLevel !== generator.agent_level + 1) {
        throw new Error('待接入：代理只能邀请比自己低一级的下级代理');
      }
      if (params.targetLevel > 3) {
        throw new Error('待接入：代理层级已超限（最多 3 层）');
      }
    } else {
      throw new Error('待接入：开发者无权生成代理邀请码');
    }
  }

  const code = generateCode();
  const expiresAt =
    params.expiresInDays === null || params.expiresInDays === undefined
      ? null
      : new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000);

  return prisma.invitationCode.create({
    data: {
      code,
      generator_id: params.generatorId,
      type: params.type,
      target_level: params.targetLevel ?? null,
      usage_mode: params.usageMode ?? 'once',
      max_uses: params.maxUses ?? null,
      used_count: 0,
      expires_at: expiresAt,
    },
  });
}

/**
 * 校验邀请码有效性（不消费）
 *
 * 返回 true 表示可用，false 表示不可用
 *
 * 不可用原因：不存在 / 已使用（once 模式） / 已过期 / 限量已满
 */
export async function validateInvitation(code: string): Promise<boolean> {
  const invitation = await prisma.invitationCode.findUnique({
    where: { code },
  });
  if (!invitation) return false;

  // once 模式：已使用即无效
  if (invitation.usage_mode === 'once' && invitation.user_id !== null) {
    return false;
  }

  // limited 模式：已达上限
  if (
    invitation.usage_mode === 'limited' &&
    invitation.max_uses !== null &&
    invitation.used_count >= invitation.max_uses
  ) {
    return false;
  }

  // 已过期
  if (invitation.expires_at !== null && invitation.expires_at < new Date()) {
    return false;
  }

  return true;
}

/**
 * 查询邀请码详情（含生成者信息）
 */
export async function getInvitationByCode(code: string) {
  return prisma.invitationCode.findUnique({
    where: { code },
    include: {
      generator: { select: { id: true, nickname: true, email: true, role: true } },
    },
  });
}

/**
 * 消费邀请码（注册时绑定使用者）
 *
 * 事务保证：
 * 1. 二次校验有效性（防并发抢用）
 * 2. once 模式：绑定 user_id，记录 used_at
 * 3. reusable / limited 模式：递增 used_count
 *
 * @throws 邀请码无效时抛错（业务层映射为 ErrorCode.AGENT_CODE_INVALID = 6001）
 */
export async function consumeInvitation(
  code: string,
  userId: string,
): Promise<{ targetLevel: number | null; type: InvitationType; generatorId: string }> {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitationCode.findUnique({
      where: { code },
    });
    if (!invitation) {
      throw new Error('待接入：邀请码不存在');
    }

    // 二次校验（事务内）
    if (invitation.usage_mode === 'once' && invitation.user_id !== null) {
      throw new Error('待接入：邀请码已被使用');
    }
    if (
      invitation.usage_mode === 'limited' &&
      invitation.max_uses !== null &&
      invitation.used_count >= invitation.max_uses
    ) {
      throw new Error('待接入：邀请码使用次数已达上限');
    }
    if (invitation.expires_at !== null && invitation.expires_at < new Date()) {
      throw new Error('待接入：邀请码已过期');
    }

    // once 模式绑定使用者；其余模式仅递增 used_count
    if (invitation.usage_mode === 'once') {
      await tx.invitationCode.update({
        where: { id: invitation.id },
        data: {
          user_id: userId,
          used_at: new Date(),
          used_count: { increment: 1 },
        },
      });
    } else {
      await tx.invitationCode.update({
        where: { id: invitation.id },
        data: {
          used_count: { increment: 1 },
          used_at: new Date(),
        },
      });
    }

    return {
      targetLevel: invitation.target_level,
      type: invitation.type as InvitationType,
      generatorId: invitation.generator_id,
    };
  });
}

/**
 * 列出某生成者的邀请码（用于后台展示）
 */
export async function listInvitationsByGenerator(generatorId: string) {
  return prisma.invitationCode.findMany({
    where: { generator_id: generatorId },
    include: {
      user: { select: { id: true, nickname: true, email: true } },
    },
    orderBy: { created_at: 'desc' },
  });
}
