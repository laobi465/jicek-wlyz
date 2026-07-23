"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
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
 * 提现申请 /agent/withdrawals
 *
 * - GET /api/withdrawals?status=&limit=20&offset=0 → { withdrawals, total }
 * - GET /api/agent/balance → { totalCommission, withdrawnAmount, pendingAmount, available }（取 available）
 * - POST /api/withdrawals { amount, payoutAccount: { type, account, name, bank? } } → Withdrawal（201）
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

const MIN_AMOUNT = 1;

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

export default function WithdrawalsPage() {
  return (
    <AuthGuard allow={["agent"]}>
      <WithdrawalsPageInner />
    </AuthGuard>
  );
}

function WithdrawalsPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [balance, setBalance] = useState<AgentBalance | null>(null);
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 发起提现弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [payoutType, setPayoutType] = useState<"alipay" | "wxpay" | "bank">(
    "alipay",
  );
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  function openCreate() {
    setAmount("");
    setPayoutType("alipay");
    setAccount("");
    setName("");
    setBank("");
    setErrors({});
    setCreateOpen(true);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    const amt = Number(amount);
    if (!amount.trim() || !Number.isFinite(amt) || amt < MIN_AMOUNT) {
      next.amount = `提现金额必须 ≥ ${MIN_AMOUNT} 元`;
    }
    if (!account.trim()) {
      next.account = "请输入收款账号";
    }
    if (!name.trim()) {
      next.name = "请输入收款人姓名";
    }
    if (payoutType === "bank" && !bank.trim()) {
      next.bank = "银行卡提现必须填写银行名称";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onCreate() {
    if (!user) return;
    if (!validate()) return;

    const payoutAccount: Record<string, string> = {
      type: payoutType,
      account: account.trim(),
      name: name.trim(),
    };
    if (payoutType === "bank" && bank.trim()) {
      payoutAccount.bank = bank.trim();
    }

    setSubmitting(true);
    try {
      await post<Withdrawal>(user, "/api/withdrawals", {
        amount: Number(amount),
        payoutAccount,
      });
      toast.success("提现申请已提交");
      setCreateOpen(false);
      await Promise.all([loadBalance(), loadList()]);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("发起提现失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="提现申请"
        subtitle="申请佣金提现并查看提现记录"
        action={
          <Button size="sm" onClick={openCreate}>
            发起提现
          </Button>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-1">
          <span className="text-xs text-foreground-muted">可提现余额</span>
          <span className="text-2xl font-semibold text-foreground">
            {balance ? formatYuan(balance.available) : "-"}
            <span className="ml-1 text-xs font-normal text-foreground-muted">
              元
            </span>
          </span>
        </CardBody>
      </Card>

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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="发起提现"
        description={`当前可提现 ${balance ? formatYuan(balance.available) : "-"} 元，最低 ${MIN_AMOUNT} 元`}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button size="sm" loading={submitting} onClick={onCreate}>
              提交申请
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            id="wd-amount"
            label="提现金额"
            type="number"
            min={MIN_AMOUNT}
            step="0.01"
            placeholder="请输入提现金额"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amount}
            hint={`最低 ${MIN_AMOUNT} 元，可提现 ${balance ? formatYuan(balance.available) : "-"} 元`}
          />

          <Select
            id="wd-payout-type"
            label="收款方式"
            value={payoutType}
            onChange={(e) => {
              setPayoutType(e.target.value as "alipay" | "wxpay" | "bank");
            }}
          >
            <option value="alipay">支付宝</option>
            <option value="wxpay">微信</option>
            <option value="bank">银行卡</option>
          </Select>

          <Input
            id="wd-account"
            label="收款账号"
            placeholder="如 支付宝账号 / 微信 openid / 银行卡号"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            error={errors.account}
            hint="必填，对应收款方式的账号"
          />

          <Input
            id="wd-name"
            label="收款人姓名"
            placeholder="请输入收款人真实姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            hint="必填"
          />

          {payoutType === "bank" && (
            <Input
              id="wd-bank"
              label="开户银行"
              placeholder="如 中国工商银行"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              error={errors.bank}
              hint="银行卡提现必填"
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
