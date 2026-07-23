"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { ConfirmModal } from "@/components/ui/modal";
import { get } from "@/lib/http";

/**
 * 顶栏
 *
 * - 左：移动端汉堡菜单（M8.0 暂不实现抽屉，仅占位）+ 当前路径标题
 * - 右：通知红点（轮询 /api/notifications/unread-count）+ 用户菜单（退出）
 */

export function Topbar() {
  const { user, signOutAndRedirect } = useAuth();
  const [unread, setUnread] = useState(0);
  const [signOutOpen, setSignOutOpen] = useState(false);

  // 轮询未读通知数（30s 一次）
  useEffect(() => {
    if (!user) return;
    let timer: number | null = null;
    const fetchUnread = async () => {
      try {
        // API 返回 { count }（见 /api/notifications/unread-count/route.ts）
        const data = await get<{ count: number }>(
          user,
          "/api/notifications/unread-count",
        );
        setUnread(data?.count ?? 0);
      } catch {
        // 静默失败，不打扰用户
      }
    };
    fetchUnread();
    timer = window.setInterval(fetchUnread, 30000);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [user]);

  return (
    <header className="sticky top-0 z-30 h-14 flex items-center justify-between px-4 md:px-6 border-b border-border bg-white">
      <div className="flex items-center gap-3">
        <span className="md:hidden text-foreground-muted text-lg leading-none">
          &#9776;
        </span>
        <span className="text-sm font-medium text-foreground">
          {user?.name ?? user?.email ?? "用户"}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <Link
          href="/notifications"
          className="relative inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-background-subtle transition-colors"
          title="通知"
        >
          <span className="text-sm text-foreground">通知</span>
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-medium">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>

        <button
          type="button"
          onClick={() => setSignOutOpen(true)}
          className="text-sm text-foreground-muted hover:text-danger transition-colors"
        >
          退出
        </button>
      </div>

      <ConfirmModal
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        onConfirm={() => {
          setSignOutOpen(false);
          signOutAndRedirect();
        }}
        title="退出登录"
        message="确定要退出当前账号吗？"
        confirmText="退出"
        danger
      />
    </header>
  );
}
