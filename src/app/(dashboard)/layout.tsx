"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * (dashboard) 路由组布局
 *
 * 已登录用户专属区域：
 * - 左侧：角色感知侧边栏（桌面端常驻 / 移动端抽屉）
 * - 顶部：通知红点 + 用户菜单 + 移动端汉堡按钮
 * - 中间：路由内容（被 AuthGuard 包裹）
 *
 * 移动端抽屉开关 state 提升到本层，供 Topbar（开）与 Sidebar（关）共享。
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-background-subtle">
        <Sidebar
          mobileNavOpen={mobileNavOpen}
          onMobileNavClose={() => setMobileNavOpen(false)}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar onMenuClick={() => setMobileNavOpen(true)} />
          <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
