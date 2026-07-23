"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { UserRole } from "@/lib/auth-client";

/**
 * /dashboard 重定向页
 *
 * 已登录用户访问 /dashboard 时，按角色重定向到对应子仪表盘：
 * - developer → /developer
 * - agent → /agent
 * - super_admin → /admin
 */
const ROLE_HOME: Record<UserRole, string> = {
  developer: "/developer",
  agent: "/agent",
  super_admin: "/admin",
};

export default function DashboardRedirect() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    const home = ROLE_HOME[user.role as UserRole] ?? "/developer";
    router.replace(home);
  }, [user, loading, router]);

  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="flex flex-col items-center gap-3">
        <span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-foreground-muted">正在跳转</p>
      </div>
    </div>
  );
}
