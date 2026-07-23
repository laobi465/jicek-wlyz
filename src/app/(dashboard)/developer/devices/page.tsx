"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
 * 设备列表 /developer/devices
 *
 * - GET /api/apps?limit=100 → { apps, total }（供应用筛选下拉）
 * - GET /api/devices（参数：appId / status / limit / offset → { devices, total }）
 */

interface AppOption {
  id: string;
  name: string;
}

interface AppListResponse {
  apps: AppOption[];
  total: number;
}

interface Device {
  id: string;
  machine_code: string;
  status: string;
  ip_address: string | null;
  last_heartbeat: string | null;
  created_at: string;
  app: { id: string; name: string };
}

interface ListResponse {
  devices: Device[];
  total: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "online", label: "在线" },
  { value: "offline", label: "离线" },
  { value: "blacklisted", label: "黑名单" },
];

const DEVICE_STATUS_LABEL: Record<string, string> = {
  online: "在线",
  offline: "离线",
  blacklisted: "黑名单",
};

const DEVICE_STATUS_VARIANT: Record<
  string,
  "default" | "success" | "danger"
> = {
  online: "success",
  offline: "default",
  blacklisted: "danger",
};

function DeviceStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={DEVICE_STATUS_VARIANT[status] ?? "default"}>
      {DEVICE_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export default function DevicesPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <DevicesPageInner />
    </AuthGuard>
  );
}

function DevicesPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [apps, setApps] = useState<AppOption[]>([]);
  const [appId, setAppId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadApps = useCallback(async () => {
    if (!user) return;
    try {
      const result = await get<AppListResponse>(user, "/api/apps", {
        limit: 100,
      });
      setApps(result.apps);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      }
    }
  }, [user, toast]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/devices", {
        appId: appId || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载设备列表失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, appId, status, offset, toast]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [appId, status]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="设备管理"
        subtitle="查看应用绑定的设备，支持加黑名单与解绑"
      />

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="w-48"
            aria-label="按应用筛选"
          >
            <option value="">全部应用</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
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
                <TH>机器码</TH>
                <TH>应用</TH>
                <TH>状态</TH>
                <TH>IP</TH>
                <TH>最近心跳</TH>
                <TH>创建时间</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.devices.length > 0 ? (
                data.devices.map((d) => (
                  <TR key={d.id}>
                    <TD className="font-mono text-xs">{d.machine_code}</TD>
                    <TD className="text-xs">{d.app?.name ?? "-"}</TD>
                    <TD>
                      <DeviceStatusBadge status={d.status} />
                    </TD>
                    <TD className="text-xs">{d.ip_address ?? "-"}</TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(d.last_heartbeat)}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(d.created_at)}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/developer/devices/${d.id}`}
                        className="text-primary text-sm hover:underline"
                      >
                        查看
                      </Link>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow colSpan={7} message="暂无设备" />
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
