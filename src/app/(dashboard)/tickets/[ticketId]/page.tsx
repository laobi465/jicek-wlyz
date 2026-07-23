"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/modal";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import {
  StatusBadge,
  PriorityBadge,
  CategoryBadge,
  TICKET_STATUS_LABEL,
  formatDateTime,
  type TicketStatus,
  type TicketCategory,
  type TicketPriority,
} from "@/components/common/badges";
import { get, post, patch, ApiError } from "@/lib/http";

/**
 * 工单详情 /tickets/[ticketId]
 *
 * - GET /api/tickets/[ticketId] → 工单 + 回复列表
 * - POST /api/tickets/[ticketId]/replies → 回复（content）
 * - PATCH /api/tickets/[ticketId]/status → 状态更新
 *
 * 权限（与后端 ticket-service.ts 一致）：
 * - 仅提交者本人或超管可查看
 * - closed 状态禁止回复
 * - 提交者仅可关闭，超管可标记已解决 / 关闭
 */

interface TicketReply {
  id: string;
  ticket_id: string;
  user_id: string;
  content: string;
  is_staff: boolean;
  created_at: string;
}

interface TicketDetail {
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
  replies: TicketReply[];
}

const MAX_REPLY = 2000;

export default function TicketDetailPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ ticketId: string }>();
  const ticketId = params?.ticketId;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState("");
  const [replying, setReplying] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [resolveConfirm, setResolveConfirm] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = useCallback(async () => {
    if (!user || !ticketId) return;
    setLoading(true);
    try {
      const data = await get<TicketDetail>(user, `/api/tickets/${ticketId}`);
      setTicket(data);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载工单失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, ticketId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageLoading />;
  if (!ticket) {
    return (
      <EmptyState
        title="工单不存在或无权访问"
        description="可能已被删除，或您没有权限查看此工单"
      />
    );
  }

  const isStaff = user?.role === "super_admin";
  const isSubmitter = user?.id === ticket.submitter_id;
  const isClosed = ticket.status === "closed";
  // 已解决状态：客服可关闭；用户可重新打开（通过回复）
  // 仅提交者本人或超管可回复；非两者则禁止回复
  const canReply = (isStaff || isSubmitter) && !isClosed;
  // 提交者可关闭；超管可标记已解决 / 关闭
  const canClose =
    !isClosed && (isSubmitter || isStaff) && ticket.status !== "closed";
  const canResolve =
    isStaff && !isClosed && ticket.status !== "resolved";

  async function onReply(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !ticket) return;
    const text = replyContent.trim();
    if (!text) {
      toast.warning("请输入回复内容");
      return;
    }
    if (text.length > MAX_REPLY) {
      toast.warning(`回复内容不超过 ${MAX_REPLY} 字符`);
      return;
    }
    setReplying(true);
    try {
      await post(user, `/api/tickets/${ticket.id}/replies`, { content: text });
      setReplyContent("");
      toast.success("回复成功");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("回复失败");
      }
    } finally {
      setReplying(false);
    }
  }

  async function updateStatus(target: TicketStatus) {
    if (!user || !ticket) return;
    setUpdatingStatus(true);
    try {
      await patch(user, `/api/tickets/${ticket.id}/status`, {
        status: target,
      });
      toast.success(
        target === "closed"
          ? "工单已关闭"
          : target === "resolved"
            ? "工单已标记为已解决"
            : "状态已更新",
      );
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("更新状态失败");
      }
    } finally {
      setUpdatingStatus(false);
      setCloseConfirm(false);
      setResolveConfirm(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={ticket.title}
        subtitle={`工单编号 ${ticket.ticket_no}`}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/tickets")}
          >
            返回列表
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="工单信息"
          description={`提交于 ${formatDateTime(ticket.created_at)}`}
          action={<StatusBadge status={ticket.status as TicketStatus} />}
        />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <CategoryBadge category={ticket.category as TicketCategory} />
            <PriorityBadge priority={ticket.priority as TicketPriority} />
            {ticket.closed_at && (
              <Badge variant="default">
                关闭于 {formatDateTime(ticket.closed_at)}
              </Badge>
            )}
          </div>
          <div className="rounded-md bg-background-subtle p-4 text-sm text-foreground leading-6 whitespace-pre-wrap break-words">
            {ticket.content}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`回复（${ticket.replies.length}）`}
          description={
            isClosed
              ? "工单已关闭，无法继续回复"
              : isStaff
                ? "您的回复将自动置为处理中状态"
                : isSubmitter
                  ? "如工单已被客服标记已解决，您的新回复会重新打开工单"
                  : "您没有权限回复此工单"
          }
        />
        <CardBody>
          {ticket.replies.length === 0 ? (
            <p className="text-sm text-foreground-muted py-6 text-center">
              暂无回复
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {ticket.replies.map((r) => (
                <li
                  key={r.id}
                  className={`rounded-md p-4 border ${
                    r.is_staff
                      ? "bg-primary-subtle border-primary/20"
                      : "bg-background-subtle border-border"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={r.is_staff ? "primary" : "default"}>
                        {r.is_staff ? "客服" : "提交者"}
                      </Badge>
                      <span className="text-xs text-foreground-muted">
                        {formatDateTime(r.created_at)}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-foreground leading-6 whitespace-pre-wrap break-words">
                    {r.content}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canReply && (
            <form
              className="mt-5 flex flex-col gap-3"
              onSubmit={onReply}
            >
              <Textarea
                id="reply"
                label="回复内容"
                placeholder="请输入回复内容"
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                hint={`已输入 ${replyContent.length} / ${MAX_REPLY} 字符`}
                maxLength={MAX_REPLY}
                className="min-h-[120px]"
              />
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" loading={replying}>
                  回复
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      {(canClose || canResolve) && (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">状态管理</p>
                <p className="text-xs text-foreground-muted mt-1">
                  当前状态：{TICKET_STATUS_LABEL[ticket.status as TicketStatus]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canResolve && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={updatingStatus}
                    onClick={() => setResolveConfirm(true)}
                  >
                    标记已解决
                  </Button>
                )}
                {canClose && (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={updatingStatus}
                    onClick={() => setCloseConfirm(true)}
                  >
                    关闭工单
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="text-xs text-foreground-muted">
        <Link href="/tickets" className="hover:text-primary">
          返回工单列表
        </Link>
      </div>

      <ConfirmModal
        open={closeConfirm}
        onClose={() => setCloseConfirm(false)}
        onConfirm={() => updateStatus("closed")}
        title="关闭工单"
        message="关闭后将无法继续回复，确定关闭此工单吗？"
        confirmText="确认关闭"
        danger
        loading={updatingStatus}
      />

      <ConfirmModal
        open={resolveConfirm}
        onClose={() => setResolveConfirm(false)}
        onConfirm={() => updateStatus("resolved")}
        title="标记已解决"
        message="确认此工单已解决？提交者仍可重新回复以打开工单。"
        confirmText="确认"
        loading={updatingStatus}
      />
    </div>
  );
}
