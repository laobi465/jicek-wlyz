"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { UserRole } from "@/lib/auth-client";

/**
 * 角色感知侧边栏
 *
 * 三角色共享入口：仪表盘 / 工单 / 通知 / 签到
 * 角色专属入口：
 * - developer: 应用 / 卡密 / 设备 / 云变量 / APK 注入 / 接入中心 / 店铺 / 套餐（M8.1 已完成）
 * - agent: 下级代理 / 邀请码 / 佣金明细 / 提现申请（M8.2 已完成）
 * - super_admin: 用户管理 / 业务总览 / 收入 / 提现审核 / 工单客服 / 系统配置 / 审计 / 2FA / 更新（M8.3 已完成）
 */

interface NavItem {
  href: string;
  label: string;
  /** 角色专属（不传则所有角色可见） */
  roles?: UserRole[];
  /** 尚未实现，置灰显示 */
  comingSoon?: boolean;
}

const COMMON_NAV: NavItem[] = [
  { href: "/dashboard", label: "概览" },
  { href: "/tickets", label: "工单" },
  { href: "/notifications", label: "通知" },
  { href: "/checkin", label: "签到" },
];

const DEVELOPER_NAV: NavItem[] = [
  { href: "/developer", label: "开发者概览" },
  { href: "/developer/apps", label: "应用管理" },
  { href: "/developer/cards", label: "卡密管理" },
  { href: "/developer/devices", label: "设备管理" },
  { href: "/developer/cloud-variables", label: "云变量" },
  { href: "/developer/apk-injection", label: "APK 注入" },
  { href: "/developer/access", label: "接入中心" },
  { href: "/developer/shop", label: "店铺商品" },
  { href: "/developer/packages", label: "套餐充值" },
];

const AGENT_NAV: NavItem[] = [
  { href: "/agent", label: "代理概览" },
  { href: "/agent/subordinates", label: "下级代理" },
  { href: "/agent/invitations", label: "邀请码" },
  { href: "/agent/commission", label: "佣金明细" },
  { href: "/agent/withdrawals", label: "提现申请" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "超管概览" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/business", label: "业务总览" },
  { href: "/admin/revenue", label: "收入明细" },
  { href: "/admin/withdrawals", label: "提现审核" },
  { href: "/admin/tickets", label: "工单客服" },
  { href: "/admin/config", label: "系统配置" },
  { href: "/admin/audit-logs", label: "审计日志" },
  { href: "/admin/security", label: "2FA 与 IP 白名单" },
  { href: "/admin/update", label: "更新面板" },
];

const ROLE_NAV: Record<UserRole, NavItem[]> = {
  developer: DEVELOPER_NAV,
  agent: AGENT_NAV,
  super_admin: ADMIN_NAV,
};

const ROLE_LABEL: Record<UserRole, string> = {
  developer: "开发者",
  agent: "代理",
  super_admin: "超级管理员",
};

export function Sidebar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const role = (user?.role as UserRole) ?? "developer";
  const roleNav = ROLE_NAV[role] ?? [];

  return (
    <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-border bg-white h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">
          网络验证控制台
        </h1>
        <p className="text-xs text-foreground-muted mt-1">
          {ROLE_LABEL[role]}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        <NavSection title="通用" items={COMMON_NAV} pathname={pathname} />
        <NavSection title={ROLE_LABEL[role]} items={roleNav} pathname={pathname} />
      </nav>
    </aside>
  );
}

function NavSection({
  title,
  items,
  pathname,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="mb-4">
      <p className="px-5 py-1 text-xs font-medium text-foreground-muted uppercase tracking-wide">
        {title}
      </p>
      <ul className="mt-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const cls = `flex items-center justify-between px-5 py-2 text-sm transition-colors ${
            active
              ? "bg-primary-subtle text-primary font-medium border-r-2 border-primary"
              : "text-foreground hover:bg-background-subtle"
          } ${item.comingSoon ? "opacity-60 cursor-not-allowed" : ""}`;

          if (item.comingSoon) {
            return (
              <li key={item.href}>
                <span className={cls} title="即将上线">
                  <span>{item.label}</span>
                  <span className="text-[10px] text-foreground-muted">
                    待上线
                  </span>
                </span>
              </li>
            );
          }
          return (
            <li key={item.href}>
              <Link href={item.href} className={cls}>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
