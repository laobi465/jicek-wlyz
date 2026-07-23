import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes, TableHTMLAttributes } from "react";

/**
 * Table 原子组件
 *
 * 规范：行间距充足，斑马纹极浅 #F8FAFC，无重边框
 */

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

export function Table({ className = "", children, ...rest }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table
        {...rest}
        className={`w-full text-sm border-collapse ${className}`}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-background-subtle text-foreground-muted">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-background-subtle/50 transition-colors">
      {children}
    </tr>
  );
}

export function TH({
  children,
  className = "",
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      className={`text-left font-medium px-4 py-3 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className = "",
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...rest} className={`px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}

/** 空状态行 */
export function EmptyRow({
  colSpan,
  message = "暂无数据",
}: {
  colSpan: number;
  message?: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-12 text-center text-foreground-muted"
      >
        {message}
      </td>
    </tr>
  );
}
