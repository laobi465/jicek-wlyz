"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
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
import {
  formatDateTime,
  StatusBadge,
  PriorityBadge,
  CategoryBadge,
} from "@/components/common/badges";
import { get, ApiError } from "@/lib/http";

/**
 * 工单客服 /admin/tickets
 *
 * - GET /api/tickets/list?status=&category=&limit=20&offset= → { tickets, total }
 *
 * 超管可见全部工单。点击行进入 /tickets/[ticketId] 处理回复（共用详情页）。
 */

interface Ticket {
  id: string;
  ticket_no: string;
  submitter_id: string;
  title: string;
  content: string;
  priority: string;
  status: string;
  category: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface ListResponse {
  tickets: Ticket[];
  total: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "open", label: "待处理" },
  { value: "in_progress", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
];

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部类型" },
  { value: "bug", label: "缺陷" },
  { value: "feature", label: "需求" },
  { value: "billing", label: "计费" },
  { value: "other", label: "其他" },
];

export default function AdminTicketsPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <AdminTicketsPageInner />
    </AuthGuard>
  );
}

function AdminTicketsPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/tickets/list", {
        status: status || undefined,
        category: category || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载工单列表失败");
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, status, category, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [status, category]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="工单客服" subtitle="全平台工单查看与处理（点击行进入详情）" />

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
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-32"
            aria-label="按类型筛选"
          >
            {CATEGORY_OPTIONS.map((o) => (
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
                <TH>工单号</TH>
                <TH>标题</TH>
                <TH>状态</TH>
                <TH>优先级</TH>
                <TH>类型</TH>
                <TH>提交人</TH>
                <TH>提交时间</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.tickets.length > 0 ? (
                data.tickets.map((t) => (
                  <TR key={t.id}>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {t.ticket_no}
                    </TD>
                    <TD className="text-foreground break-all max-w-xs">
                      {t.title}
                    </TD>
                    <TD>
                      <StatusBadge status={t.status as never} />
                    </TD>
                    <TD>
                      <PriorityBadge priority={t.priority as never} />
                    </TD>
                    <TD>
                      <CategoryBadge category={t.category as never} />
                    </TD>
                    <TD className="text-foreground-muted text-xs break-all">
                      {t.submitter_id}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(t.created_at)}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <Link href={`/tickets/${t.id}`}>
                        <Button size="sm" variant="secondary">
                          查看处理
                        </Button>
                      </Link>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow colSpan={8} message="暂无工单" />
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
