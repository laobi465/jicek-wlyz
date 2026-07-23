import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Input / Textarea 原子组件
 *
 * 规范：细边框 #E2E8F0，聚焦主色高亮，圆角 6px，无多余装饰
 */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({
  label,
  error,
  hint,
  className = "",
  id,
  ...rest
}: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <input
        id={id}
        {...rest}
        className={`h-10 px-3 rounded-md border bg-white text-foreground text-sm placeholder:text-foreground-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${
          error ? "border-danger" : "border-border"
        } ${className}`}
      />
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-foreground-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Textarea({
  label,
  error,
  hint,
  className = "",
  id,
  ...rest
}: TextareaProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <textarea
        id={id}
        {...rest}
        className={`min-h-[96px] px-3 py-2 rounded-md border bg-white text-foreground text-sm placeholder:text-foreground-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${
          error ? "border-danger" : "border-border"
        } ${className}`}
      />
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-foreground-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Select({
  label,
  error,
  hint,
  className = "",
  id,
  children,
  ...rest
}: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <select
        id={id}
        {...rest}
        className={`h-10 px-3 rounded-md border bg-white text-foreground text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${
          error ? "border-danger" : "border-border"
        } ${className}`}
      >
        {children}
      </select>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-foreground-muted">{hint}</p>
      ) : null}
    </div>
  );
}
