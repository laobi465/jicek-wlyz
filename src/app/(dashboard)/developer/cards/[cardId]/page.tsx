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
 * 卡密详情 /developer/cards/[cardId]
 *
 * - GET /api/card-keys/[cardId] → CardKey（含 app）
 * - POST /api/card-keys/[cardId]/revoke → { revoked: true }
 * - POST /api/card-keys/[cardId]/blacklist → { blacklisted: true }
 *
 * 操作：作废 / 加黑名单（均带 ConfirmModal）
 */

interface CardKey {
  id: string;
  code: string;
  status: string;
  expires_at: string | null;
  remaining_count: number | null;
  rsa_signature: string;
  crc32_checksum: string;
  developer_watermark: string;
  created_at: string;
  updated_at: string;
  app: { id: string; name: string };
}

const CARD_STATUS_LABEL: Record<string, string> = {
  unused: "未使用",
  active: "已激活",
  expired: "已过期",
  disabled: "已作废",
  blacklisted: "黑名单",
};

const CARD_STATUS_VARIANT: Record<
  string,
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  unused: "default",
  active: "success",
  expired: "warning",
  disabled: "default",
  blacklisted: "danger",
};

export default function CardDetailPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <CardDetailPageInner />
    </AuthGuard>
  );
}

function CardDetailPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ cardId: string }>();
  const cardId = params?.cardId;

  const [card, setCard] = useState<CardKey | null>(null);
  const [loading, setLoading] = useState(true);

  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [blacklistConfirm, setBlacklistConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !cardId) return;
    setLoading(true);
    try {
      const data = await get<CardKey>(user, `/api/card-keys/${cardId}`);
      setCard(data);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载卡密失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, cardId, toast]);

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

  async function onRevoke() {
    if (!user || !card) return;
    setActionLoading(true);
    try {
      await post(user, `/api/card-keys/${card.id}/revoke`);
      toast.success("卡密已作废");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("作废卡密失败");
      }
    } finally {
      setActionLoading(false);
      setRevokeConfirm(false);
    }
  }

  async function onBlacklist() {
    if (!user || !card) return;
    setActionLoading(true);
    try {
      await post(user, `/api/card-keys/${card.id}/blacklist`);
      toast.success("卡密已加入黑名单");
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

  if (loading) return <PageLoading />;
  if (!card) {
    return (
      <EmptyState
        title="卡密不存在或无权访问"
        description="可能已被删除，或您没有权限查看此卡密"
      />
    );
  }

  // 已失效状态：作废 / 黑名单 / 已过期 不再展示操作
  const isInactive =
    card.status === "disabled" ||
    card.status === "blacklisted" ||
    card.status === "expired";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="卡密详情"
        subtitle={`卡密码 ${card.code}`}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/developer/cards")}
          >
            返回列表
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="基本信息"
          description={`创建于 ${formatDateTime(card.created_at)}`}
          action={
            <Badge variant={CARD_STATUS_VARIANT[card.status] ?? "default"}>
              {CARD_STATUS_LABEL[card.status] ?? card.status}
            </Badge>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="卡密码"
              value={card.code}
              mono
              onCopy={() => copyText(card.code, "卡密码")}
            />
            <Field label="归属应用" value={card.app?.name ?? "-"} />
            <Field
              label="过期时间"
              value={formatDateTime(card.expires_at)}
            />
            <Field
              label="剩余次数"
              value={card.remaining_count ?? "-"}
            />
            <Field
              label="CRC32 校验位"
              value={card.crc32_checksum}
              mono
              onCopy={() => copyText(card.crc32_checksum, "CRC32 校验位")}
            />
            <Field
              label="开发者水印"
              value={card.developer_watermark}
              mono
              multiline
              onCopy={() =>
                copyText(card.developer_watermark, "开发者水印")
              }
            />
            <Field
              label="RSA 签名"
              value={card.rsa_signature}
              mono
              multiline
              onCopy={() => copyText(card.rsa_signature, "RSA 签名")}
            />
            <Field
              label="更新时间"
              value={formatDateTime(card.updated_at)}
            />
          </div>
        </CardBody>
      </Card>

      {!isInactive && (
        <Card>
          <CardHeader title="卡密操作" description="作废与加黑名单均为不可逆操作" />
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">作废卡密</p>
                <p className="text-xs text-foreground-muted mt-1">
                  作废后客户端下次心跳将被拒绝服务
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                loading={actionLoading}
                onClick={() => setRevokeConfirm(true)}
              >
                作废
              </Button>
            </div>
            <div className="my-4 border-t border-border" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">加入黑名单</p>
                <p className="text-xs text-foreground-muted mt-1">
                  加入黑名单池后将被全局拦截，适用于被共享/破解的卡密
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
          </CardBody>
        </Card>
      )}

      <ConfirmModal
        open={revokeConfirm}
        onClose={() => setRevokeConfirm(false)}
        onConfirm={onRevoke}
        title="作废卡密"
        message="作废后客户端将无法继续使用此卡密，此操作不可逆，确定作废吗？"
        confirmText="确认作废"
        danger
        loading={actionLoading}
      />

      <ConfirmModal
        open={blacklistConfirm}
        onClose={() => setBlacklistConfirm(false)}
        onConfirm={onBlacklist}
        title="加入黑名单"
        message="加入黑名单后将全局拦截此卡密，此操作不可逆，确定加入黑名单吗？"
        confirmText="确认加黑"
        danger
        loading={actionLoading}
      />
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  multiline = false,
  onCopy,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  multiline?: boolean;
  onCopy?: () => void;
}) {
  const text = String(value);
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
        {text}
      </div>
    </div>
  );
}
