import { createAuthClient } from "better-auth/react";

/**
 * Better Auth 客户端单例
 *
 * - 自动以同源 /api/auth/* 为端点
 * - 提供 useSession() / signIn / signOut 等 React hook 与方法
 * - admin 插件在 user 上注入 role 字段
 */
export const authClient = createAuthClient();

/** 项目三角色（与 types/auth.ts UserRole 一致） */
export type UserRole = "super_admin" | "agent" | "developer";

/** Better Auth session.user 形状（admin 插件注入 role） */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  role?: string;
}

/** Better Auth session 形状 */
export interface Session {
  user: SessionUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}
