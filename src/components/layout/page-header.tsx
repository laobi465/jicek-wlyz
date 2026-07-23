import type { ReactNode } from "react";

/**
 * 通用页头
 *
 * 用于各业务页面的标题与副标题展示，统一视觉节奏
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-sm text-foreground-muted">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** 全屏加载态 */
export function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** 空态卡片 */
export function EmptyState({
  title = "暂无数据",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-foreground-muted">{description}</p>
      )}
    </div>
  );
}
