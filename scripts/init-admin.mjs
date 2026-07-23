/**
 * 默认超管账号初始化脚本（容器启动时自动执行）
 *
 * 用途：
 * 替代原 /setup 安装向导。app 容器首次启动时，在 prisma db push 之后、
 * node server.js 之前执行本脚本，自动创建默认超管账号。
 *
 * 默认账密（PROJECT.md §4.2）：
 * - 邮箱：admin@example.com
 * - 密码：admin123
 *
 * 安全提示：
 * - 默认密码较弱，部署后请立即登录修改
 * - 脚本幂等：已存在超管时跳过，不会重复创建或覆盖
 *
 * 密码 hash 格式与 better-auth/crypto 的 hashPassword 完全一致
 * （salt:hex(16字节) + scrypt N=16384,r=16,p=1,dkLen=64），
 * 登录时 better-auth 的 verifyPassword 可正常校验。
 *
 * 运行：node scripts/init-admin.mjs
 * 退出码：0=成功（已存在或新建），1=失败
 */

import { PrismaClient } from '@prisma/client';
import { scryptSync, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const DEFAULT_EMAIL = 'admin@example.com';
const DEFAULT_PASSWORD = 'admin123';
const DEFAULT_NAME = '超级管理员';
const SUPER_ADMIN_ROLE = 'super_admin';

/**
 * 生成密码 hash（与 better-auth/crypto hashPassword 格式兼容）
 *
 * 格式：salt(16字节 hex):key(64字节 hex)
 * scrypt 参数：N=16384, r=16, p=1, dkLen=64, maxmem=128*N*r*2
 */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password.normalize('NFKC'), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  });
  return `${salt}:${key.toString('hex')}`;
}

async function main() {
  console.log('[init-admin] 检查超管账号...');

  // 幂等：已存在超管则跳过
  const count = await prisma.user.count({
    where: { role: SUPER_ADMIN_ROLE },
  });
  if (count > 0) {
    console.log('[init-admin] 已存在超管账号，跳过初始化');
    return;
  }

  // 邮箱已被占用（非超管）则跳过，避免冲突
  const existing = await prisma.user.findUnique({
    where: { email: DEFAULT_EMAIL },
  });
  if (existing) {
    console.log(
      `[init-admin] 邮箱 ${DEFAULT_EMAIL} 已存在但非超管角色，跳过初始化（请手动处理）`,
    );
    return;
  }

  // 创建默认超管 User + Account（事务保证原子性）
  const passwordHash = hashPassword(DEFAULT_PASSWORD);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: DEFAULT_EMAIL,
        nickname: DEFAULT_NAME,
        password_hash: passwordHash,
        role: SUPER_ADMIN_ROLE,
      },
    });

    await tx.account.create({
      data: {
        user_id: user.id,
        provider: 'credential',
        provider_account_id: DEFAULT_EMAIL,
        password: passwordHash,
      },
    });
  });

  console.log('[init-admin] ✅ 默认超管账号创建成功');
  console.log(`[init-admin]    邮箱 : ${DEFAULT_EMAIL}`);
  console.log(`[init-admin]    密码 : ${DEFAULT_PASSWORD}`);
  console.log('[init-admin] ⚠️  默认密码较弱，请登录后立即修改！');
}

main()
  .catch((e) => {
    console.error('[init-admin] ❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
