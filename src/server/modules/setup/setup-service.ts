import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { writeAuditLog, AuditAction } from '@/server/modules/audit/audit-service';

/**
 * 首次安装向导服务
 *
 * 职责：
 * 1. 检查系统是否需要初始化（数据库是否存在 super_admin）
 * 2. 创建首个超管账号（Better Auth signUpEmail 处理密码 hash + prisma 更新 role）
 *
 * 安全设计：
 * - 创建前再次校验无超管（防并发/防滥用，避免向导被二次利用提权）
 * - 创建后清理自动生成的 session（首次安装不自动登录，要求超管手动登录验证凭据）
 * - 写审计日志记录初始化完成
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
 * 3. 调用 Better Auth signUpEmail 创建用户（自动 scrypt hash 密码）
 * 4. 更新角色为 super_admin（signUpEmail 默认创建 developer）
 * 5. 清理可能创建的 session（首次安装不自动登录）
 * 6. 写审计日志
 *
 * @param email 超管邮箱
 * @param password 超管密码（明文，由 Better Auth hash 后存储）
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

  // 3. 调用 Better Auth signUpEmail 创建用户（自动处理密码 hash）
  //    server-side 调用不传 headers，不会设置 session cookie 到客户端
  //    但数据库仍会创建 session 记录，后续清理
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await auth.api.signUpEmail({
    body: { email, password, name },
  });

  const userId: string | undefined = result?.user?.id;
  if (!userId) {
    throw new SetupError('创建用户失败，Better Auth 未返回用户 ID');
  }

  // 4. 更新角色为 super_admin（signUpEmail 默认创建 developer）
  await prisma.user.update({
    where: { id: userId },
    data: { role: SUPER_ADMIN_ROLE },
  });

  // 5. 清理可能创建的 session（首次安装不自动登录，要求超管手动登录验证凭据）
  await prisma.session.deleteMany({ where: { user_id: userId } });

  // 6. 写审计日志（记录首个超管创建，便于追溯）
  await writeAuditLog({
    userId,
    action: AuditAction.USER_ROLE_CHANGE,
    targetType: 'user',
    targetId: userId,
    details: { action: 'first_super_admin_setup', email, name },
  });

  return { userId };
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
