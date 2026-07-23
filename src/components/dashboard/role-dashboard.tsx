"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { get, ApiError } from "@/lib/http";

/**
 * 角色仪表盘（开发者 / 代理 / 超管共用）
 *
 * 数据来源：GET /api/dashboard
 * 后端按角色返回不同结构（见 dashboard-service.ts）
 */

interface DeveloperData {
  role: "developer";
  apps: { total: number };
  cards: { total: number };
  devices: { total: number; todayNew: number; online: number };
  tickets: { pending: number; resolved: number };
  notifications: { unread: number };
  checkin: {
    checkedInToday: boolean;
    continuousDays: number;
    rewardAmount: string;
  };
}

interface AgentData {
  role: "agent";
  agent: {
    level: number;
    totalCommission: string;
    withdrawnAmount: string;
    availableBalance: string;
  } | null;
  subAgents: { count: number };
  invitations: { generated: number; used: number };
  withdrawals: { pending: number; paid: number };
  notifications: { unread: number };
  checkin: {
    checkedInToday: boolean;
    continuousDays: number;
    rewardAmount: string;
  };
}

interface SuperAdminData {
  role: "super_admin";
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

type DashboardData = DeveloperData | AgentData | SuperAdminData;

export function RoleDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const d = await get<DashboardData>(user, "/api/dashboard");
        if (active) {
          setData(d);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setLoading(false);
          if (err instanceof ApiError) {
            toast.danger(err.message);
          } else {
            toast.danger("加载看板数据失败");
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-foreground-muted text-center py-8">
            暂无数据
          </p>
        </CardBody>
      </Card>
    );
  }

  if (data.role === "developer") return <DeveloperDashboard data={data} />;
  if (data.role === "agent") return <AgentDashboard data={data} />;
  return <SuperAdminDashboard data={data} />;
}

// ---------------------------------------------------------------------------
// 开发者看板
// ---------------------------------------------------------------------------

function DeveloperDashboard({ data }: { data: DeveloperData }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="开发者概览" subtitle="您的应用、卡密、设备与工单总览" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="应用总数" value={data.apps.total} />
        <StatCard label="卡密总数" value={data.cards.total} />
        <StatCard label="设备总数" value={data.devices.total} />
        <StatCard
          label="在线设备"
          value={data.devices.online}
          badge={<Badge variant="success">在线</Badge>}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="设备动态" description="今日新增与在线状态" />
          <CardBody>
            <div className="flex gap-8">
              <StatItem label="今日新增" value={data.devices.todayNew} />
              <StatItem label="在线设备" value={data.devices.online} />
              <StatItem label="设备总数" value={data.devices.total} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="工单与通知" description="待处理事项" />
          <CardBody>
            <div className="flex gap-8">
              <StatItem label="待处理工单" value={data.tickets.pending} />
              <StatItem label="已解决工单" value={data.tickets.resolved} />
              <StatItem label="未读通知" value={data.notifications.unread} />
            </div>
          </CardBody>
        </Card>
      </div>

      <CheckinCard
        checkedInToday={data.checkin.checkedInToday}
        continuousDays={data.checkin.continuousDays}
        rewardAmount={data.checkin.rewardAmount}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 代理看板
// ---------------------------------------------------------------------------

function AgentDashboard({ data }: { data: AgentData }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="代理概览" subtitle="您的下级代理、佣金与提现总览" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="佣金余额"
          value={`¥ ${data.agent?.availableBalance ?? "0"}`}
        />
        <StatCard
          label="累计佣金"
          value={`¥ ${data.agent?.totalCommission ?? "0"}`}
        />
        <StatCard label="下级代理" value={data.subAgents.count} />
        <StatCard
          label="代理层级"
          value={data.agent ? `L${data.agent.level}` : "-"}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="邀请码" description="生成与使用情况" />
          <CardBody>
            <div className="flex gap-8">
              <StatItem label="已生成" value={data.invitations.generated} />
              <StatItem label="已使用" value={data.invitations.used} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="提现" description="提现申请状态" />
          <CardBody>
            <div className="flex gap-8">
              <StatItem label="待审核" value={data.withdrawals.pending} />
              <StatItem label="已打款" value={data.withdrawals.paid} />
            </div>
          </CardBody>
        </Card>
      </div>

      <CheckinCard
        checkedInToday={data.checkin.checkedInToday}
        continuousDays={data.checkin.continuousDays}
        rewardAmount={data.checkin.rewardAmount}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 超管看板
// ---------------------------------------------------------------------------

function SuperAdminDashboard({ data }: { data: SuperAdminData }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="超管概览" subtitle="全平台运营总览" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="用户总数" value={data.users.total} />
        <StatCard label="开发者" value={data.users.developers} />
        <StatCard label="代理" value={data.users.agents} />
        <StatCard label="订单总数" value={data.business.orders} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="收入" description="今日与本月成功支付" />
          <CardBody>
            <div className="flex gap-8">
              <StatItem label="今日" value={`¥ ${data.revenue.today}`} />
              <StatItem label="本月" value={`¥ ${data.revenue.thisMonth}`} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="业务规模" description="应用与卡密" />
          <CardBody>
            <div className="flex gap-8">
              <StatItem label="应用总数" value={data.business.apps} />
              <StatItem label="卡密总数" value={data.business.cards} />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="工单分布" description="按状态统计" />
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <StatItem label="待处理" value={data.tickets.open} />
              <StatItem label="处理中" value={data.tickets.inProgress} />
              <StatItem label="已解决" value={data.tickets.resolved} />
              <StatItem label="已关闭" value={data.tickets.closed} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="提现审核" description="待审核提现申请" />
          <CardBody>
            <div className="flex gap-8">
              <StatItem
                label="待审核笔数"
                value={data.withdrawals.pendingCount}
              />
              <StatItem
                label="待审核金额"
                value={`¥ ${data.withdrawals.pendingAmount}`}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="APK 注入任务" description="按状态统计" />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatItem label="待处理" value={data.apkInjection.pending} />
            <StatItem label="处理中" value={data.apkInjection.processing} />
            <StatItem label="成功" value={data.apkInjection.success} />
            <StatItem label="失败" value={data.apkInjection.failed} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 共享小组件
// ---------------------------------------------------------------------------

function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {subtitle && (
        <p className="text-sm text-foreground-muted mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  badge,
}: {
  label: string;
  value: string | number;
  badge?: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between">
          <p className="text-xs text-foreground-muted">{label}</p>
          {badge}
        </div>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </CardBody>
    </Card>
  );
}

function StatItem({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-foreground-muted">{label}</span>
      <span className="text-lg font-semibold text-foreground">{value}</span>
    </div>
  );
}

function CheckinCard({
  checkedInToday,
  continuousDays,
  rewardAmount,
}: {
  checkedInToday: boolean;
  continuousDays: number;
  rewardAmount: string;
}) {
  return (
    <Card>
      <CardHeader title="每日签到" description="连续签到享递增奖励" />
      <CardBody>
        <div className="flex items-center justify-between">
          <div className="flex gap-8">
            <StatItem
              label="今日状态"
              value={checkedInToday ? "已签到" : "未签到"}
            />
            <StatItem label="连续天数" value={continuousDays} />
            <StatItem label="今日奖励" value={`¥ ${rewardAmount}`} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
