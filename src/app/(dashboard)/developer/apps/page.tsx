"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
 * 应用列表 /developer/apps
 *
 * - GET /api/apps（参数：status / limit / offset → { apps, total }）
 * - 状态筛选
 * - 上一页 / 下一页分页（limit=20）
 */

interface App {
  id: string;
  developer_id: string;
  name: string;
  description: string | null;
  app_key: string;
  status: string;
  version: string;
  heartbeat_interval: number;
  max_devices: number;
  unbind_rule: string;
  config_signature: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  apps: App[];
  total: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "disabled", label: "已停用" },
];

const APP_STATUS_LABEL: Record<string, string> = {
  active: "正常",
  disabled: "已停用",
};

function AppStatusBadge({ status }: { status: string }) {
  const variant =
    status === "active" ? "success" : status === "disabled" ? "default" : "default";
  return <Badge variant={variant}>{APP_STATUS_LABEL[status] ?? status}</Badge>;
}

export default function AppsPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <AppsPageInner />
    </AuthGuard>
  );
}

function AppsPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/apps", {
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载应用列表失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, status, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [status]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="应用管理"
        subtitle="管理您的应用、密钥与配置签名"
        action={
          <Button size="sm" onClick={() => router.push("/developer/apps/new")}>
            创建应用
          </Button>
        }
      />

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
                <TH>应用名称</TH>
                <TH>AppKey</TH>
                <TH>状态</TH>
                <TH>版本</TH>
                <TH>最大设备</TH>
                <TH>创建时间</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.apps.length > 0 ? (
                data.apps.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <Link
                        href={`/developer/apps/${a.id}`}
                        className="text-foreground hover:text-primary transition-colors"
                      >
                        {a.name}
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs">{a.app_key}</TD>
                    <TD>
                      <AppStatusBadge status={a.status} />
                    </TD>
                    <TD className="text-xs">{a.version}</TD>
                    <TD className="text-xs">{a.max_devices}</TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(a.created_at)}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/developer/apps/${a.id}`}
                        className="text-primary text-sm hover:underline"
                      >
                        查看
                      </Link>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow
                  colSpan={7}
                  message="暂无应用，点击右上角“创建应用”开始"
                />
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
