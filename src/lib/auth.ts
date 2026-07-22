import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin } from 'better-auth/plugins/admin';
import { toNextJsHandler } from 'better-auth/next-js';
import { prisma } from '@/lib/db';
import type { UserRole } from '@/types/auth';

// 从环境变量读取鉴权配置，禁止硬编码
const betterAuthSecret = process.env.BETTER_AUTH_SECRET;
const betterAuthUrl = process.env.BETTER_AUTH_URL;

if (!betterAuthSecret) {
  throw new Error('待接入：环境变量 BETTER_AUTH_SECRET 未配置');
}
if (!betterAuthUrl) {
  throw new Error('待接入：环境变量 BETTER_AUTH_URL 未配置');
}

/**
 * Better Auth 实例
 * - 数据库适配器：Prisma（PostgreSQL）
 * - 邮箱密码认证
 * - 三角色 RBAC：super_admin / agent / developer
 * - Session 策略：7 天过期，每 1 天刷新一次
 */
export const auth = betterAuth({
  secret: betterAuthSecret,
  baseURL: betterAuthUrl,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    // 会话过期时间：7 天（单位：秒）
    expiresIn: 60 * 60 * 24 * 7,
    // 会话刷新周期：1 天（单位：秒）
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    admin({
      // 新注册用户默认角色为开发者
      defaultRole: 'developer' satisfies UserRole,
      // 仅超管为管理角色，可访问 admin 接口；agent / developer 为普通角色
      adminRoles: ['super_admin'],
    }),
  ],
});

// Better Auth 请求处理器（用于 catch-all 路由）
export const handler = auth.handler;

// Next.js App Router 路由处理器集合（GET / POST）
export const { GET, POST } = toNextJsHandler(auth);

// 服务端调用方法（业务层直接调用 auth.api.* 亦可）
export const signIn = auth.api.signInEmail;
export const signUp = auth.api.signUpEmail;
export const signOut = auth.api.signOut;
export const getSession = auth.api.getSession;
