"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  EmptyRow,
} from "@/components/ui/table";
import { PageHeader, PageLoading } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, ApiError } from "@/lib/http";

/**
 * 佣金明细 /agent/commission
 *
 * - GET /api/agent/balance → { totalCommission, withdrawnAmount, pendingAmount, available }（number）
 * - GET /api/withdrawals?status=&limit=20&offset=0 → { withdrawals, total }（提现记录作为佣金流水）
 */

interface AgentBalance {
  totalCommission: number;
  withdrawnAmount: number;
  pendingAmount: number;
  available: number;
}

interface PayoutAccount {
  type: string;
  account: string;
  name: string;
  bank?: string;
}

interface Withdrawal {
  id: string;
  agent_id: string;
  amount: string;
  status: string;
  payout_account: string;
  reviewer_id: string | null;
  reject_reason: string | null;
  payout_trade_no: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

interface ListResponse {
  withdrawals: Withdrawal[];
  total: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "paid", label: "已打款" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  paid: "已打款",
};

const STATUS_VARIANT: Record<
  string,
  "warning" | "info" | "danger" | "success" | "default"
> = {
  pending: "warning",
  approved: "info",
  rejected: "danger",
  paid: "success",
};

const PAYOUT_TYPE_LABEL: Record<string, string> = {
  alipay: "支付宝",
  wxpay: "微信",
  bank: "银行卡",
};

function formatYuan(value: number): string {
  return Number(value).toFixed(2);
}

/** 安全解析 payout_account JSON 字符串 */
function parsePayoutAccount(raw: string): PayoutAccount | null {
  try {
    const parsed = JSON.parse(raw) as PayoutAccount;
    if (parsed && typeof parsed.type === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export default function CommissionPage() {
  return (
    <AuthGuard allow={["agent"]}>
      <CommissionPageInner />
    </AuthGuard>
  );
}

function CommissionPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [balance, setBalance] = useState<AgentBalance | null>(null);
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBalance = useCallback(async () => {
    if (!user) return;
    try {
      const b = await get<AgentBalance>(user, "/api/agent/balance");
      setBalance(b);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载余额失败");
      }
    }
  }, [user, toast]);

  const loadList = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/withdrawals", {
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载提现记录失败");
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, status, offset, toast]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    setOffset(0);
  }, [status]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const cards = [
    {
      label: "累计佣金",
      value: balance ? formatYuan(balance.totalCommission) : "-",
    },
    {
      label: "已提现",
      value: balance ? formatYuan(balance.withdrawnAmount) : "-",
    },
    {
      label: "审核中",
      value: balance ? formatYuan(balance.pendingAmount) : "-",
    },
    {
      label: "可提现",
      value: balance ? formatYuan(balance.available) : "-",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="佣金明细"
        subtitle="查看佣金余额与提现流水"
        action={
          <Link href="/agent/withdrawals">
            <Button size="sm">申请提现</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardBody className="flex flex-col gap-1">
              <span className="text-xs text-foreground-muted">{c.label}</span>
              <span className="text-2xl font-semibold text-foreground">
                {c.value}
                <span className="ml-1 text-xs font-normal text-foreground-muted">
                  元
                </span>
              </span>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-32"
            aria-label="按状态筛选"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <span className="text-xs text-foreground-muted">共 {total} 条</span>
        </div>

        {loading ? (
          <PageLoading />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>金额</TH>
                <TH>状态</TH>
                <TH>收款账户</TH>
                <TH>申请时间</TH>
                <TH>审核时间</TH>
                <TH>打款时间</TH>
                <TH>驳回原因</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.withdrawals.length > 0 ? (
                data.withdrawals.map((w) => {
                  const payout = parsePayoutAccount(w.payout_account);
                  return (
                    <TR key={w.id}>
                      <TD className="text-foreground font-medium">
                        {Number(w.amount).toFixed(2)} 元
                      </TD>
                      <TD>
                        <Badge variant={STATUS_VARIANT[w.status] ?? "default"}>
                          {STATUS_LABEL[w.status] ?? w.status}
                        </Badge>
                      </TD>
                      <TD className="text-xs">
                        {payout ? (
                          <span className="break-all">
                            {PAYOUT_TYPE_LABEL[payout.type] ?? payout.type}
                            {payout.account ? ` · ${payout.account}` : ""}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TD>
                      <TD className="text-foreground-muted text-xs whitespace-nowrap">
                        {formatDateTime(w.created_at)}
                      </TD>
                      <TD className="text-foreground-muted text-xs whitespace-nowrap">
                        {formatDateTime(w.reviewed_at)}
                      </TD>
                      <TD className="text-foreground-muted text-xs whitespace-nowrap">
                        {formatDateTime(w.paid_at)}
                      </TD>
                      <TD className="text-xs text-danger break-all">
                        {w.reject_reason || "-"}
                      </TD>
                    </TR>
                  );
                })
              ) : (
                <EmptyRow colSpan={7} message="暂无提现记录" />
              )}
            </TBody>
          </Table>
        )}
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            上一页
          </Button>
          <span className="text-xs text-foreground-muted">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
