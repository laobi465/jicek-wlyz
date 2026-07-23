import type { HTMLAttributes, ReactNode } from "react";

/**
 * Card 原子组件
 *
 * 规范：白色背景，极浅灰边框 #E2E8F0，圆角 8px，极淡阴影
 */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = "", children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={`bg-white border border-border rounded-lg shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function CardHeader({
  title,
  description,
  action,
  className = "",
  ...rest
}: CardHeaderProps) {
  return (
    <div
      {...rest}
      className={`flex items-start justify-between gap-4 px-5 py-4 border-b border-border ${className}`}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-foreground-muted">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`px-5 py-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardFooter({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`px-5 py-3 border-t border-border bg-background-subtle/50 rounded-b-lg ${className}`}
    >
      {children}
    </div>
  );
}
