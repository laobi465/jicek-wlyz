"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
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
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, post, ApiError } from "@/lib/http";

/**
 * 更新面板 /admin/update
 *
 * - GET /api/admin/update/check → { currentVersion, latestVersion: CommitInfo, updateLogs: CommitInfo[], hasUpdate }
 * - POST /api/admin/update/trigger → { historyId, oldVersion, newVersion }
 * - POST /api/admin/update/rollback → { rolledBackTo }
 * - GET /api/admin/update/history → { history: UpdateHistoryRecord[], total }
 *
 * 注意：更新与回滚路由使用 Better Auth getSession 鉴权（cookie），
 * http.ts 已开启 credentials: "include"，响应体格式与统一规范一致。
 */

interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  date: string;
}

interface CheckResult {
  currentVersion: string;
  latestVersion: CommitInfo;
  updateLogs: CommitInfo[];
  hasUpdate: boolean;
}

interface UpdateHistoryRecord {
  id: string;
  version: string;
  action: string;
  status: string;
  trigger: string;
  operator: string;
  errorMessage: string | null;
  createdAt: string;
}

interface HistoryResponse {
  history: UpdateHistoryRecord[];
  total: number;
}

const ACTION_LABEL: Record<string, string> = {
  auto: "自动更新",
  manual: "手动触发",
  rollback: "回滚",
};

const STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  success: "成功",
  failed: "失败",
  rolled_back: "已回滚",
};

const STATUS_VARIANT: Record<
  string,
  "warning" | "success" | "danger" | "default"
> = {
  running: "warning",
  success: "success",
  failed: "danger",
  rolled_back: "default",
};

export default function UpdatePage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <UpdatePageInner />
    </AuthGuard>
  );
}

function UpdatePageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [check, setCheck] = useState<CheckResult | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [c, h] = await Promise.all([
        get<CheckResult>(user, "/api/admin/update/check"),
        get<HistoryResponse>(user, "/api/admin/update/history"),
      ]);
      setCheck(c);
      setHistory(h);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载更新面板失败");
      }
      setCheck(null);
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    if (!user) return;
    setRefreshing(true);
    try {
      const c = await get<CheckResult>(user, "/api/admin/update/check");
      setCheck(c);
      toast.success("已刷新版本信息");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("检查更新失败");
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function onTrigger() {
    if (!user) return;
    if (
      !window.confirm(
        "确认触发更新？将执行 git pull + npm install + prisma migrate + 重启，期间服务可能短暂中断。",
      )
    ) {
      return;
    }
    setTriggering(true);
    try {
      await post(user, "/api/admin/update/trigger");
      toast.success("更新已完成");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("触发更新失败");
      }
    } finally {
      setTriggering(false);
    }
  }

  async function onRollback() {
    if (!user) return;
    if (
      !window.confirm(
        "确认回滚到上一版本？将执行 git reset --hard HEAD~1 + 重启，当前版本未提交的更改将丢失。",
      )
    ) {
      return;
    }
    setRollingBack(true);
    try {
      await post(user, "/api/admin/update/rollback");
      toast.success("回滚已完成");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("回滚失败");
      }
    } finally {
      setRollingBack(false);
    }
  }

  if (loading || check === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="更新面板" subtitle="检查版本、手动触发更新与回滚" />
        <PageLoading />
      </div>
    );
  }

  if (check === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="更新面板" subtitle="检查版本、手动触发更新与回滚" />
        <Card>
          <EmptyState
            title="暂无数据"
            description="无法加载更新信息，请稍后重试"
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="更新面板"
        subtitle="检查版本、手动触发更新与回滚"
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={onRefresh}
            loading={refreshing}
          >
            检查更新
          </Button>
        }
      />

      {/* 版本信息卡片 */}
      <Card>
        <CardHeader title="版本信息" description="当前部署版本与远端最新版本" />
        <CardBody>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">当前版本</dt>
              <dd className="text-sm text-foreground font-mono break-all">
                {check.currentVersion.slice(0, 12)}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">是否有新版本</dt>
              <dd>
                <Badge variant={check.hasUpdate ? "warning" : "success"}>
                  {check.hasUpdate ? "有新版本" : "已是最新"}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">最新版本 SHA</dt>
              <dd className="text-sm text-foreground font-mono break-all">
                {check.latestVersion.shortSha}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">提交者</dt>
              <dd className="text-sm text-foreground break-all">
                {check.latestVersion.author}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <dt className="text-xs text-foreground-muted">提交信息</dt>
              <dd className="text-sm text-foreground break-all">
                {check.latestVersion.message}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">提交时间</dt>
              <dd className="text-sm text-foreground">
                {formatDateTime(check.latestVersion.date)}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex gap-3">
            <Button
              size="sm"
              onClick={onTrigger}
              loading={triggering}
              disabled={!check.hasUpdate || triggering}
            >
              触发更新
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={onRollback}
              loading={rollingBack}
              disabled={rollingBack}
            >
              回滚上一版本
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* 更新日志 */}
      <Card>
        <CardHeader
          title="远端更新日志"
          description={`最近 ${check.updateLogs.length} 条 GitHub 提交`}
        />
        <Table>
          <THead>
            <TR>
              <TH>SHA</TH>
              <TH>提交信息</TH>
              <TH>提交者</TH>
              <TH>时间</TH>
            </TR>
          </THead>
          <TBody>
            {check.updateLogs.length > 0 ? (
              check.updateLogs.map((c) => (
                <TR key={c.sha}>
                  <TD className="text-foreground-muted text-xs font-mono whitespace-nowrap">
                    {c.shortSha}
                  </TD>
                  <TD className="text-foreground text-xs break-all max-w-md">
                    {c.message}
                  </TD>
                  <TD className="text-foreground-muted text-xs whitespace-nowrap">
                    {c.author}
                  </TD>
                  <TD className="text-foreground-muted text-xs whitespace-nowrap">
                    {formatDateTime(c.date)}
                  </TD>
                </TR>
              ))
            ) : (
              <EmptyRow colSpan={4} message="暂无更新日志" />
            )}
          </TBody>
        </Table>
      </Card>

      {/* 更新历史 */}
      <Card>
        <CardHeader
          title="更新历史"
          description="本机执行过的更新与回滚记录"
        />
        <Table>
          <THead>
            <TR>
              <TH>时间</TH>
              <TH>操作</TH>
              <TH>状态</TH>
              <TH>触发方式</TH>
              <TH>操作人</TH>
              <TH>版本</TH>
              <TH>错误信息</TH>
            </TR>
          </THead>
          <TBody>
            {history && history.history.length > 0 ? (
              history.history.map((h) => (
                <TR key={h.id}>
                  <TD className="text-foreground-muted text-xs whitespace-nowrap">
                    {formatDateTime(h.createdAt)}
                  </TD>
                  <TD className="text-foreground text-xs">
                    {ACTION_LABEL[h.action] ?? h.action}
                  </TD>
                  <TD>
                    <Badge variant={STATUS_VARIANT[h.status] ?? "default"}>
                      {STATUS_LABEL[h.status] ?? h.status}
                    </Badge>
                  </TD>
                  <TD className="text-foreground-muted text-xs">
                    {h.trigger}
                  </TD>
                  <TD className="text-foreground-muted text-xs break-all">
                    {h.operator}
                  </TD>
                  <TD className="text-foreground-muted text-xs font-mono break-all">
                    {h.version.slice(0, 12)}
                  </TD>
                  <TD className="text-xs text-danger break-all max-w-xs">
                    {h.errorMessage || "-"}
                  </TD>
                </TR>
              ))
            ) : (
              <EmptyRow colSpan={7} message="暂无更新历史" />
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
