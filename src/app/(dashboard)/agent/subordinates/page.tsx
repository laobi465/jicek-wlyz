"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
 * 下级代理 /agent/subordinates
 *
 * - GET /api/agent/tree?depth=3 → { level1, level2, level3 }（三层下级树，每层含 user）
 *
 * 三层分段展示：一级 / 二级 / 三级下级，每层一个 Table。
 */

interface AgentUser {
  id: string;
  email: string;
  nickname: string | null;
  status: string;
}

interface SubAgent {
  id: string;
  user_id: string;
  level: number;
  commission_rate: string;
  total_commission: string;
  status: string;
  created_at: string;
  user: AgentUser;
}

interface AgentTree {
  level1: SubAgent[];
  level2: SubAgent[];
  level3: SubAgent[];
}

const LEVEL_LABEL: Record<number, string> = {
  1: "一级",
  2: "二级",
  3: "三级",
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

type LevelKey = "level1" | "level2" | "level3";

const TABS: { key: LevelKey; label: string }[] = [
  { key: "level1", label: "一级下级" },
  { key: "level2", label: "二级下级" },
  { key: "level3", label: "三级下级" },
];

export default function SubordinatesPage() {
  return (
    <AuthGuard allow={["agent"]}>
      <SubordinatesPageInner />
    </AuthGuard>
  );
}

function SubordinatesPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [tree, setTree] = useState<AgentTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<LevelKey>("level1");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<AgentTree>(user, "/api/agent/tree", {
        depth: 3,
      });
      setTree(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载下级代理失败");
      }
      setTree(null);
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = {
    level1: tree?.level1?.length ?? 0,
    level2: tree?.level2?.length ?? 0,
    level3: tree?.level3?.length ?? 0,
  };
  const total = counts.level1 + counts.level2 + counts.level3;
  const list = tree ? tree[active] : [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="下级代理"
        subtitle="查看您发展的三层下级代理"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <div className="px-5 py-4 flex flex-col gap-1">
            <span className="text-xs text-foreground-muted">三层总数</span>
            <span className="text-2xl font-semibold text-foreground">
              {total}
            </span>
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4 flex flex-col gap-1">
            <span className="text-xs text-foreground-muted">一级下级</span>
            <span className="text-2xl font-semibold text-foreground">
              {counts.level1}
            </span>
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4 flex flex-col gap-1">
            <span className="text-xs text-foreground-muted">二级下级</span>
            <span className="text-2xl font-semibold text-foreground">
              {counts.level2}
            </span>
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4 flex flex-col gap-1">
            <span className="text-xs text-foreground-muted">三级下级</span>
            <span className="text-2xl font-semibold text-foreground">
              {counts.level3}
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <Button
              key={t.key}
              variant={active === t.key ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActive(t.key)}
            >
              {t.label}（{counts[t.key]}）
            </Button>
          ))}
        </div>

        {loading ? (
          <PageLoading />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>邮箱</TH>
                <TH>昵称</TH>
                <TH>层级</TH>
                <TH>佣金比例</TH>
                <TH>累计佣金</TH>
                <TH>状态</TH>
                <TH>注册时间</TH>
              </TR>
            </THead>
            <TBody>
              {list.length > 0 ? (
                list.map((a) => (
                  <TR key={a.id}>
                    <TD className="text-xs font-mono break-all">
                      {a.user.email}
                    </TD>
                    <TD className="text-foreground">
                      {a.user.nickname || "-"}
                    </TD>
                    <TD className="text-xs">
                      {LEVEL_LABEL[a.level] ?? `第 ${a.level} 级`}
                    </TD>
                    <TD className="text-xs">
                      {Number(a.commission_rate).toFixed(2)}%
                    </TD>
                    <TD className="text-xs">
                      {Number(a.total_commission).toFixed(2)} 元
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          AGENT_STATUS_VARIANT[a.status] ?? "default"
                        }
                      >
                        {AGENT_STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(a.created_at)}
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow
                  colSpan={7}
                  message={`暂无${TABS.find((t) => t.key === active)?.label ?? ""}记录`}
                />
              )}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
