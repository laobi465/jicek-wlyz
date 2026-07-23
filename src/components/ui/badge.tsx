import type { ReactNode } from "react";

/**
 * Badge 原子组件
 *
 * 语义色：default / primary / success / warning / danger / info
 * 规范：极小圆角 4px，低饱和度背景，无 emoji
 */

type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  default: "bg-background-subtle text-foreground-muted border-border",
  primary: "bg-primary-subtle text-primary border-primary/20",
  success: "bg-emerald-50 text-accent-green border-emerald-200",
  warning: "bg-amber-50 text-accent-amber border-amber-200",
  danger: "bg-danger-subtle text-danger border-red-200",
  info: "bg-sky-50 text-accent-blue border-sky-200",
};

export function Badge({
  variant = "default",
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
