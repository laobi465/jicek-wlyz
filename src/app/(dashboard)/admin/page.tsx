"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { get, ApiError } from "@/lib/http";

/**
 * 超管概览 /admin
 *
 * - GET /api/dashboard → getSuperAdminDashboard 返回值
 *   { role, users: {total, developers, agents}, business: {apps, cards, orders},
 *     revenue: {today, thisMonth}, tickets: {open, inProgress, resolved, closed},
 *     withdrawals: {pendingCount, pendingAmount}, apkInjection: {pending, processing, success, failed} }
 *
 * revenue / withdrawals 金额字段为 Decimal 序列化的 string，前端 Number() 转换。
 */

interface SuperAdminDashboard {
  role: string;
  users: { total: number; developers: number; agents: number };
  business: { apps: number; cards: number; orders: number };
  revenue: { today: string; thisMonth: string };
  tickets: { open: number; inProgress: number; resolved: number; closed: number };
  withdrawals: { pendingCount: number; pendingAmount: string };
  apkInjection: {
    pending: number;
    processing: number;
    success: number;
    failed: number;
  };
}

function formatYuan(value: string): string {
  return Number(value).toFixed(2);
}

export default function AdminPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <AdminPageInner />
    </AuthGuard>
  );
}

function AdminPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<SuperAdminDashboard | null | undefined>(
    undefined,
  );

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const result = await get<SuperAdminDashboard>(user, "/api/dashboard");
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载超管概览失败");
      }
      setData(null);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="超管概览" subtitle="全平台运营数据总览" />
        <PageLoading />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="超管概览" subtitle="全平台运营数据总览" />
        <Card>
          <EmptyState
            title="暂无数据"
            description="无法加载超管概览数据，请稍后重试"
          />
        </Card>
      </div>
    );
  }

  const userCards = [
    { label: "用户总数", value: data.users.total, hint: "人" },
    { label: "开发者", value: data.users.developers, hint: "人" },
    { label: "代理", value: data.users.agents, hint: "人" },
  ];

  const businessCards = [
    { label: "应用总数", value: data.business.apps, hint: "个" },
    { label: "卡密总数", value: data.business.cards, hint: "张" },
    { label: "订单总数", value: data.business.orders, hint: "笔" },
  ];

  const revenueCards = [
    { label: "今日收入", value: formatYuan(data.revenue.today), hint: "元" },
    { label: "本月收入", value: formatYuan(data.revenue.thisMonth), hint: "元" },
    {
      label: "待审提现",
      value: formatYuan(data.withdrawals.pendingAmount),
      hint: `元 · ${data.withdrawals.pendingCount} 笔`,
    },
  ];

  const ticketCards = [
    { label: "待处理", value: data.tickets.open, hint: "单" },
    { label: "处理中", value: data.tickets.inProgress, hint: "单" },
    { label: "已解决", value: data.tickets.resolved, hint: "单" },
    { label: "已关闭", value: data.tickets.closed, hint: "单" },
  ];

  const apkCards = [
    { label: "排队中", value: data.apkInjection.pending, hint: "个" },
    { label: "处理中", value: data.apkInjection.processing, hint: "个" },
    { label: "成功", value: data.apkInjection.success, hint: "个" },
    { label: "失败", value: data.apkInjection.failed, hint: "个" },
  ];

  const quickLinks: { href: string; label: string }[] = [
    { href: "/admin/users", label: "用户管理" },
    { href: "/admin/revenue", label: "收入明细" },
    { href: "/admin/withdrawals", label: "提现审核" },
    { href: "/admin/config", label: "系统配置" },
    { href: "/admin/audit-logs", label: "审计日志" },
    { href: "/admin/update", label: "更新面板" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="超管概览" subtitle="全平台运营数据总览" />

      <StatsGroup title="用户规模" cards={userCards} />
      <StatsGroup title="业务规模" cards={businessCards} />
      <StatsGroup title="收入与提现" cards={revenueCards} />
      <StatsGroup title="工单状态" cards={ticketCards} />
      <StatsGroup title="APK 注入任务" cards={apkCards} />

      <Card>
        <CardHeader title="快捷入口" description="常用超管管理操作" />
        <CardBody>
          <div className="flex flex-wrap gap-3">
            {quickLinks.map((q) => (
              <Link key={q.href} href={q.href}>
                <Button variant="secondary" size="sm">
                  {q.label}
                </Button>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

interface StatsCard {
  label: string;
  value: number | string;
  hint: string;
}

function StatsGroup({ title, cards }: { title: string; cards: StatsCard[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <div key={c.label} className="flex flex-col gap-1">
              <span className="text-xs text-foreground-muted">{c.label}</span>
              <span className="text-2xl font-semibold text-foreground">
                {c.value}
                <span className="ml-1 text-xs font-normal text-foreground-muted">
                  {c.hint}
                </span>
              </span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
