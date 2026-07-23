"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "./auth-provider";
import type { UserRole } from "@/lib/auth-client";

/**
 * 鉴权守卫
 *
 * - 未登录 → 重定向 /login
 * - 已登录但访问越权角色路由 → 重定向 /dashboard
 * - loading 期间显示极简加载态
 */

const ROLE_HOME: Record<UserRole, string> = {
  developer: "/developer",
  agent: "/agent",
  super_admin: "/admin",
};

const ROLE_PREFIX: Record<UserRole, string> = {
  developer: "/developer",
  agent: "/agent",
  super_admin: "/admin",
};

interface AuthGuardProps {
  /** 允许访问的角色，不传则允许任意已登录角色 */
  allow?: UserRole[];
  children: ReactNode;
}

export function AuthGuard({ allow, children }: AuthGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    // 角色路由隔离
    if (allow && !allow.includes(user.role as UserRole)) {
      const home = ROLE_HOME[user.role as UserRole] ?? "/dashboard";
      router.replace(home);
      return;
    }
    // 越权访问其他角色子路由（如 developer 访问 /admin）
    const role = user.role as UserRole;
    const ownPrefix = ROLE_PREFIX[role];
    if (
      ownPrefix &&
      pathname !== "/dashboard" &&
      pathname !== "/tickets" &&
      pathname !== "/notifications" &&
      pathname !== "/checkin" &&
      !pathname.startsWith(ownPrefix) &&
      (pathname.startsWith("/developer") ||
        pathname.startsWith("/agent") ||
        pathname.startsWith("/admin"))
    ) {
      router.replace(ownPrefix);
    }
  }, [user, loading, allow, router, pathname]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-foreground-muted">加载中</p>
        </div>
      </div>
    );
  }

  // 角色不匹配（守卫已触发重定向，这里返回 null 避免越权内容闪烁）
  if (allow && !allow.includes(user.role as UserRole)) {
    return null;
  }

  return <>{children}</>;
}
