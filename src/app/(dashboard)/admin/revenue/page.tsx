"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  EmptyRow,
} from "@/components/ui/table";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, ApiError } from "@/lib/http";

/**
 * 收入明细 /admin/revenue
 *
 * - GET /api/admin/revenue → { summary: { today, thisMonth, total }, recentPayments: [...] }
 *
 * amount 字段为 Decimal 序列化 string，前端 Number() 转换。
 */

interface RevenueSummary {
  today: string;
  thisMonth: string;
  total: string;
}

interface RecentPayment {
  id: string;
  amount: string;
  method: string;
  trade_no: string | null;
  order_id: string | null;
  created_at: string;
  user_email: string;
}

interface RevenueData {
  summary: RevenueSummary;
  recentPayments: RecentPayment[];
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  epay: "彩虹易支付",
};

function formatYuan(value: string): string {
  return Number(value).toFixed(2);
}

export default function RevenuePage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <RevenuePageInner />
    </AuthGuard>
  );
}

function RevenuePageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<RevenueData | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const result = await get<RevenueData>(user, "/api/admin/revenue");
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载收入明细失败");
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
        <PageHeader title="收入明细" subtitle="全平台成功支付汇总与最近支付记录" />
        <PageLoading />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="收入明细" subtitle="全平台成功支付汇总与最近支付记录" />
        <Card>
          <EmptyState
            title="暂无数据"
            description="无法加载收入明细，请稍后重试"
          />
        </Card>
      </div>
    );
  }

  const summaryCards = [
    { label: "今日收入", value: formatYuan(data.summary.today), hint: "元" },
    { label: "本月收入", value: formatYuan(data.summary.thisMonth), hint: "元" },
    { label: "累计收入", value: formatYuan(data.summary.total), hint: "元" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="收入明细" subtitle="全平台成功支付汇总与最近支付记录" />

      <Card>
        <CardHeader title="收入汇总" description="仅统计 status=success 的支付" />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {summaryCards.map((c) => (
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
        <CardHeader
          title="最近支付记录"
          description="最近 20 条成功支付记录"
        />
        <Table>
          <THead>
            <TR>
              <TH>金额</TH>
              <TH>支付方式</TH>
              <TH>第三方交易号</TH>
              <TH>订单 ID</TH>
              <TH>支付用户</TH>
              <TH>支付时间</TH>
            </TR>
          </THead>
          <TBody>
            {data.recentPayments.length > 0 ? (
              data.recentPayments.map((p) => (
                <TR key={p.id}>
                  <TD className="text-foreground font-medium whitespace-nowrap">
                    {formatYuan(p.amount)} 元
                  </TD>
                  <TD className="text-foreground-muted">
                    {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  </TD>
                  <TD className="text-foreground-muted text-xs break-all">
                    {p.trade_no || "-"}
                  </TD>
                  <TD className="text-foreground-muted text-xs break-all">
                    {p.order_id || "-"}
                  </TD>
                  <TD className="text-foreground break-all">{p.user_email}</TD>
                  <TD className="text-foreground-muted text-xs whitespace-nowrap">
                    {formatDateTime(p.created_at)}
                  </TD>
                </TR>
              ))
            ) : (
              <EmptyRow colSpan={6} message="暂无支付记录" />
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
