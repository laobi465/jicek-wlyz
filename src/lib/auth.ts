import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { toNextJsHandler } from 'better-auth/next-js';
import { prisma } from '@/lib/db';
import type { UserRole } from '@/types/auth';

/**
 * Better Auth 实例（惰性初始化）
 *
 * 重要：模块加载时不读取环境变量、不抛错、不创建实例。
 * 仅在首次实际访问属性时（运行时）才读取环境变量并创建实例。
 *
 * 原因：`next build` 的"收集页面数据"阶段会评估路由模块，
 * 链路 route → service → auth 会触发本模块加载。
 * 若在模块加载时立即 `betterAuth()` 或抛错，构建期就会失败
 * （构建环境无 BETTER_AUTH_SECRET）。
 *
 * 惰性化后：构建期不报错，运行时首次使用才校验（保留铁律 04 显式失败）。
 */

// 使用 any 类型避免 betterAuth 泛型推断与 admin 插件扩展类型不兼容
// （better-auth 库泛型层级极深，跨插件类型不可交换；运行时行为正确即可）
/* eslint-disable @typescript-eslint/no-explicit-any */
type AuthInstance = any;

/**
 * 创建 Better Auth 实例（运行时调用）
 *
 * 铁律 04：环境变量缺失时显式抛错
 */
function createAuth(): AuthInstance {
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
   *
   * 设计说明：
   * 不使用 admin 插件。admin 插件的 adminRoles 已被官方弃用，要求改用
   * access control + roles 对象（带 newRole），权限模型过重。
   * 本系统的超管鉴权全部走自研 /api/admin/* 路由（X-User-Role 头校验），
   * Better Auth 仅负责邮箱密码注册/登录/session，role 字段通过
   * user.additionalFields 声明（注册时默认 developer，由 setup/超管修改）。
   */
  return betterAuth({
    secret: betterAuthSecret,
    baseURL: betterAuthUrl,
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    emailAndPassword: {
      enabled: true,
    },
    // 用户模型字段映射：Better Auth 内部 camelCase → schema snake_case
    user: {
      fields: {
        name: 'nickname',
        emailVerified: 'email_verified',
        image: 'avatar',
        passwordHash: 'password_hash',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      // 额外字段：声明 role 字段，注册时默认 developer
      // Better Auth 会在 create User 时写入此字段（schema 已有 @default("developer")）
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'developer' satisfies UserRole,
          input: false, // 不允许客户端注册时自行设置 role（防提权）
        },
      },
    },
    // 会话模型字段映射
    session: {
      // 会话过期时间：7 天（单位：秒）
      expiresIn: 60 * 60 * 24 * 7,
      // 会话刷新周期：1 天（单位：秒）
      updateAge: 60 * 60 * 24,
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    // Account 模型字段映射
    account: {
      fields: {
        userId: 'user_id',
        providerId: 'provider',
        accountId: 'provider_account_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        accessTokenExpiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
  }) as AuthInstance;
}

let authInstance: AuthInstance | null = null;

/**
 * 获取/创建 Better Auth 单例（运行时首次调用）
 */
function getAuthInstance(): AuthInstance {
  if (authInstance) {
    return authInstance;
  }
  authInstance = createAuth();
  return authInstance;
}

/**
 * 惰性 Better Auth 实例
 *
 * 通过 Proxy 在首次属性访问时才创建真实实例。
 * 所有现有 `auth.xxx` 调用点无需改动。
 */
export const auth = new Proxy({} as AuthInstance, {
  get(_target, prop: string | symbol) {
    const instance = getAuthInstance();
    const value = Reflect.get(instance, prop);
    // 方法需绑定 this 指向实例（如 auth.handler / auth.api.*）
    return typeof value === 'function' ? (value as Function).bind(instance) : value;
  },
}) as AuthInstance;

/**
 * Better Auth 请求处理器（用于 catch-all 路由）— 惰性
 *
 * 每次调用时从单例获取 handler，确保首次调用触发实例创建。
 */
export const handler = (...args: any[]): any => {
  return getAuthInstance().handler(...args);
};

/**
 * Next.js App Router 路由处理器集合（GET / POST）— 惰性
 *
 * 构建期不创建实例；运行期首次请求时才创建。
 */
export const GET = (...args: any[]): any => {
  return (toNextJsHandler(getAuthInstance()).GET as any)(...args);
};

export const POST = (...args: any[]): any => {
  return (toNextJsHandler(getAuthInstance()).POST as any)(...args);
};

/**
 * 服务端调用方法（业务层直接调用 auth.api.* 亦可）— 惰性
 *
 * 通过 auth Proxy 转发，首次调用触发实例创建。
 */
export const signIn = (...args: any[]): any => {
  return getAuthInstance().api.signInEmail(...args);
};

export const signUp = (...args: any[]): any => {
  return getAuthInstance().api.signUpEmail(...args);
};

export const signOut = (...args: any[]): any => {
  return getAuthInstance().api.signOut(...args);
};

export const getSession = (...args: any[]): any => {
  return getAuthInstance().api.getSession(...args);
};
