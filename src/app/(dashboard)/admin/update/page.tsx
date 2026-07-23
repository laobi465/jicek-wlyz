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
  /** 是否为 Docker 容器化部署（true 时容器内无法 git pull，需在宿主机执行 install.sh） */
  isDockerMode: boolean;
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

  /** 一键复制宿主机更新命令到剪贴板 */
  async function onCopyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("命令已复制到剪贴板");
    } catch {
      // 剪贴板 API 不可用时回退到选中文本，提示用户手动复制
      toast.danger("复制失败，请手动选中命令复制");
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
          {check.isDockerMode ? (
            // Docker 容器化部署：容器内无 git / 无 .git，无法执行 git pull。
            // 展示宿主机更新指引（版本对比已在上方 dl 中展示），含可一键复制的命令。
            <div className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="warning">Docker 部署</Badge>
                <span className="text-xs text-foreground-muted">
                  容器内无法执行 git pull，请在宿主机执行以下命令完成更新
                </span>
              </div>

              {/* 更新命令（一键复制） */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-foreground-muted">更新到最新版本</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-foreground/5 px-3 py-2 text-xs font-mono text-foreground break-all">
                    cd /opt/jicek-wlyz &amp;&amp; bash install.sh update
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onCopyCommand("cd /opt/jicek-wlyz && bash install.sh update")
                    }
                  >
                    复制
                  </Button>
                </div>
              </div>

              {/* 回滚命令（一键复制） */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-foreground-muted">
                  回滚到上一版本（reinstall 保留 .env 与数据卷）
                </span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-foreground/5 px-3 py-2 text-xs font-mono text-foreground break-all">
                    cd /opt/jicek-wlyz &amp;&amp; bash install.sh reinstall
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onCopyCommand(
                        "cd /opt/jicek-wlyz && bash install.sh reinstall",
                      )
                    }
                  >
                    复制
                  </Button>
                </div>
              </div>

              {/* 操作步骤 */}
              <ol className="text-xs text-foreground-muted flex flex-col gap-1 list-decimal list-inside">
                <li>SSH 登录宿主机（部署服务器）</li>
                <li>粘贴上方命令并执行，等待拉取新镜像并重启容器</li>
                <li>
                  完成后回到本页面点"检查更新"刷新版本信息（如部署目录非默认
                  /opt/jicek-wlyz，请将命令中的路径替换为实际部署目录）
                </li>
              </ol>
            </div>
          ) : (
            // 源码部署：容器内可直接 git pull，展示"触发更新"与"回滚"按钮
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
          )}
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
