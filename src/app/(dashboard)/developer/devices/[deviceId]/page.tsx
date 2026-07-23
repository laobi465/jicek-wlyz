"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/modal";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, post, ApiError } from "@/lib/http";

/**
 * 设备详情 /developer/devices/[deviceId]
 *
 * - GET /api/devices/[deviceId] → Device（含 app）
 * - POST /api/devices/[deviceId]/blacklist → { blacklisted: true }
 * - POST /api/devices/[deviceId]/unbind → { unbound: true }
 *
 * 操作：加黑名单 / 解绑（仅在线/已绑定设备）
 */

interface Device {
  id: string;
  machine_code: string;
  device_name: string | null;
  ip_address: string | null;
  location: string | null;
  status: string;
  last_heartbeat: string | null;
  sequence: number;
  banned_until: string | null;
  created_at: string;
  updated_at: string;
  app: { id: string; name: string };
}

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

export default function DeviceDetailPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <DeviceDetailPageInner />
    </AuthGuard>
  );
}

function DeviceDetailPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ deviceId: string }>();
  const deviceId = params?.deviceId;

  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);

  const [blacklistConfirm, setBlacklistConfirm] = useState(false);
  const [unbindConfirm, setUnbindConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !deviceId) return;
    setLoading(true);
    try {
      const data = await get<Device>(user, `/api/devices/${deviceId}`);
      setDevice(data);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载设备失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, deviceId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制`);
    } catch {
      toast.danger("复制失败，请手动选择复制");
    }
  }

  async function onBlacklist() {
    if (!user || !device) return;
    setActionLoading(true);
    try {
      await post(user, `/api/devices/${device.id}/blacklist`);
      toast.success("设备已加入黑名单");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加黑名单失败");
      }
    } finally {
      setActionLoading(false);
      setBlacklistConfirm(false);
    }
  }

  async function onUnbind() {
    if (!user || !device) return;
    setActionLoading(true);
    try {
      await post(user, `/api/devices/${device.id}/unbind`);
      toast.success("设备已解绑");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("解绑设备失败");
      }
    } finally {
      setActionLoading(false);
      setUnbindConfirm(false);
    }
  }

  if (loading) return <PageLoading />;
  if (!device) {
    return (
      <EmptyState
        title="设备不存在或无权访问"
        description="可能已被删除，或您没有权限查看此设备"
      />
    );
  }

  const isBlacklisted = device.status === "blacklisted";
  // 仅在线设备（active/已绑定）可解绑
  const canUnbind = device.status === "online";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="设备详情"
        subtitle={`机器码 ${device.machine_code}`}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/developer/devices")}
          >
            返回列表
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="基本信息"
          description={`创建于 ${formatDateTime(device.created_at)}`}
          action={
            <Badge variant={DEVICE_STATUS_VARIANT[device.status] ?? "default"}>
              {DEVICE_STATUS_LABEL[device.status] ?? device.status}
            </Badge>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="机器码"
              value={device.machine_code}
              mono
              onCopy={() => copyText(device.machine_code, "机器码")}
            />
            <Field label="归属应用" value={device.app?.name ?? "-"} />
            <Field label="设备名称" value={device.device_name ?? "-"} />
            <Field label="IP 地址" value={device.ip_address ?? "-"} />
            <Field label="地理位置" value={device.location ?? "-"} />
            <Field label="序列号" value={String(device.sequence)} />
            <Field
              label="最近心跳"
              value={formatDateTime(device.last_heartbeat)}
            />
            <Field
              label="封禁到期"
              value={formatDateTime(device.banned_until)}
            />
            <Field
              label="更新时间"
              value={formatDateTime(device.updated_at)}
            />
          </div>
        </CardBody>
      </Card>

      {!isBlacklisted && (
        <Card>
          <CardHeader title="设备操作" description="加黑名单与解绑操作" />
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">加入黑名单</p>
                <p className="text-xs text-foreground-muted mt-1">
                  加入黑名单后设备将无法再进行心跳与鉴权
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                loading={actionLoading}
                onClick={() => setBlacklistConfirm(true)}
              >
                加黑名单
              </Button>
            </div>
            <div className="my-4 border-t border-border" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">解绑设备</p>
                <p className="text-xs text-foreground-muted mt-1">
                  {canUnbind
                    ? "解绑后将清除绑定关系并置为离线"
                    : "仅在线设备可解绑"}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={actionLoading}
                disabled={!canUnbind}
                onClick={() => setUnbindConfirm(true)}
              >
                解绑
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <ConfirmModal
        open={blacklistConfirm}
        onClose={() => setBlacklistConfirm(false)}
        onConfirm={onBlacklist}
        title="加入黑名单"
        message="加入黑名单后设备将无法再进行心跳与鉴权，确定加入黑名单吗？"
        confirmText="确认加黑"
        danger
        loading={actionLoading}
      />

      <ConfirmModal
        open={unbindConfirm}
        onClose={() => setUnbindConfirm(false)}
        onConfirm={onUnbind}
        title="解绑设备"
        message="解绑后将清除该设备的绑定关系并置为离线，确定解绑吗？"
        confirmText="确认解绑"
        loading={actionLoading}
      />
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">{label}</label>
        {onCopy && (
          <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
            复制
          </Button>
        )}
      </div>
      <div
        className={`rounded-md border border-border bg-background-subtle px-3 py-2 text-xs text-foreground break-all ${
          mono ? "font-mono" : ""
        } truncate`}
      >
        {value}
      </div>
    </div>
  );
}
