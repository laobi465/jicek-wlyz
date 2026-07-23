"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/modal";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, patch, del, post, ApiError } from "@/lib/http";

/**
 * 应用详情 /developer/apps/[appId]
 *
 * - GET /api/apps/[appId] → App
 * - PATCH /api/apps/[appId]（name/description/version/announcement/forceUpdate/minVersion
 *   /updateUrl/heartbeatInterval/maxDevices/unbindRule）→ App
 * - POST /api/apps/[appId]/regenerate-signature → { signature }
 * - DELETE /api/apps/[appId] → 停用应用（status=disabled）
 *
 * app_key / rsa_public_key 可复制；停用后不可编辑。
 */

interface App {
  id: string;
  developer_id: string;
  name: string;
  description: string | null;
  app_key: string;
  client_secret: string;
  rsa_public_key: string;
  status: string;
  version: string;
  announcement: string | null;
  force_update: boolean;
  min_version: string | null;
  update_url: string | null;
  heartbeat_interval: number;
  max_devices: number;
  unbind_rule: string;
  crypto_mode: string;
  config_signature: string | null;
  created_at: string;
  updated_at: string;
}

const UNBIND_RULE_OPTIONS = [
  { value: "none", label: "不允许解绑" },
  { value: "daily", label: "每日解绑" },
  { value: "manual", label: "手动解绑" },
];

const APP_STATUS_LABEL: Record<string, string> = {
  active: "正常",
  disabled: "已停用",
};

export default function AppDetailPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <AppDetailPageInner />
    </AuthGuard>
  );
}

function AppDetailPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ appId: string }>();
  const appId = params?.appId;

  const [app, setApp] = useState<App | null>(null);
  const [loading, setLoading] = useState(true);

  // 编辑表单
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [forceUpdate, setForceUpdate] = useState(false);
  const [minVersion, setMinVersion] = useState("");
  const [updateUrl, setUpdateUrl] = useState("");
  const [heartbeatInterval, setHeartbeatInterval] = useState("");
  const [maxDevices, setMaxDevices] = useState("");
  const [unbindRule, setUnbindRule] = useState("none");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string>();
  const [heartbeatError, setHeartbeatError] = useState<string>();
  const [maxDevicesError, setMaxDevicesError] = useState<string>();

  const [signConfirm, setSignConfirm] = useState(false);
  const [disableConfirm, setDisableConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !appId) return;
    setLoading(true);
    try {
      const data = await get<App>(user, `/api/apps/${appId}`);
      setApp(data);
      // 同步表单初值
      setName(data.name);
      setDescription(data.description ?? "");
      setVersion(data.version);
      setAnnouncement(data.announcement ?? "");
      setForceUpdate(data.force_update);
      setMinVersion(data.min_version ?? "");
      setUpdateUrl(data.update_url ?? "");
      setHeartbeatInterval(String(data.heartbeat_interval));
      setMaxDevices(String(data.max_devices));
      setUnbindRule(data.unbind_rule);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载应用失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, appId, toast]);

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

  function validate(): boolean {
    let ok = true;
    if (!name.trim()) {
      setNameError("请输入应用名称");
      ok = false;
    } else {
      setNameError(undefined);
    }
    const hb = Number(heartbeatInterval);
    if (!heartbeatInterval || !Number.isInteger(hb) || hb < 1) {
      setHeartbeatError("心跳间隔必须为正整数（秒）");
      ok = false;
    } else {
      setHeartbeatError(undefined);
    }
    const md = Number(maxDevices);
    if (!maxDevices || !Number.isInteger(md) || md < 1 || md > 10000) {
      setMaxDevicesError("最大设备数必须为 1-10000 的整数");
      ok = false;
    } else {
      setMaxDevicesError(undefined);
    }
    return ok;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !app) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const updated = await patch<App>(user, `/api/apps/${app.id}`, {
        name: name.trim(),
        description,
        version,
        announcement,
        forceUpdate,
        minVersion: minVersion || undefined,
        updateUrl: updateUrl || undefined,
        heartbeatInterval: Number(heartbeatInterval),
        maxDevices: Number(maxDevices),
        unbindRule,
      });
      setApp(updated);
      toast.success("应用配置已保存");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("保存应用配置失败");
      }
    } finally {
      setSaving(false);
    }
  }

  async function onRegenerate() {
    if (!user || !app) return;
    setActionLoading(true);
    try {
      const result = await post<{ signature: string }>(
        user,
        `/api/apps/${app.id}/regenerate-signature`,
      );
      setApp({ ...app, config_signature: result.signature });
      toast.success("配置签名已重新生成");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("重签失败");
      }
    } finally {
      setActionLoading(false);
      setSignConfirm(false);
    }
  }

  async function onDisable() {
    if (!user || !app) return;
    setActionLoading(true);
    try {
      const updated = await del<App>(user, `/api/apps/${app.id}`);
      setApp(updated);
      toast.success("应用已停用");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("停用应用失败");
      }
    } finally {
      setActionLoading(false);
      setDisableConfirm(false);
    }
  }

  if (loading) return <PageLoading />;
  if (!app) {
    return (
      <EmptyState
        title="应用不存在或无权访问"
        description="可能已被删除，或您没有权限查看此应用"
      />
    );
  }

  const isDisabled = app.status === "disabled";
  const configSignature = app.config_signature;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={app.name}
        subtitle={`AppKey ${app.app_key}`}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/developer/apps")}
          >
            返回列表
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="基本信息"
          description={`创建于 ${formatDateTime(app.created_at)}`}
          action={
            <Badge variant={isDisabled ? "default" : "success"}>
              {APP_STATUS_LABEL[app.status] ?? app.status}
            </Badge>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoItem label="AppKey" value={app.app_key} mono onCopy={() => copyText(app.app_key, "AppKey")} />
            <InfoItem label="加密模式" value={app.crypto_mode} />
            <InfoItem
              label="RSA 公钥"
              value={app.rsa_public_key}
              mono
              multiline
              onCopy={() => copyText(app.rsa_public_key, "RSA 公钥")}
            />
            <InfoItem
              label="配置签名"
              value={configSignature ?? "-"}
              mono
              multiline
              onCopy={
                configSignature
                  ? () => copyText(configSignature, "配置签名")
                  : undefined
              }
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="编辑配置"
          description={
            isDisabled
              ? "应用已停用，无法编辑配置"
              : "保存后服务端将自动重新生成配置签名"
          }
        />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={onSave}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                id="name"
                label="应用名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={nameError}
                maxLength={50}
                disabled={isDisabled}
              />
              <Input
                id="version"
                label="当前版本号"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="如 1.0.0"
                disabled={isDisabled}
              />
            </div>

            <Textarea
              id="description"
              label="应用描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              className="min-h-[80px]"
              disabled={isDisabled}
            />

            <Textarea
              id="announcement"
              label="公告内容"
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder="选填，向客户端下发的公告"
              className="min-h-[80px]"
              disabled={isDisabled}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                id="minVersion"
                label="最低版本号"
                value={minVersion}
                onChange={(e) => setMinVersion(e.target.value)}
                placeholder="低于此版本将触发更新"
                disabled={isDisabled}
              />
              <Input
                id="updateUrl"
                label="更新地址"
                value={updateUrl}
                onChange={(e) => setUpdateUrl(e.target.value)}
                placeholder="应用更新下载地址"
                disabled={isDisabled}
              />
              <Input
                id="heartbeatInterval"
                label="心跳间隔（秒）"
                type="number"
                value={heartbeatInterval}
                onChange={(e) => setHeartbeatInterval(e.target.value)}
                error={heartbeatError}
                disabled={isDisabled}
              />
              <Input
                id="maxDevices"
                label="最大绑定设备数"
                type="number"
                value={maxDevices}
                onChange={(e) => setMaxDevices(e.target.value)}
                error={maxDevicesError}
                hint="1-10000"
                disabled={isDisabled}
              />
              <Select
                id="unbindRule"
                label="解绑规则"
                value={unbindRule}
                onChange={(e) => setUnbindRule(e.target.value)}
                disabled={isDisabled}
              >
                {UNBIND_RULE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  强制更新
                </label>
                <label className="inline-flex items-center gap-2 h-10 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={forceUpdate}
                    onChange={(e) => setForceUpdate(e.target.checked)}
                    disabled={isDisabled}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>低于最低版本时强制更新</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="submit" loading={saving} disabled={isDisabled}>
                保存配置
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="危险操作" description="重签与停用操作不可逆，请谨慎" />
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">重新生成配置签名</p>
              <p className="text-xs text-foreground-muted mt-1">
                用于防篡改校验，配置异常时可手动重签
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={actionLoading}
              onClick={() => setSignConfirm(true)}
              disabled={isDisabled}
            >
              重新签名
            </Button>
          </div>
          <div className="my-4 border-t border-border" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">停用应用</p>
              <p className="text-xs text-foreground-muted mt-1">
                停用后客户端将无法鉴权，且无法再编辑配置
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading}
              onClick={() => setDisableConfirm(true)}
              disabled={isDisabled}
            >
              停用应用
            </Button>
          </div>
        </CardBody>
      </Card>

      <ConfirmModal
        open={signConfirm}
        onClose={() => setSignConfirm(false)}
        onConfirm={onRegenerate}
        title="重新生成配置签名"
        message="确认重新生成配置签名？客户端需更新到对应公钥才能通过校验。"
        confirmText="确认重签"
        loading={actionLoading}
      />

      <ConfirmModal
        open={disableConfirm}
        onClose={() => setDisableConfirm(false)}
        onConfirm={onDisable}
        title="停用应用"
        message="停用后客户端将无法鉴权，且此操作不可逆，确定停用此应用吗？"
        confirmText="确认停用"
        danger
        loading={actionLoading}
      />
    </div>
  );
}

function InfoItem({
  label,
  value,
  mono = false,
  multiline = false,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
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
        } ${multiline ? "max-h-32 overflow-y-auto whitespace-pre-wrap" : "truncate"}`}
      >
        {value}
      </div>
    </div>
  );
}
