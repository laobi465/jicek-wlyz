"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * 全局 Toast 通知（轻量自实现，不引外部库）
 *
 * UI 规范（铁律 03）：
 * - 白底卡片 + 极浅边框 + 极淡阴影
 * - 圆角 6px
 * - 禁 emoji / 毛玻璃 / 夸张渐变
 * - 主色 / 成功 / 警示 / 危险 四种语义色
 */

type ToastVariant = "info" | "success" | "warning" | "danger";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
  danger: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 消费 Toast */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast 必须在 <ToastProvider> 内使用");
  }
  return ctx;
}

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = ++toastSeq;
      setToasts((prev) => [...prev, { id, variant, message }]);
      // 3 秒后自动消失
      window.setTimeout(() => remove(id), 3000);
    },
    [remove],
  );

  const value: ToastContextValue = {
    show,
    success: (m) => show(m, "success"),
    warning: (m) => show(m, "warning"),
    danger: (m) => show(m, "danger"),
    info: (m) => show(m, "info"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onClose={remove} />
    </ToastContext.Provider>
  );
}

/** 右上角 Toast 容器 */
function ToastViewport({
  toasts,
  onClose,
}: {
  toasts: ToastItem[];
  onClose: (id: number) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({
  item,
  onClose,
}: {
  item: ToastItem;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // 进入动画
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const palette = VARIANT_PALETTE[item.variant];

  return (
    <div
      role="alert"
      className={`bg-white border rounded-md shadow-sm px-4 py-3 flex items-start gap-3 transition-all duration-200 ${
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2"
      } ${palette.border}`}
    >
      <span
        className={`mt-1 inline-block w-2 h-2 rounded-full shrink-0 ${palette.dot}`}
        aria-hidden
      />
      <p className="flex-1 text-sm leading-5 text-foreground">{item.message}</p>
      <button
        type="button"
        onClick={onClose}
        className="text-foreground-muted hover:text-foreground text-sm leading-none px-1"
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}

const VARIANT_PALETTE: Record<
  ToastVariant,
  { border: string; dot: string }
> = {
  info: { border: "border-border", dot: "bg-primary" },
  success: {
    border: "border-border",
    dot: "bg-accent-green",
  },
  warning: {
    border: "border-border",
    dot: "bg-accent-amber",
  },
  danger: { border: "border-border", dot: "bg-danger" },
};
