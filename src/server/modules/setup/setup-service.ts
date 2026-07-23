import { prisma } from '@/lib/db';
import { hashPassword } from 'better-auth/crypto';
import { writeAuditLog, AuditAction } from '@/server/modules/audit/audit-service';

/**
 * 首次安装向导服务
 *
 * 职责：
 * 1. 检查系统是否需要初始化（数据库是否存在 super_admin）
 * 2. 创建首个超管账号（直接 prisma 创建 User + Account，用 Better Auth hashPassword）
 *
 * 安全设计：
 * - 创建前再次校验无超管（防并发/防滥用，避免向导被二次利用提权）
 * - 密码用 Better Auth 的 hashPassword（scrypt）hash 后存储
 * - 写审计日志记录初始化完成
 *
 * 实现说明：
 * 不调用 auth.api.signUpEmail 是因为该接口内部创建 User 时会把
 * passwordHash 字段当作必填，但邮箱密码模式的密码实际存在 Account.password。
 * 直接用 prisma 创建可绕开此字段映射冲突，密码 hash 仍用 Better Auth 的
 * scrypt 实现，登录时 verifyPassword 可正常校验。
 *
 * 业务规则（PROJECT.md §4.2）：
 * - 超管初始账号由首次安装向导设置，不写死在脚本，不环境变量
 */

const SUPER_ADMIN_ROLE = 'super_admin';

/**
 * 检查系统是否需要初始化
 *
 * @returns true 表示数据库无超管，需要执行安装向导
 */
export async function checkNeedsSetup(): Promise<boolean> {
  const count = await prisma.user.count({
    where: { role: SUPER_ADMIN_ROLE },
  });
  return count === 0;
}

/**
 * 创建首个超管账号
 *
 * 实现链路：
 * 1. 再次校验无超管（防并发）
 * 2. 校验邮箱唯一性（提前拦截，避免 Better Auth 抛错信息不友好）
 * 3. 用 Better Auth hashPassword（scrypt）生成密码 hash
 * 4. 直接 prisma 创建 User（role=super_admin）+ Account（provider=credential, password=hash）
 * 5. 写审计日志
 *
 * @param email 超管邮箱
 * @param password 超管密码（明文，由 Better Auth hashPassword hash 后存储）
 * @param name 超管用户名
 * @returns 创建的用户 ID
 */
export async function createFirstSuperAdmin(
  email: string,
  password: string,
  name: string,
): Promise<{ userId: string }> {
  // 1. 再次校验无超管（防并发）
  const needsSetup = await checkNeedsSetup();
  if (!needsSetup) {
    throw new SetupError('系统已初始化，禁止重复创建超管');
  }

  // 2. 校验邮箱唯一性
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new SetupError('该邮箱已被注册');
  }

  // 3. 用 Better Auth hashPassword（scrypt）生成密码 hash
  const passwordHash = await hashPassword(password);

  // 4. 直接 prisma 创建 User + Account（事务保证原子性）
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        nickname: name,
        password_hash: passwordHash,
        role: SUPER_ADMIN_ROLE,
      },
    });

    await tx.account.create({
      data: {
        user_id: newUser.id,
        provider: 'credential',
        provider_account_id: email,
        password: passwordHash,
      },
    });

    return newUser;
  });

  // 5. 写审计日志（记录首个超管创建，便于追溯）
  await writeAuditLog({
    userId: user.id,
    action: AuditAction.USER_ROLE_CHANGE,
    targetType: 'user',
    targetId: user.id,
    details: { action: 'first_super_admin_setup', email, name },
  });

  return { userId: user.id };
}

/**
 * 安装向导业务错误（携带用户可读文案）
 */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

