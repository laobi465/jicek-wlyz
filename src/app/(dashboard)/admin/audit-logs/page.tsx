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
import { get, ApiError } from "@/lib/http";

/**
 * 审计日志 /admin/audit-logs
 *
 * - GET /api/audit-logs?userId=&action=&targetType=&startTime=&endTime=&limit=50&offset=
 *   → { logs: AuditLog[], total }
 *
 * 仅做只读展示。details 为 JSON 字符串，点击查看详情弹窗展开。
 */

interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  is_abnormal: boolean;
  created_at: string;
}

interface ListResponse {
  logs: AuditLog[];
  total: number;
}

const PAGE_SIZE = 50;

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部操作" },
  { value: "user_login", label: "用户登录" },
  { value: "user_logout", label: "用户登出" },
  { value: "user_register", label: "用户注册" },
  { value: "user_status_change", label: "用户状态变更" },
  { value: "user_role_change", label: "用户角色变更" },
  { value: "card_generate", label: "卡密生成" },
  { value: "card_revoke", label: "卡密作废" },
  { value: "agent_approve", label: "代理审核" },
  { value: "agent_freeze", label: "代理冻结" },
  { value: "withdrawal_approve", label: "提现通过" },
  { value: "withdrawal_reject", label: "提现驳回" },
  { value: "withdrawal_paid", label: "提现打款" },
  { value: "config_update", label: "配置更新" },
  { value: "update_trigger", label: "更新触发" },
  { value: "update_rollback", label: "更新回滚" },
  { value: "two_factor_enable", label: "2FA 开启" },
  { value: "two_factor_disable", label: "2FA 关闭" },
  { value: "ticket_create", label: "工单创建" },
  { value: "ticket_reply", label: "工单回复" },
];

const TARGET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部目标" },
  { value: "user", label: "用户" },
  { value: "card", label: "卡密" },
  { value: "agent", label: "代理" },
  { value: "withdrawal", label: "提现" },
  { value: "system_config", label: "系统配置" },
  { value: "ticket", label: "工单" },
  { value: "app", label: "应用" },
];

/** 美化 JSON 字符串展示 */
function prettyJson(raw: string | null): string {
  if (!raw) return "-";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function AuditLogsPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <AuditLogsPageInner />
    </AuthGuard>
  );
}

function AuditLogsPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  const [userId, setUserId] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 详情弹窗
  const [detailTarget, setDetailTarget] = useState<AuditLog | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/audit-logs", {
        userId: userId || undefined,
        action: action || undefined,
        targetType: targetType || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载审计日志失败");
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, userId, action, targetType, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [userId, action, targetType]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function applyUserId() {
    setUserId(userIdInput.trim());
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="审计日志" subtitle="全平台敏感操作审计记录（只读）" />

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-40"
            aria-label="按操作类型筛选"
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="w-32"
            aria-label="按目标类型筛选"
          >
            {TARGET_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input
            className="w-56"
            placeholder="操作者 User ID"
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyUserId();
            }}
            aria-label="按操作者筛选"
          />
          <Button size="sm" variant="secondary" onClick={applyUserId}>
            搜索
          </Button>
          <span className="text-xs text-foreground-muted">共 {total} 条</span>
        </div>

        {loading ? (
          <PageLoading />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>时间</TH>
                <TH>操作</TH>
                <TH>目标类型</TH>
                <TH>目标 ID</TH>
                <TH>操作者</TH>
                <TH>异常</TH>
                <TH>IP</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.logs.length > 0 ? (
                data.logs.map((log) => (
                  <TR key={log.id}>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </TD>
                    <TD className="text-foreground text-xs break-all">
                      {log.action}
                    </TD>
                    <TD className="text-foreground-muted text-xs">
                      {log.target_type}
                    </TD>
                    <TD className="text-foreground-muted text-xs break-all max-w-[160px]">
                      {log.target_id || "-"}
                    </TD>
                    <TD className="text-foreground-muted text-xs break-all">
                      {log.user_id || "-"}
                    </TD>
                    <TD>
                      {log.is_abnormal ? (
                        <Badge variant="danger">异常</Badge>
                      ) : (
                        <span className="text-xs text-foreground-muted">-</span>
                      )}
                    </TD>
                    <TD className="text-foreground-muted text-xs break-all">
                      {log.ip_address || "-"}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDetailTarget(log)}
                      >
                        详情
                      </Button>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow colSpan={8} message="暂无审计日志" />
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

      {/* 详情弹窗 */}
      <Modal
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title="审计日志详情"
        size="lg"
        footer={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDetailTarget(null)}
          >
            关闭
          </Button>
        }
      >
        {detailTarget && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <InfoItem label="记录 ID" value={detailTarget.id} />
            <InfoItem
              label="时间"
              value={formatDateTime(detailTarget.created_at)}
            />
            <InfoItem label="操作类型" value={detailTarget.action} />
            <InfoItem label="目标类型" value={detailTarget.target_type} />
            <InfoItem
              label="目标 ID"
              value={detailTarget.target_id || "-"}
            />
            <InfoItem
              label="操作者 ID"
              value={detailTarget.user_id || "-"}
            />
            <InfoItem
              label="IP 地址"
              value={detailTarget.ip_address || "-"}
            />
            <InfoItem
              label="是否异常"
              value={detailTarget.is_abnormal ? "是" : "否"}
            />
            <div className="sm:col-span-2 flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">User-Agent</dt>
              <dd className="text-sm text-foreground break-all">
                {detailTarget.user_agent || "-"}
              </dd>
            </div>
            <div className="sm:col-span-2 flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">操作详情</dt>
              <dd>
                <pre className="text-xs text-foreground bg-background-subtle rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {prettyJson(detailTarget.details)}
                </pre>
              </dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground break-all">{value}</dd>
    </div>
  );
}
