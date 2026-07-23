import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button 原子组件
 *
 * 变体：
 * - primary：藏蓝主色按钮（核心操作）
 * - secondary：白底边框按钮（次操作）
 * - ghost：无背景文字按钮（导航/链接）
 * - danger：红色危险操作
 *
 * 尺寸：sm / md / lg
 *
 * 规范：圆角 6px，hover 简洁过渡，禁 emoji / 夸张渐变
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover border border-transparent",
  secondary:
    "bg-white text-foreground border border-border hover:bg-background-subtle",
  ghost:
    "bg-transparent text-foreground border border-transparent hover:bg-background-subtle",
  danger:
    "bg-danger text-white hover:bg-red-600 border border-transparent",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
    >
      {loading && (
        <span
          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
