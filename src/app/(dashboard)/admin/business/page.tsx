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
 * 业务总览 /admin/business
 *
 * - GET /api/dashboard → 复用 super_admin 维度，聚焦业务规模与运营指标
 *
 * 仅做只读展示，金额字段为 Decimal 序列化 string，前端 Number() 转换。
 */

interface DashboardData {
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

export default function BusinessOverviewPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <BusinessOverviewInner />
    </AuthGuard>
  );
}

function BusinessOverviewInner() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const result = await get<DashboardData>(user, "/api/dashboard");
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载业务总览失败");
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
        <PageHeader title="业务总览" subtitle="全平台应用 / 卡密 / 订单 / 工单指标" />
        <PageLoading />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="业务总览" subtitle="全平台应用 / 卡密 / 订单 / 工单指标" />
        <Card>
          <EmptyState
            title="暂无数据"
            description="无法加载业务总览数据，请稍后重试"
          />
        </Card>
      </div>
    );
  }

  const businessCards = [
    { label: "应用总数", value: data.business.apps, hint: "个", href: undefined },
    { label: "卡密总数", value: data.business.cards, hint: "张", href: undefined },
    { label: "订单总数", value: data.business.orders, hint: "笔", href: undefined },
    {
      label: "今日收入",
      value: formatYuan(data.revenue.today),
      hint: "元",
      href: "/admin/revenue",
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="业务总览" subtitle="全平台应用 / 卡密 / 订单 / 工单指标" />

      <Card>
        <CardHeader title="业务规模" description="应用、卡密、订单与今日收入" />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {businessCards.map((c) =>
              c.href ? (
                <Link key={c.label} href={c.href}>
                  <div className="flex flex-col gap-1 p-3 rounded-md border border-border hover:border-primary transition-colors">
                    <span className="text-xs text-foreground-muted">{c.label}</span>
                    <span className="text-2xl font-semibold text-foreground">
                      {c.value}
                      <span className="ml-1 text-xs font-normal text-foreground-muted">
                        {c.hint}
                      </span>
                    </span>
                  </div>
                </Link>
              ) : (
                <div key={c.label} className="flex flex-col gap-1">
                  <span className="text-xs text-foreground-muted">{c.label}</span>
                  <span className="text-2xl font-semibold text-foreground">
                    {c.value}
                    <span className="ml-1 text-xs font-normal text-foreground-muted">
                      {c.hint}
                    </span>
                  </span>
                </div>
              ),
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="工单分布"
          description="全平台工单状态统计"
          action={
            <Link href="/admin/tickets">
              <Button size="sm" variant="secondary">
                前往工单客服
              </Button>
            </Link>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ticketCards.map((c) => (
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

      <Card>
        <CardHeader title="APK 注入任务" description="注入任务状态统计" />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {apkCards.map((c) => (
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
    </div>
  );
}
