"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
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
import { get, post, ApiError } from "@/lib/http";

/**
 * 邀请码 /agent/invitations
 *
 * - GET /api/invitations → { invitations: InvitationCode[] }（listInvitationsByGenerator，含 user）
 * - POST /api/invitations { type, targetLevel?, usageMode?, maxUses?, expiresInDays? } → InvitationCode（201）
 */

interface InvitationUser {
  id: string;
  email: string;
  nickname: string | null;
}

interface InvitationCode {
  id: string;
  code: string;
  generator_id: string;
  user_id: string | null;
  type: string;
  target_level: number | null;
  usage_mode: string;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  bound_to: string | null;
  created_at: string;
  used_at: string | null;
  user: InvitationUser | null;
}

interface ListResponse {
  invitations: InvitationCode[];
}

const TYPE_LABEL: Record<string, string> = {
  developer: "开发者",
  agent: "代理",
};

const TYPE_VARIANT: Record<string, "primary" | "info"> = {
  developer: "info",
  agent: "primary",
};

const USAGE_LABEL: Record<string, string> = {
  once: "一次性",
  reusable: "可复用",
  limited: "限量",
};

const LEVEL_LABEL: Record<number, string> = {
  1: "一级",
  2: "二级",
  3: "三级",
};

/** 计算邀请码状态：有效 / 已用 / 已过期 */
function computeStatus(inv: InvitationCode): {
  label: string;
  variant: "success" | "default" | "warning";
} {
  const now = Date.now();
  const expired =
    inv.expires_at !== null && new Date(inv.expires_at).getTime() < now;
  if (expired) {
    return { label: "已过期", variant: "default" };
  }
  const fullyUsed =
    inv.used_at !== null ||
    (inv.usage_mode === "once" && inv.used_count >= 1) ||
    (inv.usage_mode === "limited" &&
      inv.max_uses !== null &&
      inv.used_count >= inv.max_uses);
  if (fullyUsed) {
    return { label: "已用", variant: "default" };
  }
  return { label: "有效", variant: "success" };
}

export default function InvitationsPage() {
  return (
    <AuthGuard allow={["agent"]}>
      <InvitationsPageInner />
    </AuthGuard>
  );
}

function InvitationsPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [invitations, setInvitations] = useState<InvitationCode[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建邀请码弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<"developer" | "agent">("agent");
  const [targetLevel, setTargetLevel] = useState<string>("1");
  const [usageMode, setUsageMode] = useState<"once" | "reusable" | "limited">(
    "once",
  );
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/invitations");
      setInvitations(result.invitations ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载邀请码失败");
      }
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("邀请码已复制");
    } catch {
      toast.danger("复制失败，请手动选择复制");
    }
  }

  function openCreate() {
    setType("agent");
    setTargetLevel("1");
    setUsageMode("once");
    setMaxUses("");
    setExpiresInDays("");
    setErrors({});
    setCreateOpen(true);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (type === "agent" && !targetLevel) {
      next.targetLevel = "请选择目标层级";
    }
    if (usageMode === "limited") {
      const n = Number(maxUses);
      if (!maxUses || !Number.isInteger(n) || n <= 0) {
        next.maxUses = "请输入正整数";
      }
    }
    if (expiresInDays.trim()) {
      const n = Number(expiresInDays);
      if (!Number.isFinite(n) || n <= 0) {
        next.expiresInDays = "必须为正数";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onCreate() {
    if (!user) return;
    if (!validate()) return;

    const body: Record<string, unknown> = {
      type,
      usageMode,
    };
    if (type === "agent") {
      body.targetLevel = Number(targetLevel);
    }
    if (usageMode === "limited") {
      body.maxUses = Number(maxUses);
    }
    if (expiresInDays.trim()) {
      body.expiresInDays = Number(expiresInDays);
    }

    setSubmitting(true);
    try {
      await post<InvitationCode>(user, "/api/invitations", body);
      toast.success("邀请码已创建");
      setCreateOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("创建邀请码失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="邀请码"
        subtitle="生成邀请码邀请新代理或开发者加入"
        action={
          <Button size="sm" onClick={openCreate}>
            创建邀请码
          </Button>
        }
      />

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <span className="text-xs text-foreground-muted">
            共 {invitations.length} 条邀请码
          </span>
        </div>

        {loading ? (
          <PageLoading />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>邀请码</TH>
                <TH>类型</TH>
                <TH>使用模式</TH>
                <TH>目标层级</TH>
                <TH>已用/上限</TH>
                <TH>过期时间</TH>
                <TH>创建时间</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              {invitations.length > 0 ? (
                invitations.map((inv) => {
                  const status = computeStatus(inv);
                  return (
                    <TR key={inv.id}>
                      <TD>
                        <button
                          type="button"
                          onClick={() => copyCode(inv.code)}
                          className="font-mono text-xs text-primary hover:underline break-all text-left"
                          title="点击复制"
                        >
                          {inv.code}
                        </button>
                      </TD>
                      <TD>
                        <Badge variant={TYPE_VARIANT[inv.type] ?? "default"}>
                          {TYPE_LABEL[inv.type] ?? inv.type}
                        </Badge>
                      </TD>
                      <TD className="text-xs">
                        {USAGE_LABEL[inv.usage_mode] ?? inv.usage_mode}
                      </TD>
                      <TD className="text-xs">
                        {inv.target_level !== null
                          ? LEVEL_LABEL[inv.target_level] ??
                            `第 ${inv.target_level} 级`
                          : "-"}
                      </TD>
                      <TD className="text-xs">
                        {inv.used_count}
                        {inv.max_uses !== null ? ` / ${inv.max_uses}` : " / ∞"}
                      </TD>
                      <TD className="text-foreground-muted text-xs whitespace-nowrap">
                        {inv.expires_at ? formatDateTime(inv.expires_at) : "永久"}
                      </TD>
                      <TD className="text-foreground-muted text-xs whitespace-nowrap">
                        {formatDateTime(inv.created_at)}
                      </TD>
                      <TD>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TD>
                    </TR>
                  );
                })
              ) : (
                <EmptyRow
                  colSpan={8}
                  message="暂无邀请码，点击右上角“创建邀请码”开始"
                />
              )}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建邀请码"
        description="选择类型与使用模式，生成后可复制分享"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button size="sm" loading={submitting} onClick={onCreate}>
              创建
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            id="inv-type"
            label="类型"
            value={type}
            onChange={(e) => {
              setType(e.target.value as "developer" | "agent");
            }}
            hint="agent 邀请代理，developer 邀请开发者"
          >
            <option value="agent">代理</option>
            <option value="developer">开发者</option>
          </Select>

          {type === "agent" && (
            <Select
              id="inv-level"
              label="目标层级"
              value={targetLevel}
              onChange={(e) => setTargetLevel(e.target.value)}
              error={errors.targetLevel}
              hint="代理类型必填，1/2/3 级"
            >
              <option value="1">一级代理</option>
              <option value="2">二级代理</option>
              <option value="3">三级代理</option>
            </Select>
          )}

          <Select
            id="inv-usage"
            label="使用模式"
            value={usageMode}
            onChange={(e) => {
              setUsageMode(
                e.target.value as "once" | "reusable" | "limited",
              );
            }}
          >
            <option value="once">一次性</option>
            <option value="reusable">可复用</option>
            <option value="limited">限量</option>
          </Select>

          {usageMode === "limited" && (
            <Input
              id="inv-max-uses"
              label="最大使用次数"
              type="number"
              min={1}
              step={1}
              placeholder="如 10"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              error={errors.maxUses}
              hint="限量模式必填，正整数"
            />
          )}

          <Input
            id="inv-expires"
            label="有效期（天）"
            type="number"
            min={0}
            step={1}
            placeholder="选填，留空表示永久"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            error={errors.expiresInDays}
            hint="选填，正数，留空表示永久有效"
          />
        </div>
      </Modal>
    </div>
  );
}
