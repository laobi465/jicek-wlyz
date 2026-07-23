"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmModal } from "@/components/ui/modal";
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
import { get, patch, ApiError } from "@/lib/http";

/**
 * 用户管理 /admin/users
 *
 * - GET /api/admin/users?role=&status=&keyword=&limit=20&offset= → { users, total }
 * - PATCH /api/admin/users/[userId]/status { status }
 * - PATCH /api/admin/users/[userId]/role { role }
 *
 * balance 为 Decimal 序列化 string，前端 Number() 转换。
 */

interface AdminUserView {
  id: string;
  email: string;
  nickname: string | null;
  role: string;
  status: string;
  agent_level: number | null;
  parent_agent_id: string | null;
  two_factor_enabled: boolean;
  balance: string;
  created_at: string;
  last_login_at: string | null;
}

interface ListResponse {
  users: AdminUserView[];
  total: number;
}

const PAGE_SIZE = 20;

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部角色" },
  { value: "super_admin", label: "超级管理员" },
  { value: "agent", label: "代理" },
  { value: "developer", label: "开发者" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "banned", label: "已封禁" },
  { value: "pending", label: "待审核" },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: "超级管理员",
  agent: "代理",
  developer: "开发者",
};

const ROLE_VARIANT: Record<string, "primary" | "info" | "default"> = {
  super_admin: "primary",
  agent: "info",
  developer: "default",
};

const STATUS_LABEL: Record<string, string> = {
  active: "正常",
  banned: "已封禁",
  pending: "待审核",
};

const STATUS_VARIANT: Record<string, "success" | "danger" | "warning"> = {
  active: "success",
  banned: "danger",
  pending: "warning",
};

const EDITABLE_ROLES = ["agent", "developer", "super_admin"];

function formatYuan(value: string): string {
  return Number(value).toFixed(2);
}

export default function AdminUsersPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <AdminUsersPageInner />
    </AuthGuard>
  );
}

function AdminUsersPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 状态变更弹窗
  const [statusTarget, setStatusTarget] = useState<AdminUserView | null>(null);
  const [nextStatus, setNextStatus] = useState<string>("active");
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  // 角色变更弹窗
  const [roleTarget, setRoleTarget] = useState<AdminUserView | null>(null);
  const [nextRole, setNextRole] = useState<string>("developer");
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/admin/users", {
        role: role || undefined,
        status: status || undefined,
        keyword: keyword || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载用户列表失败");
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, role, status, keyword, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [role, status, keyword]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function applyKeyword() {
    setKeyword(keywordInput.trim());
  }

  function openStatusModal(u: AdminUserView) {
    setStatusTarget(u);
    setNextStatus(u.status === "active" ? "banned" : "active");
  }

  async function onConfirmStatus() {
    if (!user || !statusTarget) return;
    setStatusSubmitting(true);
    try {
      await patch(user, `/api/admin/users/${statusTarget.id}/status`, {
        status: nextStatus,
      });
      toast.success("用户状态已更新");
      setStatusTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("更新用户状态失败");
      }
    } finally {
      setStatusSubmitting(false);
    }
  }

  function openRoleModal(u: AdminUserView) {
    setRoleTarget(u);
    setNextRole(u.role);
  }

  async function onConfirmRole() {
    if (!user || !roleTarget) return;
    if (nextRole === roleTarget.role) {
      setRoleTarget(null);
      return;
    }
    setRoleSubmitting(true);
    try {
      await patch(user, `/api/admin/users/${roleTarget.id}/role`, {
        role: nextRole,
      });
      toast.success("用户角色已更新");
      setRoleTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("更新用户角色失败");
      }
    } finally {
      setRoleSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="用户管理" subtitle="全平台用户列表与状态/角色管理" />

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-32"
            aria-label="按角色筛选"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
          <Input
            className="w-56"
            placeholder="邮箱 / 昵称"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyKeyword();
            }}
            aria-label="按关键词搜索"
          />
          <Button size="sm" variant="secondary" onClick={applyKeyword}>
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
                <TH>邮箱</TH>
                <TH>昵称</TH>
                <TH>角色</TH>
                <TH>状态</TH>
                <TH>余额</TH>
                <TH>2FA</TH>
                <TH>注册时间</TH>
                <TH>最近登录</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.users.length > 0 ? (
                data.users.map((u) => (
                  <TR key={u.id}>
                    <TD className="text-foreground break-all">{u.email}</TD>
                    <TD className="text-foreground-muted">
                      {u.nickname || "-"}
                    </TD>
                    <TD>
                      <Badge variant={ROLE_VARIANT[u.role] ?? "default"}>
                        {ROLE_LABEL[u.role] ?? u.role}
                        {u.agent_level ? ` L${u.agent_level}` : ""}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[u.status] ?? "default"}>
                        {STATUS_LABEL[u.status] ?? u.status}
                      </Badge>
                    </TD>
                    <TD className="text-foreground font-medium whitespace-nowrap">
                      {formatYuan(u.balance)} 元
                    </TD>
                    <TD>
                      <Badge variant={u.two_factor_enabled ? "success" : "default"}>
                        {u.two_factor_enabled ? "已开启" : "未开启"}
                      </Badge>
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(u.created_at)}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(u.last_login_at)}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openStatusModal(u)}
                        >
                          {u.status === "active" ? "封禁" : "解封"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openRoleModal(u)}
                        >
                          改角色
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow colSpan={9} message="暂无用户" />
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

      {/* 状态变更弹窗 */}
      <ConfirmModal
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={onConfirmStatus}
        loading={statusSubmitting}
        title="变更用户状态"
        confirmText="确认变更"
        danger={nextStatus === "banned"}
        message={
          statusTarget ? (
            <span>
              确定将用户{" "}
              <span className="font-medium">{statusTarget.email}</span> 的状态变更为{" "}
              <span className="font-medium">
                {STATUS_LABEL[nextStatus] ?? nextStatus}
              </span>
              ？
              {statusTarget.id === user?.id && nextStatus !== "active" && (
                <span className="block mt-2 text-danger text-xs">
                  注意：不允许封禁自己。
                </span>
              )}
            </span>
          ) : (
            ""
          )
        }
      />

      {/* 角色变更弹窗 */}
      <Modal
        open={!!roleTarget}
        onClose={() => setRoleTarget(null)}
        title="变更用户角色"
        description={roleTarget ? `用户：${roleTarget.email}` : undefined}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRoleTarget(null)}
              disabled={roleSubmitting}
            >
              取消
            </Button>
            <Button size="sm" loading={roleSubmitting} onClick={onConfirmRole}>
              确认变更
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="新角色"
            value={nextRole}
            onChange={(e) => setNextRole(e.target.value)}
          >
            {EDITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          {roleTarget?.id === user?.id && nextRole !== "super_admin" && (
            <p className="text-xs text-danger">
              注意：不允许将自己降级为非超管。
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
