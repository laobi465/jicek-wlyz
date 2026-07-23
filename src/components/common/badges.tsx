import { Badge } from "@/components/ui/badge";

/**
 * 工单 / 通知 / 签到等共享枚举与 UI 映射
 *
 * 类型来源（铁律 13 严格遵循项目文档规范）：
 * - TicketStatus / TicketCategory / TicketPriority：src/server/modules/ticket/ticket-service.ts
 * - NotificationType：src/server/modules/notification/notification-service.ts
 */

// ---------------------------------------------------------------------------
// 工单状态
// ---------------------------------------------------------------------------

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketCategory = "bug" | "feature" | "billing" | "other";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  closed: "已关闭",
};

export const TICKET_STATUS_VARIANT: Record<
  TicketStatus,
  "default" | "primary" | "success" | "warning"
> = {
  open: "warning",
  in_progress: "primary",
  resolved: "success",
  closed: "default",
};

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  bug: "缺陷",
  feature: "需求",
  billing: "计费",
  other: "其他",
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

export const TICKET_PRIORITY_VARIANT: Record<
  TicketPriority,
  "default" | "info" | "warning" | "danger"
> = {
  low: "default",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant={TICKET_STATUS_VARIANT[status]}>
      {TICKET_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge variant={TICKET_PRIORITY_VARIANT[priority]}>
      {TICKET_PRIORITY_LABEL[priority]}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: TicketCategory }) {
  return <Badge variant="default">{TICKET_CATEGORY_LABEL[category]}</Badge>;
}

// ---------------------------------------------------------------------------
// 通知类型
// ---------------------------------------------------------------------------

export type NotificationType =
  | "ticket"
  | "payment"
  | "withdrawal"
  | "system"
  | "apk"
  | "agent";

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  ticket: "工单",
  payment: "支付",
  withdrawal: "提现",
  system: "系统",
  apk: "APK 注入",
  agent: "代理",
};

export const NOTIFICATION_TYPE_VARIANT: Record<
  NotificationType,
  "default" | "primary" | "success" | "warning" | "danger" | "info"
> = {
  ticket: "primary",
  payment: "success",
  withdrawal: "warning",
  system: "default",
  apk: "info",
  agent: "info",
};

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

/** ISO 时间 → YYYY-MM-DD HH:mm */
export function formatDateTime(input: string | Date | null | undefined): string {
  if (!input) return "-";
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/** ISO 日期 → YYYY-MM-DD */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "-";
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
