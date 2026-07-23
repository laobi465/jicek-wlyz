"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { PageHeader, PageLoading } from "@/components/layout/page-header";
import { get, post, put, request, ApiError } from "@/lib/http";

/**
 * 安全中心 /admin/security
 *
 * 2FA 状态：
 * - GET /api/two-factor → { enabled, required, backupCodesRemaining }
 * - POST /api/two-factor { accountName } → { secret, otpAuthUri, backupCodes }
 * - DELETE /api/two-factor { code }
 *
 * IP 白名单：
 * - GET /api/admin/ip-whitelist → { global: string[], user: string[] }
 * - PUT /api/admin/ip-whitelist { ips: string[] }
 *
 * 字段冲突说明：开启 2FA 后，User.ip_whitelist 字段被备份码占用，
 * 此时无法设置个人 IP 白名单（getUserIpWhitelist 返回空数组）。
 */

interface TwoFactorStatus {
  enabled: boolean;
  required: boolean;
  backupCodesRemaining: number;
}

interface EnableTwoFactorResult {
  secret: string;
  otpAuthUri: string;
  backupCodes: string[];
}

interface IpWhitelistData {
  global: string[];
  user: string[];
}

export default function SecurityPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <SecurityPageInner />
    </AuthGuard>
  );
}

function SecurityPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [tfStatus, setTfStatus] = useState<TwoFactorStatus | null | undefined>(
    undefined,
  );
  const [ipData, setIpData] = useState<IpWhitelistData | null>(null);

  // 开启 2FA 弹窗
  const [enableOpen, setEnableOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [enableResult, setEnableResult] = useState<EnableTwoFactorResult | null>(
    null,
  );
  const [enableSubmitting, setEnableSubmitting] = useState(false);
  const [enableError, setEnableError] = useState("");

  // 关闭 2FA 弹窗
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableSubmitting, setDisableSubmitting] = useState(false);
  const [disableError, setDisableError] = useState("");

  // IP 白名单编辑
  const [ipsText, setIpsText] = useState("");
  const [ipsSubmitting, setIpsSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [status, ips] = await Promise.all([
        get<TwoFactorStatus>(user, "/api/two-factor"),
        get<IpWhitelistData>(user, "/api/admin/ip-whitelist"),
      ]);
      setTfStatus(status);
      setIpData(ips);
      setIpsText(ips.user.join("\n"));
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载安全信息失败");
      }
      setTfStatus(null);
      setIpData(null);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function openEnableModal() {
    setAccountName(user?.email ?? "");
    setEnableResult(null);
    setEnableError("");
    setEnableOpen(true);
  }

  async function onConfirmEnable() {
    if (!user) return;
    if (!accountName.trim()) {
      setEnableError("请输入账号名称");
      return;
    }
    setEnableSubmitting(true);
    try {
      const result = await post<EnableTwoFactorResult>(user, "/api/two-factor", {
        accountName: accountName.trim(),
      });
      setEnableResult(result);
      toast.success("2FA 已开启，请妥善保存备份码");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("开启 2FA 失败");
      }
    } finally {
      setEnableSubmitting(false);
    }
  }

  function openDisableModal() {
    setDisableCode("");
    setDisableError("");
    setDisableOpen(true);
  }

  async function onConfirmDisable() {
    if (!user) return;
    if (!disableCode.trim()) {
      setDisableError("请输入 TOTP 验证码或备份码");
      return;
    }
    setDisableSubmitting(true);
    try {
      await request<unknown>(user, "/api/two-factor", {
        method: "DELETE",
        body: JSON.stringify({ code: disableCode.trim() }),
      });
      toast.success("2FA 已关闭");
      setDisableOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setDisableError(err.message);
      } else {
        setDisableError("关闭 2FA 失败");
      }
    } finally {
      setDisableSubmitting(false);
    }
  }

  async function onSaveIps() {
    if (!user) return;
    const ips = ipsText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    setIpsSubmitting(true);
    try {
      await put(user, "/api/admin/ip-whitelist", { ips });
      toast.success("个人 IP 白名单已更新");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("更新 IP 白名单失败");
      }
    } finally {
      setIpsSubmitting(false);
    }
  }

  if (tfStatus === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="2FA 与 IP 白名单" subtitle="超管账号安全设置" />
        <PageLoading />
      </div>
    );
  }

  if (tfStatus === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="2FA 与 IP 白名单" subtitle="超管账号安全设置" />
        <Card>
          <CardBody>无法加载安全信息，请稍后重试</CardBody>
        </Card>
      </div>
    );
  }

  const twoFactorLocked = tfStatus.enabled; // 开启 2FA 后个人白名单不可编辑（字段冲突）

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="2FA 与 IP 白名单" subtitle="超管账号安全设置" />

      {/* 2FA 状态卡片 */}
      <Card>
        <CardHeader
          title="两步验证（2FA）"
          description="超管与代理强制开启 2FA，使用 TOTP 验证码登录"
        />
        <CardBody>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-4">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">当前状态</dt>
              <dd>
                <Badge variant={tfStatus.enabled ? "success" : "warning"}>
                  {tfStatus.enabled ? "已开启" : "未开启"}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">是否强制</dt>
              <dd>
                <Badge variant={tfStatus.required ? "danger" : "default"}>
                  {tfStatus.required ? "强制开启" : "非强制"}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">剩余备份码</dt>
              <dd className="text-sm text-foreground">
                {tfStatus.backupCodesRemaining} 个
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex gap-3">
            {!tfStatus.enabled ? (
              <Button size="sm" onClick={openEnableModal}>
                开启 2FA
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={openDisableModal}>
                关闭 2FA
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* IP 白名单卡片 */}
      <Card>
        <CardHeader
          title="IP 白名单"
          description="超管登录 IP 限制（全局白名单来自环境变量，个人白名单存数据库）"
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-foreground-muted">
              全局白名单（环境变量 SUPER_ADMIN_IP_WHITELIST，只读）
            </p>
            <div className="flex flex-wrap gap-2">
              {ipData && ipData.global.length > 0 ? (
                ipData.global.map((ip) => (
                  <Badge key={ip} variant="default">
                    {ip}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-foreground-muted">
                  未配置全局白名单（不限制）
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-foreground-muted">
              个人白名单（每行一个 IP，支持 IPv4 与 CIDR）
            </p>
            {twoFactorLocked ? (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
                当前已开启 2FA，个人 IP 白名单字段被备份码占用，无法设置。
                如需配置个人 IP 白名单，请先关闭 2FA。
              </div>
            ) : (
              <Textarea
                id="ip-whitelist"
                placeholder={"1.2.3.4\n10.0.0.0/8"}
                value={ipsText}
                onChange={(e) => setIpsText(e.target.value)}
                className="font-mono"
                hint="留空表示不限制个人白名单"
              />
            )}
            {!twoFactorLocked && (
              <div>
                <Button
                  size="sm"
                  onClick={onSaveIps}
                  loading={ipsSubmitting}
                  disabled={ipsSubmitting}
                >
                  保存个人白名单
                </Button>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* 开启 2FA 弹窗 */}
      <Modal
        open={enableOpen}
        onClose={() => setEnableOpen(false)}
        title="开启两步验证（2FA）"
        size="lg"
        footer={
          enableResult ? (
            <Button size="sm" onClick={() => setEnableOpen(false)}>
              我已保存备份码
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEnableOpen(false)}
                disabled={enableSubmitting}
              >
                取消
              </Button>
              <Button
                size="sm"
                loading={enableSubmitting}
                onClick={onConfirmEnable}
              >
                开启
              </Button>
            </>
          )
        }
      >
        {enableResult ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
              2FA 已开启。请立即将以下密钥添加到验证器应用（如 Google
              Authenticator），并妥善保存备份码。备份码仅展示一次。
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-foreground-muted">TOTP 密钥</p>
              <code className="text-xs text-foreground bg-background-subtle rounded-md p-2 break-all font-mono">
                {enableResult.secret}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-foreground-muted">otpauth URI</p>
              <code className="text-xs text-foreground bg-background-subtle rounded-md p-2 break-all font-mono">
                {enableResult.otpAuthUri}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-foreground-muted">备份码（共 {enableResult.backupCodes.length} 个）</p>
              <div className="grid grid-cols-2 gap-2">
                {enableResult.backupCodes.map((c) => (
                  <code
                    key={c}
                    className="text-xs text-foreground bg-background-subtle rounded-md p-2 break-all font-mono"
                  >
                    {c}
                  </code>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <Input
            id="tf-account-name"
            label="账号名称"
            placeholder="用于 otpauth URI 标识（如邮箱）"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            error={enableError}
            hint="必填，建议使用邮箱"
          />
        )}
      </Modal>

      {/* 关闭 2FA 弹窗 */}
      <Modal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="关闭两步验证（2FA）"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDisableOpen(false)}
              disabled={disableSubmitting}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={disableSubmitting}
              onClick={onConfirmDisable}
            >
              确认关闭
            </Button>
          </>
        }
      >
        <Input
          id="tf-disable-code"
          label="TOTP 验证码或备份码"
          placeholder="请输入 6 位验证码或备份码"
          value={disableCode}
          onChange={(e) => setDisableCode(e.target.value)}
          error={disableError}
          hint="必填"
        />
      </Modal>
    </div>
  );
}
