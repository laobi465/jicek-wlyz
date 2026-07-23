"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, ApiError } from "@/lib/http";

/**
 * 代理概览 /agent
 *
 * - GET /api/agent/profile → Agent 档案（含 user 信息）或 null
 * - GET /api/agent/balance → { totalCommission, withdrawnAmount, pendingAmount, available }（number）
 *
 * 余额卡片网格 + 代理信息卡片 + 快捷入口；profile 为 null 时提示非代理。
 */

interface AgentUser {
  id: string;
  email: string;
  nickname: string | null;
  status: string;
}

interface AgentProfile {
  id: string;
  user_id: string;
  level: number;
  parent_id: string | null;
  commission_rate: string;
  total_commission: string;
  withdrawn_amount: string;
  status: string;
  created_at: string;
  user: AgentUser;
}

interface AgentBalance {
  totalCommission: number;
  withdrawnAmount: number;
  pendingAmount: number;
  available: number;
}

const LEVEL_LABEL: Record<number, string> = {
  1: "一级代理",
  2: "二级代理",
  3: "三级代理",
};

const AGENT_STATUS_LABEL: Record<string, string> = {
  active: "正常",
  pending: "待审核",
  frozen: "已冻结",
};

const AGENT_STATUS_VARIANT: Record<
  string,
  "success" | "warning" | "danger" | "default"
> = {
  active: "success",
  pending: "warning",
  frozen: "danger",
};

function formatYuan(value: number): string {
  return Number(value).toFixed(2);
}

export default function AgentPage() {
  return (
    <AuthGuard allow={["agent"]}>
      <AgentPageInner />
    </AuthGuard>
  );
}

function AgentPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState<AgentProfile | null | undefined>(
    undefined,
  );
  const [balance, setBalance] = useState<AgentBalance | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [p, b] = await Promise.all([
        get<AgentProfile | null>(user, "/api/agent/profile"),
        get<AgentBalance>(user, "/api/agent/balance"),
      ]);
      setProfile(p);
      setBalance(b);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载代理信息失败");
      }
      setProfile(null);
      setBalance(null);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (profile === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="代理概览" subtitle="查看您的代理档案与佣金余额" />
        <PageLoading />
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="代理概览" subtitle="查看您的代理档案与佣金余额" />
        <Card>
          <EmptyState
            title="您还不是代理"
            description="请联系上级代理获取邀请码，激活代理身份"
          />
        </Card>
      </div>
    );
  }

  const cards = [
    {
      label: "累计佣金",
      value: balance ? formatYuan(balance.totalCommission) : "-",
      hint: "元",
    },
    {
      label: "已提现",
      value: balance ? formatYuan(balance.withdrawnAmount) : "-",
      hint: "元",
    },
    {
      label: "审核中",
      value: balance ? formatYuan(balance.pendingAmount) : "-",
      hint: "元",
    },
    {
      label: "可提现",
      value: balance ? formatYuan(balance.available) : "-",
      hint: "元",
    },
  ];

  const quickLinks: { href: string; label: string }[] = [
    { href: "/agent/subordinates", label: "下级代理" },
    { href: "/agent/invitations", label: "邀请码" },
    { href: "/agent/commission", label: "佣金明细" },
    { href: "/agent/withdrawals", label: "提现申请" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="代理概览" subtitle="查看您的代理档案与佣金余额" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardBody className="flex flex-col gap-1">
              <span className="text-xs text-foreground-muted">{c.label}</span>
              <span className="text-2xl font-semibold text-foreground">
                {c.value}
                <span className="ml-1 text-xs font-normal text-foreground-muted">
                  {c.hint}
                </span>
              </span>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="代理信息" description="您的代理档案与层级" />
        <CardBody>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <InfoItem label="账号邮箱" value={profile.user.email} />
            <InfoItem
              label="昵称"
              value={profile.user.nickname || "-"}
            />
            <InfoItem
              label="代理层级"
              value={LEVEL_LABEL[profile.level] ?? `第 ${profile.level} 级`}
            />
            <InfoItem
              label="佣金比例"
              value={`${Number(profile.commission_rate).toFixed(2)}%`}
            />
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">状态</dt>
              <dd>
                <Badge variant={AGENT_STATUS_VARIANT[profile.status] ?? "default"}>
                  {AGENT_STATUS_LABEL[profile.status] ?? profile.status}
                </Badge>
              </dd>
            </div>
            <InfoItem
              label="注册时间"
              value={formatDateTime(profile.created_at)}
            />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="快捷入口" description="常用代理管理操作" />
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

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground break-all">{value}</dd>
    </div>
  );
}
