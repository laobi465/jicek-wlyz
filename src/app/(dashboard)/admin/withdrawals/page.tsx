"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
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
import { get, post, ApiError } from "@/lib/http";

/**
 * 提现审核 /admin/withdrawals
 *
 * - GET /api/admin/withdrawals?agentUserId=&status=&limit=20&offset= → { withdrawals, total }
 * - POST /api/admin/withdrawals/[id]/approve
 * - POST /api/admin/withdrawals/[id]/reject { reason }
 * - POST /api/admin/withdrawals/[id]/paid { payoutTradeNo }
 *
 * amount 字段为 Decimal 序列化 string，前端 Number() 转换。
 * payout_account 为 JSON 字符串，需 parse。
 */

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

interface PayoutAccount {
  type: string;
  account: string;
  name: string;
  bank?: string;
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

export default function AdminWithdrawalsPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <AdminWithdrawalsPageInner />
    </AuthGuard>
  );
}

function AdminWithdrawalsPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState("");
  const [agentUserId, setAgentUserId] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 驳回弹窗
  const [rejectTarget, setRejectTarget] = useState<Withdrawal | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState("");

  // 打款弹窗
  const [paidTarget, setPaidTarget] = useState<Withdrawal | null>(null);
  const [payoutTradeNo, setPayoutTradeNo] = useState("");
  const [paidSubmitting, setPaidSubmitting] = useState(false);
  const [paidError, setPaidError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/admin/withdrawals", {
        agentUserId: agentUserId || undefined,
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
  }, [user, agentUserId, status, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [status, agentUserId]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  async function onApprove(w: Withdrawal) {
    if (!user) return;
    if (!window.confirm(`确认通过提现申请 ${Number(w.amount).toFixed(2)} 元？`)) {
      return;
    }
    try {
      await post(user, `/api/admin/withdrawals/${w.id}/approve`);
      toast.success("已通过提现申请");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("审核通过失败");
      }
    }
  }

  function openRejectModal(w: Withdrawal) {
    setRejectTarget(w);
    setRejectReason("");
    setRejectError("");
  }

  async function onConfirmReject() {
    if (!user || !rejectTarget) return;
    if (!rejectReason.trim()) {
      setRejectError("请输入驳回原因");
      return;
    }
    setRejectSubmitting(true);
    try {
      await post(user, `/api/admin/withdrawals/${rejectTarget.id}/reject`, {
        reason: rejectReason.trim(),
      });
      toast.success("已驳回提现申请");
      setRejectTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("驳回失败");
      }
    } finally {
      setRejectSubmitting(false);
    }
  }

  function openPaidModal(w: Withdrawal) {
    setPaidTarget(w);
    setPayoutTradeNo("");
    setPaidError("");
  }

  async function onConfirmPaid() {
    if (!user || !paidTarget) return;
    if (!payoutTradeNo.trim()) {
      setPaidError("请输入第三方打款流水号");
      return;
    }
    setPaidSubmitting(true);
    try {
      await post(user, `/api/admin/withdrawals/${paidTarget.id}/paid`, {
        payoutTradeNo: payoutTradeNo.trim(),
      });
      toast.success("已标记打款");
      setPaidTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("标记打款失败");
      }
    } finally {
      setPaidSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="提现审核" subtitle="全平台代理提现申请审核与打款" />

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
          <Input
            className="w-56"
            placeholder="代理 User ID 过滤"
            value={agentUserId}
            onChange={(e) => setAgentUserId(e.target.value)}
            aria-label="按代理 ID 过滤"
          />
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
                <TH>代理 ID</TH>
                <TH>收款账户</TH>
                <TH>申请时间</TH>
                <TH>审核时间</TH>
                <TH>打款流水号</TH>
                <TH>驳回原因</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.withdrawals.length > 0 ? (
                data.withdrawals.map((w) => {
                  const payout = parsePayoutAccount(w.payout_account);
                  return (
                    <TR key={w.id}>
                      <TD className="text-foreground font-medium whitespace-nowrap">
                        {Number(w.amount).toFixed(2)} 元
                      </TD>
                      <TD>
                        <Badge variant={STATUS_VARIANT[w.status] ?? "default"}>
                          {STATUS_LABEL[w.status] ?? w.status}
                        </Badge>
                      </TD>
                      <TD className="text-foreground-muted text-xs break-all">
                        {w.agent_id}
                      </TD>
                      <TD className="text-xs">
                        {payout ? (
                          <span className="break-all">
                            {PAYOUT_TYPE_LABEL[payout.type] ?? payout.type}
                            {payout.account ? ` · ${payout.account}` : ""}
                            {payout.name ? ` · ${payout.name}` : ""}
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
                      <TD className="text-foreground-muted text-xs break-all">
                        {w.payout_trade_no || "-"}
                      </TD>
                      <TD className="text-xs text-danger break-all">
                        {w.reject_reason || "-"}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {w.status === "pending" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => onApprove(w)}
                            >
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => openRejectModal(w)}
                            >
                              驳回
                            </Button>
                          </div>
                        )}
                        {w.status === "approved" && (
                          <Button size="sm" onClick={() => openPaidModal(w)}>
                            标记打款
                          </Button>
                        )}
                        {(w.status === "rejected" || w.status === "paid") && (
                          <span className="text-xs text-foreground-muted">-</span>
                        )}
                      </TD>
                    </TR>
                  );
                })
              ) : (
                <EmptyRow colSpan={9} message="暂无提现记录" />
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

      {/* 驳回弹窗 */}
      <Modal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="驳回提现申请"
        description={
          rejectTarget
            ? `金额 ${Number(rejectTarget.amount).toFixed(2)} 元`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRejectTarget(null)}
              disabled={rejectSubmitting}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={rejectSubmitting}
              onClick={onConfirmReject}
            >
              确认驳回
            </Button>
          </>
        }
      >
        <Textarea
          id="reject-reason"
          label="驳回原因"
          placeholder="请输入驳回原因"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          error={rejectError}
          hint="必填"
        />
      </Modal>

      {/* 打款弹窗 */}
      <Modal
        open={!!paidTarget}
        onClose={() => setPaidTarget(null)}
        title="标记提现已打款"
        description={
          paidTarget
            ? `金额 ${Number(paidTarget.amount).toFixed(2)} 元`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPaidTarget(null)}
              disabled={paidSubmitting}
            >
              取消
            </Button>
            <Button
              size="sm"
              loading={paidSubmitting}
              onClick={onConfirmPaid}
            >
              确认打款
            </Button>
          </>
        }
      >
        <Input
          id="paid-trade-no"
          label="第三方打款流水号"
          placeholder="请输入第三方打款流水号"
          value={payoutTradeNo}
          onChange={(e) => setPayoutTradeNo(e.target.value)}
          error={paidError}
          hint="必填"
        />
      </Modal>
    </div>
  );
}
