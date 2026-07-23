"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import {
  NOTIFICATION_TYPE_LABEL,
  NOTIFICATION_TYPE_VARIANT,
  formatDateTime,
  type NotificationType,
} from "@/components/common/badges";
import { get, post, ApiError } from "@/lib/http";

/**
 * 通知中心 /notifications
 *
 * - GET /api/notifications（参数：isRead / limit / offset → { notifications, total }）
 * - POST /api/notifications/read（标记单条已读；空 body 则全部已读）
 *
 * 通知类型（与 notification-service.ts 一致）：
 * ticket / payment / withdrawal / system / apk / agent
 */

interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  related_id: string | null;
  related_type: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

interface ListResponse {
  notifications: NotificationItem[];
  total: number;
}

const PAGE_SIZE = 20;

const FILTER_OPTIONS = [
  { value: "", label: "全部" },
  { value: "false", label: "未读" },
  { value: "true", label: "已读" },
];

export default function NotificationsPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [filter, setFilter] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/notifications", {
        isRead: filter === "" ? undefined : filter === "true",
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载通知失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, filter, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [filter]);

  async function markOne(n: NotificationItem) {
    if (!user || n.is_read) return;
    setMarkingId(n.id);
    try {
      await post(user, "/api/notifications/read", {
        notificationId: n.id,
      });
      // 本地更新，避免整页刷新
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          notifications: prev.notifications.map((x) =>
            x.id === n.id
              ? { ...x, is_read: true, read_at: new Date().toISOString() }
              : x,
          ),
        };
      });
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("标记已读失败");
      }
    } finally {
      setMarkingId(null);
    }
  }

  async function markAll() {
    if (!user) return;
    setMarkingAll(true);
    try {
      await post(user, "/api/notifications/read", {});
      toast.success("已标记全部未读通知为已读");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("标记全部已读失败");
      }
    } finally {
      setMarkingAll(false);
    }
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const unreadCount =
    data?.notifications.filter((n) => !n.is_read).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="通知"
        subtitle="工单 / 支付 / 提现 / 系统等站内消息"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={markAll}
            disabled={markingAll || unreadCount === 0}
            loading={markingAll}
          >
            全部标记已读
          </Button>
        }
      />

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-32"
            aria-label="按已读状态筛选"
          >
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <span className="text-xs text-foreground-muted">
            共 {total} 条
          </span>
        </div>

        {loading ? (
          <PageLoading />
        ) : data && data.notifications.length > 0 ? (
          <ul className="divide-y divide-border">
            {data.notifications.map((n) => {
              const type = n.type as NotificationType;
              const typeLabel =
                NOTIFICATION_TYPE_LABEL[type] ?? n.type;
              const typeVariant = NOTIFICATION_TYPE_VARIANT[type] ?? "default";
              return (
                <li
                  key={n.id}
                  className={`px-5 py-4 flex items-start gap-3 ${
                    n.is_read ? "" : "bg-primary-subtle/40"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={typeVariant}>{typeLabel}</Badge>
                      <span className="text-sm font-medium text-foreground truncate">
                        {n.title}
                      </span>
                      {!n.is_read && (
                        <span
                          className="inline-block w-2 h-2 rounded-full bg-danger shrink-0"
                          aria-label="未读"
                        />
                      )}
                    </div>
                    <p className="text-sm text-foreground leading-6 break-words">
                      {n.content}
                    </p>
                    <p className="text-xs text-foreground-muted mt-1">
                      {formatDateTime(n.created_at)}
                    </p>
                  </div>
                  {!n.is_read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markOne(n)}
                      loading={markingId === n.id}
                    >
                      标为已读
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="暂无通知"
            description="工单回复、支付完成等消息会在此显示"
          />
        )}

        {total > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-3">
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
      </Card>
    </div>
  );
}
